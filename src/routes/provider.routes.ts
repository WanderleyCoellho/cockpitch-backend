import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { isTrustedUploadUrl } from '../lib/trustedUploadUrl.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'

const mediaItemSchema = z.object({
    url: z.string().url(),
    type: z.enum(['image', 'video'])
})

const createProviderSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    whatsapp: z.string().optional(),
    instagram: z.string().optional(),
    city: z.string().optional(),
    logoUrl: z.string().optional(),
    photoUrl: z.string().optional(),
    shortDescription: z.string().optional(),
    aboutTitle: z.string().optional(),
    aboutSubtitle: z.string().optional(),
    aboutText: z.string().optional(),
    styleText: z.string().optional(),
    heroVideoUrl: z.string().url().optional().or(z.literal('')),
    deliveryTimes: z.string().optional(),
    differentialsTitle: z.string().optional(),
    differentialsText: z.string().optional(),
    chips: z.array(z.string()).nullable().optional(),
    testimonials: z.array(z.any()).nullable().optional(),
    differentialsMedia: z.array(mediaItemSchema).nullable().optional(),
    aboutPortfolioMedia: z.array(mediaItemSchema).nullable().optional(),
    partners: z.array(z.any()).nullable().optional(),
    packageLabel: z.string().optional(),
    contactInfo: z.record(z.string(), z.any()).nullable().optional()
})

const updateProviderSchema = createProviderSchema.partial().refine(
    (payload) => Object.keys(payload).length > 0,
    { message: 'At least one field is required' }
)

export const providerRouter = Router()

function toNullableJsonInput(value: unknown) {
    if (value === undefined) return undefined
    if (value === null) return Prisma.JsonNull
    return value as Prisma.InputJsonValue
}

providerRouter.use(requireAuth)

providerRouter.get('/me', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const providers = await prisma.provider.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: 'asc' }
    })

    return res.json({ providers })
})

providerRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const id = req.params.id

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const provider = await prisma.provider.findFirst({
        where: {
            id,
            userId: auth.userId
        }
    })

    if (!provider) {
        return res.status(404).json({ message: 'Provider not found' })
    }

    return res.json({ provider })
})

providerRouter.post('/', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const parsed = createProviderSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const origin = `${req.protocol}://${req.get('host')}`
    if (parsed.data.logoUrl && !isTrustedUploadUrl(parsed.data.logoUrl, origin)) {
        return res.status(400).json({ message: 'logoUrl must be a trusted uploaded file URL' })
    }
    if (parsed.data.photoUrl && !isTrustedUploadUrl(parsed.data.photoUrl, origin)) {
        return res.status(400).json({ message: 'photoUrl must be a trusted uploaded file URL' })
    }

    const provider = await prisma.provider.create({
        data: {
            userId: auth.userId,
            name: parsed.data.name,
            email: parsed.data.email,
            whatsapp: parsed.data.whatsapp,
            instagram: parsed.data.instagram,
            city: parsed.data.city,
            logoUrl: parsed.data.logoUrl,
            photoUrl: parsed.data.photoUrl,
            shortDescription: parsed.data.shortDescription,
            aboutTitle: parsed.data.aboutTitle,
            aboutSubtitle: parsed.data.aboutSubtitle,
            aboutText: parsed.data.aboutText,
            styleText: parsed.data.styleText,
            heroVideoUrl: parsed.data.heroVideoUrl,
            deliveryTimes: parsed.data.deliveryTimes,
            differentialsTitle: parsed.data.differentialsTitle,
            differentialsText: parsed.data.differentialsText,
            chips: toNullableJsonInput(parsed.data.chips),
            testimonials: toNullableJsonInput(parsed.data.testimonials),
            differentialsMedia: toNullableJsonInput(parsed.data.differentialsMedia),
            aboutPortfolioMedia: toNullableJsonInput(parsed.data.aboutPortfolioMedia),
            partners: toNullableJsonInput(parsed.data.partners),
            packageLabel: parsed.data.packageLabel,
            contactInfo: toNullableJsonInput(parsed.data.contactInfo)
        }
    })

    return res.status(201).json({ provider })
})

providerRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const id = req.params.id

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const parsed = updateProviderSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const origin = `${req.protocol}://${req.get('host')}`
    if (parsed.data.logoUrl && !isTrustedUploadUrl(parsed.data.logoUrl, origin)) {
        return res.status(400).json({ message: 'logoUrl must be a trusted uploaded file URL' })
    }
    if (parsed.data.photoUrl && !isTrustedUploadUrl(parsed.data.photoUrl, origin)) {
        return res.status(400).json({ message: 'photoUrl must be a trusted uploaded file URL' })
    }

    const exists = await prisma.provider.findFirst({
        where: {
            id,
            userId: auth.userId
        }
    })

    if (!exists) {
        return res.status(404).json({ message: 'Provider not found' })
    }

    const provider = await prisma.provider.update({
        where: { id },
        data: {
            name: parsed.data.name,
            email: parsed.data.email,
            whatsapp: parsed.data.whatsapp,
            instagram: parsed.data.instagram,
            city: parsed.data.city,
            logoUrl: parsed.data.logoUrl,
            photoUrl: parsed.data.photoUrl,
            shortDescription: parsed.data.shortDescription,
            aboutTitle: parsed.data.aboutTitle,
            aboutSubtitle: parsed.data.aboutSubtitle,
            aboutText: parsed.data.aboutText,
            styleText: parsed.data.styleText,
            heroVideoUrl: parsed.data.heroVideoUrl,
            deliveryTimes: parsed.data.deliveryTimes,
            differentialsTitle: parsed.data.differentialsTitle,
            differentialsText: parsed.data.differentialsText,
            chips: toNullableJsonInput(parsed.data.chips),
            testimonials: toNullableJsonInput(parsed.data.testimonials),
            differentialsMedia: toNullableJsonInput(parsed.data.differentialsMedia),
            aboutPortfolioMedia: toNullableJsonInput(parsed.data.aboutPortfolioMedia),
            partners: toNullableJsonInput(parsed.data.partners),
            packageLabel: parsed.data.packageLabel,
            contactInfo: toNullableJsonInput(parsed.data.contactInfo)
        }
    })

    return res.json({ provider })
})

providerRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const id = req.params.id

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const exists = await prisma.provider.findFirst({
        where: {
            id,
            userId: auth.userId
        }
    })

    if (!exists) {
        return res.status(404).json({ message: 'Provider not found' })
    }

    await prisma.provider.delete({ where: { id } })

    return res.status(204).send()
})
