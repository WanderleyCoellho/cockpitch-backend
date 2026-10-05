import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { env } from '../config/env.js'
import { isTrustedUploadUrl } from '../lib/trustedUploadUrl.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { requireRole, requireWorkspace, workspaceIdOf } from '../middlewares/workspaceMiddleware.js'
import { resolveEntitlements } from '../services/entitlements.js'
import { createInvite, getWorkspaceUsage, listUserWorkspaces } from '../services/workspace.service.js'

const segmentSchema = z.enum([
    'PHOTO_VIDEO', 'EVENTS', 'AGENCY', 'CONSULTING', 'HEALTH_BEAUTY', 'CONSTRUCTION', 'EDUCATION', 'TECH', 'GENERAL'
])

const updateWorkspaceSchema = z
    .object({
        name: z.string().trim().min(2).max(120).optional(),
        segment: segmentSchema.optional(),
        logoUrl: z.string().url().nullable().optional(),
        brandColor: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB')
            .nullable()
            .optional()
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' })

const inviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER')
})

const memberRoleSchema = z.object({ role: z.enum(['ADMIN', 'MEMBER']) })

export const workspaceRouter = Router()

workspaceRouter.use(requireAuth)

workspaceRouter.get('/', async (req: AuthenticatedRequest, res) => {
    return res.json({ workspaces: await listUserWorkspaces(req.auth!.userId) })
})

workspaceRouter.use('/current', requireWorkspace)

workspaceRouter.get('/current', async (req: AuthenticatedRequest, res) => {
    const workspaceId = workspaceIdOf(req.auth)
    const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: {
            id: true, name: true, slug: true, segment: true, logoUrl: true, brandColor: true, locale: true, currency: true,
            planTier: true, billingStatus: true, licensePolicy: true, licensePolicyNote: true, createdAt: true,
            providers: { select: { id: true }, orderBy: { createdAt: 'asc' }, take: 1 }
        }
    })
    const { providers, ...rest } = workspace
    return res.json({
        workspace: {
            ...rest,
            providerId: providers[0]?.id ?? null,
            role: req.auth!.workspaceRole,
            entitlements: resolveEntitlements(workspace),
            usage: await getWorkspaceUsage(workspaceId)
        }
    })
})

workspaceRouter.patch('/current', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const parsed = updateWorkspaceSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }
    if (parsed.data.logoUrl && !isTrustedUploadUrl(parsed.data.logoUrl, req)) {
        return res.status(400).json({ message: 'logoUrl must be a trusted uploaded file URL' })
    }

    const workspace = await prisma.workspace.update({
        where: { id: workspaceIdOf(req.auth) },
        data: parsed.data,
        select: { id: true, name: true, slug: true, segment: true, logoUrl: true, brandColor: true }
    })
    return res.json({ workspace })
})

workspaceRouter.get('/current/members', async (req: AuthenticatedRequest, res) => {
    const workspaceId = workspaceIdOf(req.auth)
    const canManage = req.auth!.workspaceRole !== 'MEMBER'

    const [members, invites] = await Promise.all([
        prisma.workspaceMember.findMany({
            where: { workspaceId },
            select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
            orderBy: { createdAt: 'asc' }
        }),
        canManage
            ? prisma.workspaceInvite.findMany({
                where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
                select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
                orderBy: { createdAt: 'desc' }
            })
            : Promise.resolve([])
    ])

    return res.json({ members, invites })
})

workspaceRouter.post('/current/invites', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const parsed = inviteSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const { invite, token } = await createInvite({
        workspaceId: workspaceIdOf(req.auth),
        email: parsed.data.email,
        role: parsed.data.role,
        invitedById: req.auth!.userId
    })

    // Até o envio por e-mail existir, o link é mostrado para a pessoa copiar e enviar.
    return res.status(201).json({ invite, inviteUrl: `${env.FRONTEND_URL}/convite/${token}` })
})

workspaceRouter.delete('/current/invites/:inviteId', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const result = await prisma.workspaceInvite.deleteMany({
        where: { id: req.params.inviteId, workspaceId: workspaceIdOf(req.auth), acceptedAt: null }
    })
    if (result.count === 0) {
        return res.status(404).json({ message: 'Invite not found' })
    }
    return res.status(204).send()
})

workspaceRouter.patch('/current/members/:memberId', requireRole('OWNER'), async (req: AuthenticatedRequest, res) => {
    const parsed = memberRoleSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const member = await prisma.workspaceMember.findFirst({
        where: { id: req.params.memberId, workspaceId: workspaceIdOf(req.auth) }
    })
    if (!member) {
        return res.status(404).json({ message: 'Member not found' })
    }
    if (member.role === 'OWNER') {
        return res.status(400).json({ message: 'O papel do dono não pode ser alterado.', code: 'OWNER_IMMUTABLE' })
    }

    const updated = await prisma.workspaceMember.update({
        where: { id: member.id },
        data: { role: parsed.data.role },
        select: { id: true, role: true }
    })
    return res.json({ member: updated })
})

workspaceRouter.delete('/current/members/:memberId', async (req: AuthenticatedRequest, res) => {
    const workspaceId = workspaceIdOf(req.auth)
    const actorRole = req.auth!.workspaceRole!
    const member = await prisma.workspaceMember.findFirst({ where: { id: req.params.memberId, workspaceId } })
    if (!member) {
        return res.status(404).json({ message: 'Member not found' })
    }

    const isSelf = member.userId === req.auth!.userId
    if (member.role === 'OWNER') {
        return res.status(400).json({ message: 'O dono não pode ser removido do workspace.', code: 'OWNER_IMMUTABLE' })
    }
    // Qualquer pessoa pode sair; o dono remove qualquer um; admin remove só membros.
    const allowed = isSelf || actorRole === 'OWNER' || (actorRole === 'ADMIN' && member.role === 'MEMBER')
    if (!allowed) {
        return res.status(403).json({ message: 'Você não tem permissão para esta ação.', code: 'FORBIDDEN_ROLE' })
    }

    await prisma.workspaceMember.delete({ where: { id: member.id } })
    return res.status(204).send()
})
