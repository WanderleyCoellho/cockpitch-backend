import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { isTrustedUploadUrl } from '../lib/trustedUploadUrl.js'
import { generatedProposalSlug, PUBLIC_SLUG_RE } from '../lib/slug.js'
import { resolveEntitlements } from '../services/entitlements.js'
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

/**
 * Campo opcional vindo do painel: "" (campo limpo) e null (valor vazio que veio do banco) viram null,
 * o que apaga o valor ao editar em vez de recusar a proposta inteira.
 */
const emptyAsNull = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((value) => (value === '' ? null : value), schema.nullable().optional())

const createProposalSchema = z.object({
    providerId: z.string().cuid(),
    packageIds: z.array(z.string().cuid()).default([]),
    clientName: z.string().min(2),
    // Formato validado na rota (o link só é livre nos planos com link personalizado).
    slug: z.string().trim().toLowerCase().max(80).optional(),
    serviceDate: emptyAsNull(z.string().max(40)),
    validityDays: z.number().int().min(1).default(30),
    status: z.enum(['ABERTA', 'FECHADA', 'EXPIRADA', 'ARQUIVADA']).default('ABERTA'),
    commercialStatus: z
        .enum(['SEM_RESPOSTA', 'NEGOCIANDO', 'ACEITA', 'NEGADA', 'PERSONALIZADO'])
        .default('SEM_RESPOSTA'),
    heroVideoUrl: emptyAsNull(z.string().url()),
    weddingPhotoUrl: emptyAsNull(z.string().url()),
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

/**
 * Link personalizado já usado por outra proposta (de qualquer empresa, o link é público):
 * 409 com uma sugestão livre, em vez do erro genérico de registro duplicado.
 */
async function slugTaken(slug: string, exceptId?: string) {
    const exists = await prisma.proposal.findFirst({ where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } })
    if (!exists) return null
    const base = slug.slice(0, 76).replace(/-+$/, '')
    let suggestion = generatedProposalSlug(base)
    for (let n = 2; n <= 20; n++) {
        const candidate = `${base}-${n}`
        if (!(await prisma.proposal.findFirst({ where: { slug: candidate }, select: { id: true } }))) {
            suggestion = candidate
            break
        }
    }
    return { message: `O link /p/${slug} já está em uso. Que tal /p/${suggestion}?`, code: 'SLUG_TAKEN', suggestion }
}

export const proposalRouter = Router()

async function workspaceEntitlements(workspaceId: string) {
    return resolveEntitlements(await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
}

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
            views: true,
            _count: { select: { responses: true } },
            // Última resposta do cliente, para o resumo na lista ("aceita por Fulano em…").
            responses: { orderBy: { createdAt: 'desc' }, take: 1, select: { type: true, signerName: true, createdAt: true } }
        },
        orderBy: { createdAt: 'desc' }
    })

    return res.json({
        proposals: proposals.map(({ responses, _count, ...proposal }) => ({
            ...withPricedPackages(proposal),
            responsesCount: _count.responses,
            lastResponse: responses[0] ?? null
        }))
    })
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

    // Link público: personalizado nos planos Profissional/Equipe; nos demais, gerado pelo sistema.
    const { customSlug } = await workspaceEntitlements(workspaceIdOf(auth))
    let slug = generatedProposalSlug(parsed.data.clientName)
    if (customSlug && parsed.data.slug) {
        if (!PUBLIC_SLUG_RE.test(parsed.data.slug)) {
            return res.status(400).json({ message: 'Link inválido: use letras minúsculas, números e hífen (3 a 80).', code: 'INVALID_SLUG' })
        }
        slug = parsed.data.slug
        const taken = await slugTaken(slug)
        if (taken) return res.status(409).json(taken)
    }

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
            slug,
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

    if (data.slug !== undefined && data.slug !== proposal.slug) {
        if (!(await workspaceEntitlements(workspaceIdOf(auth))).customSlug) {
            return res.status(402).json({ message: 'Escolher o link da proposta é um recurso dos planos Profissional e Equipe.', code: 'PLAN_LIMIT' })
        }
        if (!PUBLIC_SLUG_RE.test(data.slug)) {
            return res.status(400).json({ message: 'Link inválido: use letras minúsculas, números e hífen (3 a 80).', code: 'INVALID_SLUG' })
        }
        const taken = await slugTaken(data.slug, proposal.id)
        if (taken) return res.status(409).json(taken)
    } else {
        delete data.slug
    }

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

// Respostas do cliente (aceite/ajuste/recusa), em ordem cronológica.
proposalRouter.get('/:id/responses', async (req: AuthenticatedRequest, res) => {
    const proposal = await verifyProposalOwnership(req.auth, req.params.id)
    if (!proposal) return res.status(404).json({ message: 'Proposal not found' })
    const responses = await prisma.proposalResponse.findMany({
        where: { proposalId: proposal.id },
        orderBy: { createdAt: 'asc' }
    })
    return res.json({ responses })
})

// Reabre uma proposta aceita/encerrada para novas respostas. O histórico continua guardado.
proposalRouter.post('/:id/reopen', async (req: AuthenticatedRequest, res) => {
    const proposal = await verifyProposalOwnership(req.auth, req.params.id)
    if (!proposal) return res.status(404).json({ message: 'Proposal not found' })
    if (proposal.status === 'ABERTA') return res.status(409).json({ message: 'A proposta já está aberta.', code: 'ALREADY_OPEN' })
    const updated = await prisma.proposal.update({
        where: { id: proposal.id },
        data: { status: 'ABERTA', commercialStatus: 'NEGOCIANDO' }
    })
    return res.json({ proposal: { id: updated.id, status: updated.status, commercialStatus: updated.commercialStatus } })
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

// Link copiado/compartilhado pelo painel: a proposta passa a contar como "enviada" no Analytics.
proposalRouter.post('/:id/shared', async (req: AuthenticatedRequest, res) => {
    const proposal = await verifyProposalOwnership(req.auth!, req.params.id)
    if (!proposal) return res.status(404).json({ message: 'Proposal not found' })
    const sharedAt = proposal.sharedAt ?? new Date()
    if (!proposal.sharedAt) await prisma.proposal.update({ where: { id: proposal.id }, data: { sharedAt } })
    return res.json({ sharedAt })
})
