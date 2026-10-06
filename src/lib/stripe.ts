import Stripe from 'stripe'
import { env } from '../config/env.js'
import type { PaidPlanTier } from './billing.js'

let client: Stripe | null = null

/** Cliente Stripe único da API (substituível nos testes por um fake). */
export function getStripe(): Stripe {
    if (!client) client = new Stripe(env.STRIPE_SECRET_KEY, { timeout: 20_000, maxNetworkRetries: 2 })
    return client
}

export function setStripe(next: Stripe | null) {
    client = next
    resetStripeCatalogCache()
}

/**
 * Catálogo dos planos pagos. Os produtos e preços são criados no Stripe automaticamente na primeira
 * vez (identificados por `lookup_key`), então não é preciso copiar IDs de preço para as variáveis.
 * Mudar um valor aqui cria um preço novo e transfere a lookup_key; assinantes antigos continuam no preço antigo.
 */
export const PLAN_CATALOG: Record<PaidPlanTier, { productId: string; name: string; description: string; lookupKey: string; unitAmount: number }> = {
    STARTER: {
        productId: 'lumen_deal_essencial',
        name: 'Lumen Deal Essencial',
        description: '30 propostas por mês, 1 usuário, sem a marca Lumen Deal.',
        lookupKey: 'lumen_deal_essencial_mensal',
        unitAmount: 4900
    },
    PRO: {
        productId: 'lumen_deal_profissional',
        name: 'Lumen Deal Profissional',
        description: 'Propostas ilimitadas, até 3 pessoas, modelos próprios.',
        lookupKey: 'lumen_deal_profissional_mensal',
        unitAmount: 9900
    },
    AGENCY: {
        productId: 'lumen_deal_equipe',
        name: 'Lumen Deal Equipe',
        description: 'Propostas ilimitadas, até 10 pessoas, papéis e permissões.',
        lookupKey: 'lumen_deal_equipe_mensal',
        unitAmount: 24900
    }
}

export const PLAN_CURRENCY = 'brl'

export type CatalogPrices = Record<PaidPlanTier, { priceId: string; productId: string }>

const TIERS = Object.keys(PLAN_CATALOG) as PaidPlanTier[]

export function tierForLookupKey(lookupKey?: string | null): PaidPlanTier | null {
    if (!lookupKey) return null
    return TIERS.find((tier) => PLAN_CATALOG[tier].lookupKey === lookupKey) ?? null
}

function isStripeError(error: unknown, code: string) {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === code
}

async function ensureProduct(stripe: Stripe, tier: PaidPlanTier) {
    const plan = PLAN_CATALOG[tier]
    try {
        return await stripe.products.retrieve(plan.productId)
    } catch (error) {
        if (!isStripeError(error, 'resource_missing')) throw error
    }
    try {
        return await stripe.products.create({
            id: plan.productId,
            name: plan.name,
            description: plan.description,
            metadata: { app: 'lumen-deal', planTier: tier }
        })
    } catch (error) {
        // Outra instância criou ao mesmo tempo.
        if (isStripeError(error, 'resource_already_exists')) return stripe.products.retrieve(plan.productId)
        throw error
    }
}

async function provisionCatalog(): Promise<CatalogPrices> {
    const stripe = getStripe()
    const listed = await stripe.prices.list({ lookup_keys: TIERS.map((t) => PLAN_CATALOG[t].lookupKey), active: true, limit: 10 })
    const result = {} as CatalogPrices

    for (const tier of TIERS) {
        const plan = PLAN_CATALOG[tier]
        const existing = listed.data.find((price) => price.lookup_key === plan.lookupKey)
        const upToDate =
            existing &&
            existing.unit_amount === plan.unitAmount &&
            existing.currency === PLAN_CURRENCY &&
            existing.recurring?.interval === 'month'
        if (existing && upToDate) {
            const productId = typeof existing.product === 'string' ? existing.product : existing.product.id
            result[tier] = { priceId: existing.id, productId }
            continue
        }

        const product = await ensureProduct(stripe, tier)
        const price = await stripe.prices.create({
            product: product.id,
            currency: PLAN_CURRENCY,
            unit_amount: plan.unitAmount,
            recurring: { interval: 'month' },
            lookup_key: plan.lookupKey,
            // Valor mudou no catálogo: o preço novo assume a lookup_key.
            transfer_lookup_key: Boolean(existing),
            tax_behavior: 'inclusive',
            metadata: { app: 'lumen-deal', planTier: tier }
        })
        if (product.default_price == null) {
            await stripe.products.update(product.id, { default_price: price.id }).catch(() => undefined)
        }
        console.log(`[stripe] preço criado para ${tier}: ${price.id}`)
        result[tier] = { priceId: price.id, productId: product.id }
    }
    return result
}

let catalogPromise: Promise<CatalogPrices> | null = null

/** Garante (uma vez por processo) que os produtos e preços existem no Stripe e devolve seus IDs. */
export function ensureCatalogPrices(): Promise<CatalogPrices> {
    if (!catalogPromise) {
        catalogPromise = provisionCatalog().catch((error) => {
            catalogPromise = null // tenta de novo na próxima chamada
            throw error
        })
    }
    return catalogPromise
}

let portalConfigPromise: Promise<string> | null = null

export function resetStripeCatalogCache() {
    catalogPromise = null
    portalConfigPromise = null
}

/**
 * Configuração do portal do cliente (trocar plano, cartão, notas, cancelar no fim do período).
 * Criada pela API e reaproveitada pela versão (muda quando os preços mudam).
 */
export function ensurePortalConfiguration(): Promise<string> {
    if (!portalConfigPromise) {
        portalConfigPromise = (async () => {
            const stripe = getStripe()
            const prices = await ensureCatalogPrices()
            const version = TIERS.map((tier) => prices[tier].priceId).join(',')

            const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
            const found = configs.data.find((c) => c.metadata?.app === 'lumen-deal' && c.metadata?.version === version)
            if (found) return found.id

            const https = env.FRONTEND_URL.startsWith('https://')
            const created = await stripe.billingPortal.configurations.create({
                business_profile: https
                    ? { privacy_policy_url: `${env.FRONTEND_URL}/privacidade`, terms_of_service_url: `${env.FRONTEND_URL}/termos` }
                    : {},
                default_return_url: `${env.FRONTEND_URL}/analytics`,
                features: {
                    customer_update: { enabled: true, allowed_updates: ['name', 'email', 'address', 'tax_id'] },
                    invoice_history: { enabled: true },
                    payment_method_update: { enabled: true },
                    subscription_cancel: {
                        enabled: true,
                        mode: 'at_period_end',
                        cancellation_reason: {
                            enabled: true,
                            options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other']
                        }
                    },
                    subscription_update: {
                        enabled: true,
                        default_allowed_updates: ['price'],
                        proration_behavior: 'create_prorations',
                        products: TIERS.map((tier) => ({ product: prices[tier].productId, prices: [prices[tier].priceId] }))
                    }
                },
                metadata: { app: 'lumen-deal', version }
            })
            return created.id
        })().catch((error) => {
            portalConfigPromise = null
            throw error
        })
    }
    return portalConfigPromise
}
