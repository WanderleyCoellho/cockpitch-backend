import { Router, raw } from 'express'
import type Stripe from 'stripe'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { getStripe } from '../lib/stripe.js'
import { syncStripeCustomer } from '../services/stripe-billing.service.js'

export const stripeWebhookRouter = Router()

/** Eventos que podem mudar o plano. Todos levam à mesma sincronização do cliente. */
export const HANDLED_STRIPE_EVENTS = [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'customer.subscription.paused',
    'customer.subscription.resumed',
    'invoice.paid',
    'invoice.payment_failed'
] as const

function customerOf(object: { customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null }) {
    const customer = object.customer
    if (!customer) return null
    return typeof customer === 'string' ? customer : customer.id
}

/** Registro dos avisos recebidos (painel Ops). Nunca derruba o webhook. */
async function logStripeEvent(event: Stripe.Event, customerId: string | null, outcome: string, error?: string) {
    const data = { type: event.type, customerId, outcome, error: error?.slice(0, 500) ?? null, receivedAt: new Date() }
    await prisma.stripeEventLog
        .upsert({ where: { id: event.id }, create: { id: event.id, ...data }, update: data })
        .catch((err) => console.error('[stripe-webhook] falha ao registrar evento', err))
    // Guarda só os últimos 90 dias (limpeza ocasional, sem job próprio).
    if (Math.random() < 0.02) {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        await prisma.stripeEventLog.deleteMany({ where: { receivedAt: { lt: cutoff } } }).catch(() => undefined)
    }
}

stripeWebhookRouter.post('/', raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature']

    if (!signature || typeof signature !== 'string') {
        return res.status(400).json({ message: 'Missing stripe-signature header' })
    }

    let event: Stripe.Event

    try {
        event = getStripe().webhooks.constructEvent(req.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid webhook signature'
        return res.status(400).json({ message })
    }

    const object = event.data.object as { customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null }
    const customerId = customerOf(object)

    if (!(HANDLED_STRIPE_EVENTS as readonly string[]).includes(event.type) || !customerId) {
        await logStripeEvent(event, customerId, 'ignored')
        return res.status(200).json({ received: true, ignored: true })
    }

    try {
        // Checkout concluído antes de o cliente ficar salvo no workspace: liga pelo workspaceId da sessão.
        if (event.type.startsWith('checkout.session.')) {
            const session = event.data.object as Stripe.Checkout.Session
            const workspaceId = session.client_reference_id ?? session.metadata?.workspaceId
            if (workspaceId) {
                await prisma.workspace.updateMany({ where: { id: workspaceId, stripeCustomerId: null }, data: { stripeCustomerId: customerId } })
            }
        }

        // Estado lido do Stripe na hora: eventos fora de ordem ou repetidos dão o mesmo resultado.
        const synced = await syncStripeCustomer(customerId)
        await logStripeEvent(event, customerId, synced ? 'synced' : 'unknown_customer')
    } catch (error) {
        await logStripeEvent(event, customerId, 'error', error instanceof Error ? error.message : String(error))
        // Responde 500 para o Stripe reenviar.
        throw error
    }
    return res.status(200).json({ received: true })
})
