import { Router, raw } from 'express'
import type { Prisma, WorkspaceEventType } from '@prisma/client'
import type Stripe from 'stripe'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { getStripe, stripeMode } from '../lib/stripe.js'
import { syncStripeCustomer } from '../services/stripe-billing.service.js'
import { recordWorkspaceEvents } from '../services/workspace-events.service.js'

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

/**
 * Sinais de risco: disputa (chargeback), reembolso e alerta antecipado de fraude. Ficam no histórico da
 * empresa para o Ops decidir (reembolsar, cancelar); depois a assinatura é sincronizada como as demais.
 */
export const RISK_STRIPE_EVENTS = ['charge.dispute.created', 'charge.refunded', 'radar.early_fraud_warning.created'] as const

const RISK_EVENT_TYPE = {
    'charge.dispute.created': 'PAYMENT_DISPUTED',
    'charge.refunded': 'PAYMENT_REFUNDED',
    'radar.early_fraud_warning.created': 'FRAUD_WARNING'
} as const satisfies Record<(typeof RISK_STRIPE_EVENTS)[number], WorkspaceEventType>

type StripeObject = {
    id?: string
    customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null
    charge?: string | Stripe.Charge | null
}

const isRiskEvent = (type: string): type is (typeof RISK_STRIPE_EVENTS)[number] => (RISK_STRIPE_EVENTS as readonly string[]).includes(type)

function customerOf(object: StripeObject) {
    const customer = object.customer
    if (!customer) return null
    return typeof customer === 'string' ? customer : customer.id
}

function chargeIdOf(object: StripeObject) {
    if (!object.charge) return null
    return typeof object.charge === 'string' ? object.charge : object.charge.id
}

/** Disputa e alerta de fraude só trazem a cobrança: o cliente vem dela. */
async function riskCustomerOf(object: StripeObject) {
    const direct = customerOf(object)
    if (direct) return direct
    const chargeId = chargeIdOf(object)
    if (!chargeId) return null
    return customerOf(await getStripe().charges.retrieve(chargeId))
}

function riskDetail(event: Stripe.Event): Prisma.InputJsonValue {
    const object = event.data.object as unknown as Record<string, unknown>
    const base = { eventId: event.id, chargeId: event.type === 'charge.refunded' ? object.id : chargeIdOf(object as StripeObject) }
    if (event.type === 'charge.dispute.created') return { ...base, amountCents: object.amount, currency: object.currency, reason: object.reason } as Prisma.InputJsonValue
    if (event.type === 'charge.refunded') {
        return { ...base, refundedCents: object.amount_refunded, currency: object.currency, fullyRefunded: object.refunded } as Prisma.InputJsonValue
    }
    return { ...base, fraudType: object.fraud_type } as Prisma.InputJsonValue
}

/** Um registro por evento, mesmo que o Stripe reenvie. */
async function recordRiskEvent(event: Stripe.Event & { type: (typeof RISK_STRIPE_EVENTS)[number] }, customerId: string) {
    const workspaces = await prisma.workspace.findMany({ where: { stripeCustomerId: customerId }, select: { id: true } })
    const type = RISK_EVENT_TYPE[event.type]
    for (const { id } of workspaces) {
        const already = await prisma.workspaceEvent.findFirst({ where: { workspaceId: id, type, detail: { path: ['eventId'], equals: event.id } }, select: { id: true } })
        if (!already) await recordWorkspaceEvents(id, [{ type, detail: riskDetail(event) }])
    }
    if (workspaces.length) console.warn(`[stripe-webhook] ${event.type} para o cliente ${customerId}: veja o histórico da empresa no Ops`)
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

// 1 MB: um evento maior que o padrão (100 KB) seria recusado com 413 e reenviado pelo Stripe para sempre.
stripeWebhookRouter.post('/', raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
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

    // Evento de teste em produção (ou o contrário): chave e segredo do webhook de modos trocados. Nunca mexe nos dados.
    if (Boolean(event.livemode) !== (stripeMode() === 'live')) {
        await logStripeEvent(event, null, 'mode_mismatch')
        return res.status(200).json({ received: true, ignored: true })
    }

    const object = event.data.object as StripeObject
    const risk = isRiskEvent(event.type)
    const handled = risk || (HANDLED_STRIPE_EVENTS as readonly string[]).includes(event.type)

    let customerId: string | null
    try {
        customerId = risk ? await riskCustomerOf(object) : customerOf(object)
    } catch (error) {
        await logStripeEvent(event, null, 'error', error instanceof Error ? error.message : String(error))
        throw error
    }

    if (!handled || !customerId) {
        await logStripeEvent(event, customerId, 'ignored')
        return res.status(200).json({ received: true, ignored: true })
    }

    try {
        if (isRiskEvent(event.type)) await recordRiskEvent(event as Stripe.Event & { type: (typeof RISK_STRIPE_EVENTS)[number] }, customerId)

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
