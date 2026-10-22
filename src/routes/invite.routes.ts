import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { publicWriteRateLimit } from '../middlewares/rateLimit.js'
import { acceptInvite, findValidInvite } from '../services/workspace.service.js'

export const inviteRouter = Router()

// Pré-visualização pública do convite (tela "Você foi convidado para...").
inviteRouter.get('/:token', publicWriteRateLimit, async (req: AuthenticatedRequest, res) => {
    const invite = await findValidInvite(req.params.token)
    return res.json({
        invite: {
            email: invite.email,
            role: invite.role,
            expiresAt: invite.expiresAt,
            workspace: { name: invite.workspace.name, logoUrl: invite.workspace.logoUrl }
        }
    })
})

inviteRouter.post('/:token/accept', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { id: true, email: true } })
    const workspaceId = await prisma.$transaction((tx) => acceptInvite(tx, req.params.token, user))
    return res.json({ workspaceId })
})
