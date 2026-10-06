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

    if (!(HANDLED_STRIPE_EVENTS as readonly string[]).includes(event.type)) {
        return res.status(200).json({ received: true, ignored: true })
    }

    const object = event.data.object as { customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null }
    const customerId = customerOf(object)
    if (!customerId) return res.status(200).json({ received: true })

    // Checkout concluído antes de o cliente ficar salvo no workspace: liga pelo workspaceId da sessão.
    if (event.type.startsWith('checkout.session.')) {
        const session = event.data.object as Stripe.Checkout.Session
        const workspaceId = session.client_reference_id ?? session.metadata?.workspaceId
        if (workspaceId) {
            await prisma.workspace.updateMany({ where: { id: workspaceId, stripeCustomerId: null }, data: { stripeCustomerId: customerId } })
        }
    }

    // Estado lido do Stripe na hora: eventos fora de ordem ou repetidos dão o mesmo resultado.
    // Se falhar, responde 500 e o Stripe reenvia.
    await syncStripeCustomer(customerId)
    return res.status(200).json({ received: true })
})
