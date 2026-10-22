import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { isTrustedUploadUrl } from '../lib/trustedUploadUrl.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { requireRole, requireWorkspace, workspaceIdOf } from '../middlewares/workspaceMiddleware.js'
import { blocksSchema, collectMediaUrls } from '../services/blocks.js'
import { planLimitError, resolveEntitlements } from '../services/entitlements.js'
import { listTemplates, MAX_WORKSPACE_TEMPLATES } from '../services/template.service.js'

const segmentSchema = z.enum([
    'PHOTO_VIDEO', 'EVENTS', 'AGENCY', 'CONSULTING', 'HEALTH_BEAUTY', 'CONSTRUCTION', 'EDUCATION', 'TECH', 'GENERAL'
])

const createTemplateSchema = z
    .object({
        name: z.string().trim().min(2).max(80),
        description: z.string().max(300).optional(),
        segment: segmentSchema.optional(),
        /** Salvar uma proposta existente como modelo (mais comum) ... */
        fromProposalId: z.string().cuid().optional(),
        /** ... ou enviar os blocos diretamente. */
        blocks: blocksSchema.optional(),
        theme: z.string().max(40).optional(),
        themeCustom: z.record(z.string(), z.any()).nullable().optional()
    })
    .refine((body) => body.fromProposalId || body.blocks, { message: 'Informe fromProposalId ou blocks' })

export const templateRouter = Router()

templateRouter.use(requireAuth, requireWorkspace)

templateRouter.get('/', async (req: AuthenticatedRequest, res) => {
    return res.json(await listTemplates(workspaceIdOf(req.auth)))
})

templateRouter.post('/', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const parsed = createTemplateSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const workspaceId = workspaceIdOf(req.auth)
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    if (!resolveEntitlements(workspace).customTemplates) {
        throw planLimitError('Modelos próprios estão disponíveis a partir do plano Profissional.')
    }
    if ((await prisma.proposalTemplate.count({ where: { workspaceId } })) >= MAX_WORKSPACE_TEMPLATES) {
        return res.status(400).json({ message: `Limite de ${MAX_WORKSPACE_TEMPLATES} modelos por empresa.`, code: 'TOO_MANY_TEMPLATES' })
    }

    let blocks = parsed.data.blocks
    let theme = parsed.data.theme
    let themeCustom = parsed.data.themeCustom
    if (parsed.data.fromProposalId) {
        const proposal = await prisma.proposal.findFirst({
            where: { id: parsed.data.fromProposalId, provider: { workspaceId } },
            select: { blocks: true, theme: true, themeCustom: true }
        })
        if (!proposal) return res.status(404).json({ message: 'Proposal not found' })
        const proposalBlocks = blocksSchema.safeParse(proposal.blocks)
        if (!proposal.blocks || !proposalBlocks.success) {
            return res.status(400).json({ message: 'Só propostas no formato de blocos podem virar modelo.', code: 'NOT_BLOCKS' })
        }
        blocks = proposalBlocks.data
        theme = theme ?? proposal.theme ?? undefined
        themeCustom = themeCustom ?? (proposal.themeCustom as Record<string, unknown> | null)
    }

    if (blocks && collectMediaUrls(blocks).some((url) => !isTrustedUploadUrl(url, req))) {
        return res.status(400).json({ message: 'Use apenas mídias enviadas pelo Lumen Deal.', code: 'UNTRUSTED_MEDIA' })
    }

    const template = await prisma.proposalTemplate.create({
        data: {
            workspaceId,
            name: parsed.data.name,
            description: parsed.data.description,
            segment: parsed.data.segment ?? workspace.segment,
            blocks: blocks as Prisma.InputJsonValue,
            theme,
            themeCustom: themeCustom === null ? Prisma.JsonNull : (themeCustom as Prisma.InputJsonValue | undefined)
        }
    })
    return res.status(201).json({ template: { ...template, system: false } })
})

templateRouter.delete('/:id', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const result = await prisma.proposalTemplate.deleteMany({ where: { id: req.params.id, workspaceId: workspaceIdOf(req.auth) } })
    if (result.count === 0) return res.status(404).json({ message: 'Template not found' })
    return res.status(204).send()
})
