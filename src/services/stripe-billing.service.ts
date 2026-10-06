import type Stripe from 'stripe'
import { prisma } from '../lib/prisma.js'
import { getStripe } from '../lib/stripe.js'
import { mapBillingStatus, resolvePlanFromSubscription, type AppBillingStatus, type AppPlanTier } from '../lib/billing.js'
import { applyStripeBilling } from './license.service.js'
import { billingEventsFor, recordWorkspaceEvents } from './workspace-events.service.js'

const ACCESS_STATUSES: Stripe.Subscription.Status[] = ['active', 'trialing', 'past_due', 'unpaid']

/** Assinatura que vale para o workspace: a com acesso mais recente; senão, a mais recente de todas. */
export function pickBestSubscription(subscriptions: Stripe.Subscription[]): Stripe.Subscription | null {
    if (!subscriptions.length) return null
    const byNewest = [...subscriptions].sort((a, b) => b.created - a.created)
    return (
        byNewest.find((sub) => sub.status === 'active' || sub.status === 'trialing') ??
        byNewest.find((sub) => ACCESS_STATUSES.includes(sub.status)) ??
        byNewest[0]
    )
}

export type BillingState = {
    planTier: AppPlanTier
    billingStatus: AppBillingStatus
    stripeSubscriptionId: string | null
    /** Cancelamento agendado (fim do período pago), quando houver. */
    subscriptionCancelAt: Date | null
}

export function resolveBillingState(currentTier: AppPlanTier, subscription: Stripe.Subscription | null): BillingState {
    if (!subscription) return { planTier: 'FREE', billingStatus: 'INACTIVE', stripeSubscriptionId: null, subscriptionCancelAt: null }
    const billingStatus = mapBillingStatus(subscription.status)
    const hasAccess = billingStatus === 'ACTIVE' || billingStatus === 'PAST_DUE'
    // Preço desconhecido preserva o plano atual: nunca rebaixa por engano.
    const planTier: AppPlanTier = hasAccess ? resolvePlanFromSubscription(subscription) ?? currentTier : 'FREE'
    const subscriptionCancelAt = hasAccess && subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null
    return { planTier, billingStatus, stripeSubscriptionId: subscription.id, subscriptionCancelAt }
}

export async function listCustomerSubscriptions(customerId: string) {
    const listed = await getStripe().subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
    return listed.data
}

/**
 * Fonte única de sincronização (webhook, retorno do checkout e reconciliação): lê o estado ATUAL das
 * assinaturas no Stripe e grava no workspace. Independe da ordem em que os eventos chegam.
 */
export async function syncStripeCustomer(customerId: string): Promise<(BillingState & { changed: boolean }) | null> {
    const workspace = await prisma.workspace.findFirst({
        where: { stripeCustomerId: customerId },
        select: {
            id: true,
            planTier: true,
            billingStatus: true,
            stripeSubscriptionId: true,
            subscriptionCancelAt: true,
            licensePolicy: true
        }
    })
    if (!workspace || workspace.licensePolicy === 'COURTESY') return null

    const subscription = pickBestSubscription(await listCustomerSubscriptions(customerId))
    const next = resolveBillingState(workspace.planTier, subscription)
    const changed =
        workspace.planTier !== next.planTier ||
        workspace.billingStatus !== next.billingStatus ||
        workspace.stripeSubscriptionId !== next.stripeSubscriptionId ||
        workspace.subscriptionCancelAt?.getTime() !== next.subscriptionCancelAt?.getTime()
    if (changed) {
        const { subscriptionCancelAt, ...license } = next
        await applyStripeBilling(customerId, license)
        await prisma.workspace.update({ where: { id: workspace.id }, data: { subscriptionCancelAt } })
        // Histórico para o painel Ops (assinou, trocou de plano, atrasou, cancelou...).
        await recordWorkspaceEvents(workspace.id, billingEventsFor(workspace, next))
    }
    return { ...next, changed }
}

/** Assinatura com acesso já existente (evita cobrar duas vezes o mesmo workspace). */
export async function findLiveSubscription(customerId: string) {
    const subs = await listCustomerSubscriptions(customerId)
    const live = subs.filter((sub) => ACCESS_STATUSES.includes(sub.status))
    return pickBestSubscription(live)
}

/**
 * Cliente Stripe do workspace; cria na primeira vez sem duplicar em cliques simultâneos.
 * Se o cliente salvo não existe mais (ex.: troca das chaves de teste para as de produção), cria outro.
 */
export async function getOrCreateCustomer(workspaceId: string, user: { id: string; email: string }) {
    const stripe = getStripe()
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    const previous = workspace.stripeCustomerId
    if (previous) {
        try {
            const existing = await stripe.customers.retrieve(previous)
            if (!('deleted' in existing && existing.deleted)) return previous
        } catch (error) {
            if ((error as { code?: string }).code !== 'resource_missing') throw error
        }
    }

    const customer = await stripe.customers.create(
        {
            email: user.email,
            name: workspace.name,
            preferred_locales: ['pt-BR'],
            metadata: { workspaceId, ownerUserId: user.id }
        },
        { idempotencyKey: `customer-${workspaceId}-${previous ?? 'new'}` }
    )
    const claimed = await prisma.workspace.updateMany({
        where: { id: workspaceId, stripeCustomerId: previous },
        data: { stripeCustomerId: customer.id }
    })
    if (claimed.count === 1) return customer.id
    const current = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { stripeCustomerId: true } })
    return current.stripeCustomerId ?? customer.id
}
