import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { publicWriteRateLimit } from '../middlewares/rateLimit.js'

const createProposalViewSchema = z.object({
    proposalId: z.string().cuid(),
    // Aceito por compatibilidade, mas ignorado: o slug é lido do banco.
    proposalSlug: z.string().optional(),
    sessionId: z.string().min(1).max(100)
})

export const proposalViewRouter = Router()

// ProposalView é criado por endpoint público de visualização (não requer auth)
proposalViewRouter.post('/', publicWriteRateLimit, async (req, res) => {
    const parsed = createProposalViewSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const proposal = await prisma.proposal.findUnique({
        where: { id: parsed.data.proposalId },
        select: { id: true, slug: true }
    })

    if (!proposal) {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    // O horário é sempre o do servidor: o cliente não pode forjar visualizações no passado/futuro.
    const view = await prisma.proposalView.create({
        data: {
            proposalId: proposal.id,
            proposalSlug: proposal.slug,
            sessionId: parsed.data.sessionId,
            viewedAt: new Date()
        },
        select: { id: true, viewedAt: true }
    })

    return res.status(201).json({ view })
})
