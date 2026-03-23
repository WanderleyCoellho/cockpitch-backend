import { Router, raw } from 'express'
import Stripe from 'stripe'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { mapBillingStatus, mapPlanTier } from '../lib/billing.js'

const stripe = new Stripe(env.STRIPE_SECRET_KEY)

export const stripeWebhookRouter = Router()

async function updateBillingByCustomerId(
    customerId: string,
    data: {
        stripeSubscriptionId?: string | null
        billingStatus?: 'INACTIVE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'
        planTier?: 'FREE' | 'STARTER' | 'PRO' | 'AGENCY'
    }
) {
    await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data
    })
}

stripeWebhookRouter.post('/', raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature']

    if (!signature || typeof signature !== 'string') {
        return res.status(400).json({ message: 'Missing stripe-signature header' })
    }

    let event: Stripe.Event

    try {
        event = stripe.webhooks.constructEvent(
            req.body as Buffer,
            signature,
            env.STRIPE_WEBHOOK_SECRET
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid webhook signature'
        return res.status(400).json({ message })
    }

    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session
            const customerId = typeof session.customer === 'string' ? session.customer : null

            if (customerId) {
                const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
                    expand: ['line_items']
                })
                const firstPriceId = fullSession.line_items?.data?.[0]?.price?.id ?? null

                await updateBillingByCustomerId(customerId, {
                    stripeSubscriptionId:
                        typeof session.subscription === 'string' ? session.subscription : null,
                    billingStatus: 'ACTIVE',
                    planTier: mapPlanTier(firstPriceId)
                })
            }
            break
        }
        case 'customer.subscription.created': {
            const subscription = event.data.object as Stripe.Subscription
            const customerId = typeof subscription.customer === 'string' ? subscription.customer : null
            const firstPriceId = subscription.items.data[0]?.price?.id ?? null

            if (customerId) {
                await updateBillingByCustomerId(customerId, {
                    stripeSubscriptionId: subscription.id,
                    billingStatus: 'ACTIVE',
                    planTier: mapPlanTier(firstPriceId)
                })
            }
            break
        }
        case 'customer.subscription.updated': {
            const subscription = event.data.object as Stripe.Subscription
            const customerId = typeof subscription.customer === 'string' ? subscription.customer : null
            const firstPriceId = subscription.items.data[0]?.price?.id ?? null

            if (customerId) {
                const billingStatus = mapBillingStatus(subscription.status)

                await updateBillingByCustomerId(customerId, {
                    stripeSubscriptionId: subscription.id,
                    billingStatus,
                    planTier: mapPlanTier(firstPriceId)
                })
            }
            break
        }
        case 'customer.subscription.deleted': {
            const subscription = event.data.object as Stripe.Subscription
            const customerId = typeof subscription.customer === 'string' ? subscription.customer : null

            if (customerId) {
                await updateBillingByCustomerId(customerId, {
                    stripeSubscriptionId: null,
                    billingStatus: 'CANCELED',
                    planTier: 'FREE'
                })
            }
            break
        }
        default:
            break
    }

    return res.status(200).json({ received: true })
})
