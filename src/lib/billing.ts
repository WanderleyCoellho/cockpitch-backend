import type Stripe from 'stripe'
import { env } from '../config/env.js'

export type AppPlanTier = 'FREE' | 'STARTER' | 'PRO' | 'AGENCY'
export type AppBillingStatus = 'INACTIVE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'
export type PaidPlanTier = Exclude<AppPlanTier, 'FREE'>

/** Mapa explícito priceId do Stripe → plano, configurado por ambiente (STRIPE_PRICE_*). */
export function getPriceIdByTier(): Record<PaidPlanTier, string> {
    return {
        STARTER: env.STRIPE_PRICE_STARTER,
        PRO: env.STRIPE_PRICE_PRO,
        AGENCY: env.STRIPE_PRICE_AGENCY
    }
}

export function priceIdForTier(tier: PaidPlanTier): string | null {
    return getPriceIdByTier()[tier] || null
}

/**
 * Resolve o plano a partir do priceId. Retorna null quando o preço não está mapeado —
 * quem chama deve então PRESERVAR o plano atual em vez de rebaixar o cliente para FREE.
 */
export function mapPlanTier(priceId?: string | null): PaidPlanTier | null {
    if (!priceId) return null
    const entries = Object.entries(getPriceIdByTier()) as Array<[PaidPlanTier, string]>
    const match = entries.find(([, configured]) => configured && configured === priceId)
    return match ? match[0] : null
}

export function mapBillingStatus(stripeStatus: Stripe.Subscription.Status): AppBillingStatus {
    if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'ACTIVE'
    if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'PAST_DUE'
    if (stripeStatus === 'canceled') return 'CANCELED'
    return 'INACTIVE'
}

export function resolvePlanFromSubscription(subscription: Stripe.Subscription): PaidPlanTier | null {
    const firstPriceId = subscription.items.data[0]?.price?.id ?? null
    return mapPlanTier(firstPriceId)
}
