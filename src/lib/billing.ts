import type Stripe from 'stripe'
import { env } from '../config/env.js'
import { tierForLookupKey } from './stripe.js'

export type AppPlanTier = 'FREE' | 'STARTER' | 'PRO' | 'AGENCY'
export type AppBillingStatus = 'INACTIVE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'
export type PaidPlanTier = Exclude<AppPlanTier, 'FREE'>

/**
 * Mapa legado priceId → plano (STRIPE_PRICE_*). Opcional: os preços criados pela API são reconhecidos
 * pela `lookup_key` (ver PLAN_CATALOG); estas variáveis só servem para preços criados à mão.
 */
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

/**
 * `past_due` = o Stripe ainda está tentando cobrar: mantém o plano durante as novas tentativas.
 * `unpaid` = as tentativas acabaram e a fatura ficou em aberto: sem acesso ao plano pago até pagar
 * (senão, com o Stripe configurado para "marcar como não paga", o plano seguiria liberado para sempre).
 */
export function mapBillingStatus(stripeStatus: Stripe.Subscription.Status): AppBillingStatus {
    if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'ACTIVE'
    if (stripeStatus === 'past_due') return 'PAST_DUE'
    if (stripeStatus === 'canceled') return 'CANCELED'
    return 'INACTIVE'
}

/** Plano de um preço do Stripe: primeiro pela lookup_key do catálogo, depois pelo mapa legado de IDs. */
export function tierForPrice(price?: Pick<Stripe.Price, 'id' | 'lookup_key'> | null): PaidPlanTier | null {
    if (!price) return null
    return tierForLookupKey(price.lookup_key) ?? mapPlanTier(price.id)
}

export function resolvePlanFromSubscription(subscription: Stripe.Subscription): PaidPlanTier | null {
    return tierForPrice(subscription.items.data[0]?.price ?? null)
}
