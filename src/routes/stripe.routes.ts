import { Router } from 'express'
import Stripe from 'stripe'
import { z } from 'zod'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { requireRole, requireWorkspace, workspaceIdOf } from '../middlewares/workspaceMiddleware.js'
import { mapPlanTier, priceIdForTier } from '../lib/billing.js'

// O cliente informa o plano e o servidor resolve o preço (STRIPE_PRICE_*).
// `priceId` continua aceito por compatibilidade, mas só se estiver mapeado.
const bodySchema = z
    .object({
        planTier: z.enum(['STARTER', 'PRO', 'AGENCY']).optional(),
        priceId: z.string().min(1).optional()
    })
    .refine((body) => body.planTier || body.priceId, { message: 'planTier or priceId is required' })

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { timeout: 20_000, maxNetworkRetries: 1 })

export const stripeRouter = Router()

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

        const targetPlanTier = parsed.data.planTier ?? mapPlanTier(parsed.data.priceId)
        const priceId = targetPlanTier ? priceIdForTier(targetPlanTier) : null
        if (!targetPlanTier || !priceId) {
            return res.status(400).json({ message: 'Plano indisponível para checkout.', code: 'PRICE_NOT_CONFIGURED' })
        }

        const workspaceId = workspaceIdOf(req.auth)
        const [workspace, user] = await Promise.all([
            prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
            prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } })
        ])

        let customerId = workspace.stripeCustomerId
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                name: workspace.name,
                metadata: { workspaceId, ownerUserId: user.id }
            })
            customerId = customer.id
            await prisma.workspace.update({ where: { id: workspaceId }, data: { stripeCustomerId: customerId } })
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            line_items: [{ price: priceId, quantity: 1 }],
            metadata: { workspaceId, userId: user.id, planTier: targetPlanTier },
            subscription_data: { metadata: { workspaceId } },
            allow_promotion_codes: true,
            locale: 'pt-BR',
            success_url: `${env.FRONTEND_URL}/analytics?checkout=success`,
            cancel_url: `${env.FRONTEND_URL}/analytics?checkout=cancel`
        })

        // `url` substitui o redirectToCheckout (descontinuado no Stripe.js).
        return res.json({ sessionId: session.id, url: session.url })
    }
)
