import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'

const createProposalViewSchema = z.object({
    proposalId: z.string().cuid(),
    proposalSlug: z.string().min(1),
    sessionId: z.string().min(1),
    viewedAt: z.string().datetime().optional()
})

export const proposalViewRouter = Router()

// ProposalView é criado por endpoint público de visualização (não requer auth)
proposalViewRouter.post('/', async (req, res) => {
    const parsed = createProposalViewSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    // Verificar se proposal existe
    const proposal = await prisma.proposal.findUnique({
        where: { id: parsed.data.proposalId }
    })

    if (!proposal) {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    const view = await prisma.proposalView.create({
        data: {
            proposalId: parsed.data.proposalId,
            proposalSlug: parsed.data.proposalSlug,
            sessionId: parsed.data.sessionId,
            viewedAt: parsed.data.viewedAt ? new Date(parsed.data.viewedAt) : new Date()
        }
    })

    return res.status(201).json({ view })
})
