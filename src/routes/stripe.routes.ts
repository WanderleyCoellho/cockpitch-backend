import { Router } from 'express'
import Stripe from 'stripe'
import { z } from 'zod'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { mapPlanTier } from '../lib/billing.js'

const bodySchema = z.object({
    priceId: z.string().min(1)
})

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

    const targetPlanTier = mapPlanTier(parsed.data.priceId)
    if (targetPlanTier === 'AGENCY') {
        return res.status(403).json({ message: 'Este plano não está disponível no autosserviço.' })
    }
    if (targetPlanTier === 'FREE') {
        return res.status(400).json({ message: 'Preço inválido para checkout.' })
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
        line_items: [{ price: parsed.data.priceId, quantity: 1 }],
        metadata: { userId: user.id },
        success_url: `${env.FRONTEND_URL}/analytics?checkout=success`,
        cancel_url: `${env.FRONTEND_URL}/analytics?checkout=cancel`
    })

    return res.json({ sessionId: session.id })
})
