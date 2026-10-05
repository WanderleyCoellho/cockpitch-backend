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

const createProposalSchema = z.object({
    providerId: z.string().cuid(),
    packageIds: z.array(z.string().cuid()).default([]),
    clientName: z.string().min(2),
    slug: z.string().min(3),
    serviceDate: z.string().optional(),
    validityDays: z.number().int().min(1).default(30),
    status: z.enum(['ABERTA', 'FECHADA', 'EXPIRADA', 'ARQUIVADA']).default('ABERTA'),
    commercialStatus: z
        .enum(['SEM_RESPOSTA', 'NEGOCIANDO', 'ACEITA', 'NEGADA', 'PERSONALIZADO'])
        .default('SEM_RESPOSTA'),
    heroVideoUrl: z.string().url().optional(),
    weddingPhotoUrl: z.string().url().optional(),
    theme: z.string().optional(),
    themeCustom: z.record(z.string(), z.any()).nullable().optional(),
    sections: z.array(z.any()).nullable().optional(),
    backstageMedia: z.array(mediaItemSchema).nullable().optional(),
    differentialsMedia: z.array(mediaItemSchema).nullable().optional(),
    videoSoundEnabled: z.boolean().optional(),
    sectionsConfig: z.record(z.string(), z.any()).nullable().optional()
})

const updateProposalSchema = createProposalSchema.partial().refine(
    (payload) => Object.keys(payload).length > 0,
    { message: 'At least one field is required' }
)

export const proposalRouter = Router()

function toNullableJsonInput(value: unknown) {
    if (value === undefined) return undefined
    if (value === null) return Prisma.JsonNull
    return value as Prisma.InputJsonValue
}

proposalRouter.use(requireAuth)

// Helper para validar propriedade do provider
async function verifyProviderOwnership(auth: any, providerId: string) {
    const provider = await prisma.provider.findFirst({
        where: {
            id: providerId,
            userId: auth.userId
        }
    })
    return provider
}

// Helper para validar propriedade da proposal
async function verifyProposalOwnership(auth: any, proposalId: string) {
    const proposal = await prisma.proposal.findFirst({
        where: {
            id: proposalId,
            provider: {
                userId: auth.userId
            }
        }
    })
    return proposal
}

// Garante que todos os pacotes informados pertencem ao mesmo provider da proposta.
async function packagesBelongToProvider(packageIds: string[], providerId: string) {
    const unique = [...new Set(packageIds)]
    if (unique.length === 0) return true
    const count = await prisma.package.count({
        where: { id: { in: unique }, providerId }
    })
    return count === unique.length
}

proposalRouter.get('/provider/:providerId', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { providerId } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const provider = await verifyProviderOwnership(auth, providerId)
    if (!provider) {
        return res.status(403).json({ message: 'Access denied' })
    }

    const proposals = await prisma.proposal.findMany({
        where: { providerId },
        include: {
            packageIds: {
                include: { items: true }
            },
            views: true
        },
        orderBy: { createdAt: 'desc' }
    })

    return res.json({ proposals })
})

proposalRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { id } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const proposal = await prisma.proposal.findFirst({
        where: {
            id,
            provider: {
                userId: auth.userId
            }
        },
        include: {
            packageIds: {
                include: { items: true }
            },
            views: true
        }
    })

    if (!proposal) {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    return res.json({ proposal })
})

proposalRouter.post('/', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const parsed = createProposalSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const origin = `${req.protocol}://${req.get('host')}`
    if (parsed.data.heroVideoUrl && !isTrustedUploadUrl(parsed.data.heroVideoUrl, origin)) {
        return res.status(400).json({ message: 'heroVideoUrl must be a trusted uploaded file URL' })
    }
    if (parsed.data.weddingPhotoUrl && !isTrustedUploadUrl(parsed.data.weddingPhotoUrl, origin)) {
        return res.status(400).json({ message: 'weddingPhotoUrl must be a trusted uploaded file URL' })
    }

    const provider = await verifyProviderOwnership(auth, parsed.data.providerId)
    if (!provider) {
        return res.status(403).json({ message: 'Access denied' })
    }

    if (!(await packagesBelongToProvider(parsed.data.packageIds, provider.id))) {
        return res.status(403).json({ message: 'One or more packages do not belong to this provider' })
    }

    const proposal = await prisma.proposal.create({
        data: {
            providerId: parsed.data.providerId,
            clientName: parsed.data.clientName,
            slug: parsed.data.slug,
            serviceDate: parsed.data.serviceDate,
            validityDays: parsed.data.validityDays,
            status: parsed.data.status,
            commercialStatus: parsed.data.commercialStatus,
            heroVideoUrl: parsed.data.heroVideoUrl,
            weddingPhotoUrl: parsed.data.weddingPhotoUrl,
            theme: parsed.data.theme,
            themeCustom: toNullableJsonInput(parsed.data.themeCustom),
            sections: toNullableJsonInput(parsed.data.sections),
            backstageMedia: toNullableJsonInput(parsed.data.backstageMedia),
            differentialsMedia: toNullableJsonInput(parsed.data.differentialsMedia),
            videoSoundEnabled: parsed.data.videoSoundEnabled,
            sectionsConfig: toNullableJsonInput(parsed.data.sectionsConfig),
            packageIds: {
                connect: parsed.data.packageIds.map((id) => ({ id }))
            }
        },
        include: {
            packageIds: {
                include: { items: true }
            },
            views: true
        }
    })

    return res.status(201).json({ proposal })
})

proposalRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { id } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const parsed = updateProposalSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const origin = `${req.protocol}://${req.get('host')}`
    if (parsed.data.heroVideoUrl && !isTrustedUploadUrl(parsed.data.heroVideoUrl, origin)) {
        return res.status(400).json({ message: 'heroVideoUrl must be a trusted uploaded file URL' })
    }
    if (parsed.data.weddingPhotoUrl && !isTrustedUploadUrl(parsed.data.weddingPhotoUrl, origin)) {
        return res.status(400).json({ message: 'weddingPhotoUrl must be a trusted uploaded file URL' })
    }

    const proposal = await verifyProposalOwnership(auth, id)
    if (!proposal) {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    const { packageIds, providerId: _providerId, ...data } = parsed.data

    if (packageIds && !(await packagesBelongToProvider(packageIds, proposal.providerId))) {
        return res.status(403).json({ message: 'One or more packages do not belong to this provider' })
    }

    const updated = await prisma.proposal.update({
        where: { id },
        data: {
            ...data,
            themeCustom: toNullableJsonInput(data.themeCustom),
            sections: toNullableJsonInput(data.sections),
            backstageMedia: toNullableJsonInput(data.backstageMedia),
            differentialsMedia: toNullableJsonInput(data.differentialsMedia),
            videoSoundEnabled: data.videoSoundEnabled,
            sectionsConfig: toNullableJsonInput(data.sectionsConfig),
            packageIds: packageIds
                ? {
                    set: packageIds.map((pkgId) => ({ id: pkgId }))
                }
                : undefined
        },
        include: {
            packageIds: {
                include: { items: true }
            },
            views: true
        }
    })

    return res.json({ proposal: updated })
})

proposalRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { id } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const proposal = await verifyProposalOwnership(auth, id)
    if (!proposal) {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    await prisma.proposal.delete({ where: { id } })

    return res.status(204).send()
})
