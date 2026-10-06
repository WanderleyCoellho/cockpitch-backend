import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { isTrustedUploadUrl } from '../lib/trustedUploadUrl.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { requireWorkspace, workspaceIdOf } from '../middlewares/workspaceMiddleware.js'
import { assertCanCreateProposal } from '../services/workspace.service.js'
import { serializePackage } from '../services/package.service.js'
import { blocksSchema, collectMediaUrls } from '../services/blocks.js'
import { resolveTemplate } from '../services/template.service.js'

// Pacotes da proposta com preço calculado e quantidade numérica.
function withPricedPackages<T extends { packageIds: Parameters<typeof serializePackage>[0][] }>(proposal: T) {
    return { ...proposal, packageIds: proposal.packageIds.map(serializePackage) }
}

const mediaItemSchema = z.object({
    url: z.string().url(),
    type: z.enum(['image', 'video'])
})

/** Formulários enviam "" para campo não preenchido; tratamos como ausente em vez de recusar a proposta. */
const emptyAsUndefined = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((value) => (value === '' ? undefined : value), schema)

const createProposalSchema = z.object({
    providerId: z.string().cuid(),
    packageIds: z.array(z.string().cuid()).default([]),
    clientName: z.string().min(2),
    slug: z.string().min(3),
    serviceDate: emptyAsUndefined(z.string().max(40).optional()),
    validityDays: z.number().int().min(1).default(30),
    status: z.enum(['ABERTA', 'FECHADA', 'EXPIRADA', 'ARQUIVADA']).default('ABERTA'),
    commercialStatus: z
        .enum(['SEM_RESPOSTA', 'NEGOCIANDO', 'ACEITA', 'NEGADA', 'PERSONALIZADO'])
        .default('SEM_RESPOSTA'),
    heroVideoUrl: emptyAsUndefined(z.string().url().optional()),
    weddingPhotoUrl: emptyAsUndefined(z.string().url().optional()),
    theme: z.string().optional(),
    themeCustom: z.record(z.string(), z.any()).nullable().optional(),
    sections: z.array(z.any()).nullable().optional(),
    backstageMedia: z.array(mediaItemSchema).nullable().optional(),
    differentialsMedia: z.array(mediaItemSchema).nullable().optional(),
    videoSoundEnabled: z.boolean().optional(),
    sectionsConfig: z.record(z.string(), z.any()).nullable().optional(),
    /** Proposta em blocos (spec 003). */
    blocks: blocksSchema.nullable().optional(),
    /** Criar a partir de um modelo: sys-* (sistema) ou id de modelo da empresa. Usado só se `blocks` não vier. */
    templateId: z.string().max(40).optional()
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

proposalRouter.use(requireAuth, requireWorkspace)

/** Toda mídia usada nos blocos precisa ter sido enviada pela própria API (nada de links de terceiros). */
function firstUntrustedBlockUrl(blocks: z.infer<typeof blocksSchema> | null | undefined, req: AuthenticatedRequest) {
    if (!blocks) return null
    return collectMediaUrls(blocks).find((url) => !isTrustedUploadUrl(url, req)) ?? null
}

// Helper para validar propriedade do provider
async function verifyProviderOwnership(auth: any, providerId: string) {
    const provider = await prisma.provider.findFirst({
        where: {
            id: providerId,
            workspaceId: workspaceIdOf(auth)
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
                workspaceId: workspaceIdOf(auth)
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

    return res.json({ proposals: proposals.map(withPricedPackages) })
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
                workspaceId: workspaceIdOf(auth)
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

    return res.json({ proposal: withPricedPackages(proposal) })
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

    if (parsed.data.heroVideoUrl && !isTrustedUploadUrl(parsed.data.heroVideoUrl, req)) {
        return res.status(400).json({ message: 'heroVideoUrl must be a trusted uploaded file URL' })
    }
    if (parsed.data.weddingPhotoUrl && !isTrustedUploadUrl(parsed.data.weddingPhotoUrl, req)) {
        return res.status(400).json({ message: 'weddingPhotoUrl must be a trusted uploaded file URL' })
    }
    if (firstUntrustedBlockUrl(parsed.data.blocks, req)) {
        return res.status(400).json({ message: 'Use apenas mídias enviadas pelo Lumen Deal nos blocos.', code: 'UNTRUSTED_MEDIA' })
    }

    const provider = await verifyProviderOwnership(auth, parsed.data.providerId)
    if (!provider) {
        return res.status(403).json({ message: 'Access denied' })
    }

    if (!(await packagesBelongToProvider(parsed.data.packageIds, provider.id))) {
        return res.status(403).json({ message: 'One or more packages do not belong to this provider' })
    }

    // Limite mensal do plano (402 PLAN_LIMIT → o painel oferece upgrade).
    await assertCanCreateProposal(workspaceIdOf(auth))

    // Modelo: copia os blocos (cópia, não vínculo — editar o modelo depois não muda propostas já enviadas).
    const template = parsed.data.templateId ? await resolveTemplate(parsed.data.templateId, workspaceIdOf(auth)) : null
    if (parsed.data.templateId && !template) {
        return res.status(404).json({ message: 'Modelo não encontrado', code: 'TEMPLATE_NOT_FOUND' })
    }
    const blocks = parsed.data.blocks ?? template?.blocks ?? undefined

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
            theme: parsed.data.theme ?? template?.theme ?? undefined,
            themeCustom: toNullableJsonInput(parsed.data.themeCustom),
            sections: toNullableJsonInput(parsed.data.sections),
            backstageMedia: toNullableJsonInput(parsed.data.backstageMedia),
            differentialsMedia: toNullableJsonInput(parsed.data.differentialsMedia),
            videoSoundEnabled: parsed.data.videoSoundEnabled,
            sectionsConfig: toNullableJsonInput(parsed.data.sectionsConfig),
            blocks: toNullableJsonInput(blocks),
            templateId: template?.id,
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

    return res.status(201).json({ proposal: withPricedPackages(proposal) })
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

    if (parsed.data.heroVideoUrl && !isTrustedUploadUrl(parsed.data.heroVideoUrl, req)) {
        return res.status(400).json({ message: 'heroVideoUrl must be a trusted uploaded file URL' })
    }
    if (parsed.data.weddingPhotoUrl && !isTrustedUploadUrl(parsed.data.weddingPhotoUrl, req)) {
        return res.status(400).json({ message: 'weddingPhotoUrl must be a trusted uploaded file URL' })
    }
    if (firstUntrustedBlockUrl(parsed.data.blocks, req)) {
        return res.status(400).json({ message: 'Use apenas mídias enviadas pelo Lumen Deal nos blocos.', code: 'UNTRUSTED_MEDIA' })
    }

    const proposal = await verifyProposalOwnership(auth, id)
    if (!proposal) {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    const { packageIds, providerId: _providerId, templateId: _templateId, ...data } = parsed.data

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
            blocks: toNullableJsonInput(data.blocks),
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

    return res.json({ proposal: withPricedPackages(updated) })
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
