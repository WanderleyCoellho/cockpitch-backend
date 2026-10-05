import { Router } from 'express'
import Stripe from 'stripe'
import { z } from 'zod'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { mapPlanTier, priceIdForTier } from '../lib/billing.js'

// Preferência: o cliente informa o plano e o servidor resolve o preço (STRIPE_PRICE_*).
// `priceId` continua aceito por compatibilidade, mas só se estiver mapeado.
const bodySchema = z
    .object({
        planTier: z.enum(['STARTER', 'PRO']).optional(),
        priceId: z.string().min(1).optional()
    })
    .refine((body) => body.planTier || body.priceId, { message: 'planTier or priceId is required' })

const stripe = new Stripe(env.STRIPE_SECRET_KEY)

export const stripeRouter = Router()

stripeRouter.post('/stripe/create-checkout', requireAuth, async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const parsed = bodySchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const targetPlanTier = parsed.data.planTier ?? mapPlanTier(parsed.data.priceId)
    if (targetPlanTier === 'AGENCY') {
        return res.status(403).json({ message: 'Este plano não está disponível no autosserviço.' })
    }
    const priceId = targetPlanTier ? priceIdForTier(targetPlanTier) : null
    if (!targetPlanTier || !priceId) {
        return res.status(400).json({ message: 'Plano indisponível para checkout.', code: 'PRICE_NOT_CONFIGURED' })
    }

    const user = await prisma.user.findUnique({ where: { id: auth.userId } })
    if (!user) {
        return res.status(404).json({ message: 'User not found' })
    }

    let customerId = user.stripeCustomerId

    if (!customerId) {
        const customer = await stripe.customers.create({
            email: user.email,
            name: user.name,
            metadata: { userId: user.id }
        })
        customerId = customer.id

        await prisma.user.update({
            where: { id: user.id },
            data: { stripeCustomerId: customerId }
        })
    }

    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { userId: user.id, planTier: targetPlanTier },
        allow_promotion_codes: true,
        success_url: `${env.FRONTEND_URL}/analytics?checkout=success`,
        cancel_url: `${env.FRONTEND_URL}/analytics?checkout=cancel`
    })

    // `url` substitui o redirectToCheckout (descontinuado no Stripe.js).
    return res.json({ sessionId: session.id, url: session.url })
})
