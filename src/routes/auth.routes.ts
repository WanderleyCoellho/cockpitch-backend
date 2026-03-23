import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { signAccessToken } from '../lib/jwt.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'

const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6)
})

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6)
})

export const authRouter = Router()

authRouter.post('/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const { name, email, password } = parsed.data
    const normalizedEmail = email.trim().toLowerCase()

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) {
        return res.status(409).json({ message: 'Email already in use' })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
        data: {
            name,
            email: normalizedEmail,
            passwordHash,
            role: 'PROVIDER',
            providers: {
                create: {
                    name,
                    email: normalizedEmail
                }
            }
        },
        include: { providers: true }
    })

    const token = signAccessToken({ userId: user.id, role: user.role })

    return res.status(201).json({
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            planTier: user.planTier,
            billingStatus: user.billingStatus,
            licensePolicy: user.licensePolicy,
            licensePolicyNote: user.licensePolicyNote,
            providerId: user.providers[0]?.id || null
        }
    })
})

authRouter.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const { email, password } = parsed.data
    const normalizedEmail = email.trim().toLowerCase()

    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: { providers: true }
    })

    if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' })
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
        return res.status(401).json({ message: 'Invalid credentials' })
    }

    const token = signAccessToken({ userId: user.id, role: user.role })

    return res.json({
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            planTier: user.planTier,
            billingStatus: user.billingStatus,
            licensePolicy: user.licensePolicy,
            licensePolicyNote: user.licensePolicyNote,
            providerId: user.providers[0]?.id || null
        }
    })
})

authRouter.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    const auth = req.auth

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        include: { providers: true }
    })

    if (!user) {
        return res.status(404).json({ message: 'User not found' })
    }

    return res.json({
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            planTier: user.planTier,
            billingStatus: user.billingStatus,
            licensePolicy: user.licensePolicy,
            licensePolicyNote: user.licensePolicyNote,
            providerId: user.providers[0]?.id || null
        }
    })
})
