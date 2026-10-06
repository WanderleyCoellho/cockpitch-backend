import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { publicWriteRateLimit } from '../middlewares/rateLimit.js'
import { verifyAccessToken } from '../lib/jwt.js'
import { kickEmailDispatch } from '../services/email/outbox.js'
import { notifyProposalOpened } from '../services/notifications.service.js'

const createProposalViewSchema = z.object({
    proposalId: z.string().cuid(),
    // Aceito por compatibilidade, mas ignorado: o slug é lido do banco.
    proposalSlug: z.string().optional(),
    sessionId: z.string().min(1).max(100)
})

export const proposalViewRouter = Router()

async function isTeamMember(authorization: string | undefined, workspaceId: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
    if (!token) return false
    try {
        const { userId } = verifyAccessToken(token)
        return !!(await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { id: true } }))
    } catch {
        return false
    }
}

// ProposalView é criado por endpoint público de visualização (não requer auth)
proposalViewRouter.post('/', publicWriteRateLimit, async (req, res) => {
    const parsed = createProposalViewSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const proposal = await prisma.proposal.findUnique({
        where: { id: parsed.data.proposalId },
        select: { id: true, slug: true, provider: { select: { workspaceId: true } } }
    })

    if (!proposal) {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    // Aberturas feitas pela própria equipe (logada no mesmo navegador) não contam nem geram aviso.
    if (proposal.provider.workspaceId && (await isTeamMember(req.get('authorization'), proposal.provider.workspaceId))) {
        return res.status(204).send()
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

    // "Primeira abertura": o dedupe da fila garante um único aviso por proposta e pessoa.
    await notifyProposalOpened(prisma, proposal.id, view.viewedAt)
    kickEmailDispatch()

    return res.status(201).json({ view })
})
