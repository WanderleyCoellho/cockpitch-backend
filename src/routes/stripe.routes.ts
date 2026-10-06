import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { requireRole, requireWorkspace, workspaceIdOf } from '../middlewares/workspaceMiddleware.js'
import { mapPlanTier, type PaidPlanTier } from '../lib/billing.js'
import { ensureCatalogPrices, ensurePortalConfiguration, getStripe } from '../lib/stripe.js'
import { findLiveSubscription, getOrCreateCustomer, syncStripeCustomer } from '../services/stripe-billing.service.js'

// O cliente informa o plano e o servidor resolve o preço (catálogo com lookup_key).
// `priceId` continua aceito por compatibilidade, mas só se estiver mapeado.
const bodySchema = z
    .object({
        planTier: z.enum(['STARTER', 'PRO', 'AGENCY']).optional(),
        priceId: z.string().min(1).optional()
    })
    .refine((body) => body.planTier || body.priceId, { message: 'planTier or priceId is required' })

export const stripeRouter = Router()

const returnUrl = () => `${env.FRONTEND_URL}/analytics`

// A assinatura é do workspace: só o dono assina ou troca de plano.
stripeRouter.post(
    '/stripe/create-checkout',
    requireAuth,
    requireWorkspace,
    requireRole('OWNER'),
    async (req: AuthenticatedRequest, res) => {
        const parsed = bodySchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
        }

        const targetPlanTier: PaidPlanTier | null = parsed.data.planTier ?? mapPlanTier(parsed.data.priceId)
        if (!targetPlanTier) {
            return res.status(400).json({ message: 'Plano indisponível para checkout.', code: 'PRICE_NOT_CONFIGURED' })
        }

        const workspaceId = workspaceIdOf(req.auth)
        const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
        if (workspace.licensePolicy === 'COURTESY') {
            return res.status(409).json({ message: 'Este workspace tem plano cortesia.', code: 'COURTESY_PLAN' })
        }

        const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } })
        const stripe = getStripe()
        const [prices, customerId] = await Promise.all([ensureCatalogPrices(), getOrCreateCustomer(workspaceId, user)])
        const priceId = prices[targetPlanTier].priceId

        // Já assina: troca de plano pelo portal (com prorrateio), nunca uma segunda assinatura.
        const live = await findLiveSubscription(customerId)
        if (live) {
            const item = live.items.data[0]
            const configuration = await ensurePortalConfiguration()
            const samePrice = item?.price?.id === priceId
            const portal = await stripe.billingPortal.sessions.create({
                customer: customerId,
                configuration,
                locale: 'pt-BR',
                return_url: `${returnUrl()}?checkout=portal`,
                ...(item && !samePrice && !live.cancel_at_period_end
                    ? {
                        flow_data: {
                            type: 'subscription_update_confirm' as const,
                            subscription_update_confirm: {
                                subscription: live.id,
                                items: [{ id: item.id, price: priceId, quantity: 1 }]
                            },
                            after_completion: { type: 'redirect' as const, redirect: { return_url: `${returnUrl()}?checkout=success` } }
                        }
                    }
                    : {})
            })
            return res.json({ sessionId: null, url: portal.url, mode: 'portal' })
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            client_reference_id: workspaceId,
            line_items: [{ price: priceId, quantity: 1 }],
            metadata: { workspaceId, userId: user.id, planTier: targetPlanTier },
            subscription_data: { metadata: { workspaceId, planTier: targetPlanTier } },
            allow_promotion_codes: true,
            // CPF/CNPJ e endereço ficam no cliente (úteis para emitir nota fiscal).
            tax_id_collection: { enabled: true },
            billing_address_collection: 'required',
            customer_update: { name: 'auto', address: 'auto' },
            locale: 'pt-BR',
            success_url: `${returnUrl()}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${returnUrl()}?checkout=cancel`
        })

        // `url` substitui o redirectToCheckout (descontinuado no Stripe.js).
        return res.json({ sessionId: session.id, url: session.url, mode: 'checkout' })
    }
)

// Portal do cliente: trocar cartão, ver/baixar faturas, mudar de plano ou cancelar.
stripeRouter.post('/stripe/portal', requireAuth, requireWorkspace, requireRole('OWNER'), async (req: AuthenticatedRequest, res) => {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceIdOf(req.auth) } })
    if (!workspace.stripeCustomerId) {
        return res.status(409).json({ message: 'Este workspace ainda não tem assinatura.', code: 'NO_SUBSCRIPTION' })
    }
    const configuration = await ensurePortalConfiguration()
    const portal = await getStripe().billingPortal.sessions.create({
        customer: workspace.stripeCustomerId,
        configuration,
        locale: 'pt-BR',
        return_url: `${returnUrl()}?checkout=portal`
    })
    return res.json({ url: portal.url })
})

// Volta do checkout/portal: sincroniza na hora, sem depender só do webhook chegar.
const syncSchema = z.object({ sessionId: z.string().min(1).max(255).optional() })

stripeRouter.post('/stripe/sync', requireAuth, requireWorkspace, async (req: AuthenticatedRequest, res) => {
    const parsed = syncSchema.safeParse(req.body ?? {})
    if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' })

    const workspaceId = workspaceIdOf(req.auth)
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    let customerId = workspace.stripeCustomerId

    if (parsed.data.sessionId) {
        const session = await getStripe().checkout.sessions.retrieve(parsed.data.sessionId)
        const sessionCustomer = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null
        const ownsSession = session.client_reference_id === workspaceId || session.metadata?.workspaceId === workspaceId
        if (!ownsSession || (customerId && sessionCustomer !== customerId)) {
            return res.status(404).json({ message: 'Sessão não encontrada.' })
        }
        if (!customerId && sessionCustomer) {
            await prisma.workspace.updateMany({ where: { id: workspaceId, stripeCustomerId: null }, data: { stripeCustomerId: sessionCustomer } })
            customerId = sessionCustomer
        }
    }

    if (customerId) await syncStripeCustomer(customerId)
    const updated = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { planTier: true, billingStatus: true }
    })
    return res.json(updated)
})
