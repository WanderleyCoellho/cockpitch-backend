import type Stripe from 'stripe'

export type AppPlanTier = 'FREE' | 'STARTER' | 'PRO' | 'AGENCY'
export type AppBillingStatus = 'INACTIVE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'

export function mapPlanTier(priceId?: string | null): AppPlanTier {
    if (!priceId) return 'FREE'
    const normalized = priceId.toLowerCase()
    if (normalized.includes('starter')) return 'STARTER'
    if (normalized.includes('agency')) return 'AGENCY'
    if (normalized.includes('pro')) return 'PRO'
    return 'FREE'
}

export function mapBillingStatus(stripeStatus: Stripe.Subscription.Status): AppBillingStatus {
    if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'ACTIVE'
    if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'PAST_DUE'
    if (stripeStatus === 'canceled') return 'CANCELED'
    return 'INACTIVE'
}

export function resolvePlanFromSubscription(subscription: Stripe.Subscription): AppPlanTier {
    const firstPriceId = subscription.items.data[0]?.price?.id ?? null
    return mapPlanTier(firstPriceId)
}
