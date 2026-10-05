import crypto from 'crypto'
import type { Prisma, WorkspaceRole, WorkspaceSegment } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { HttpError } from '../lib/httpError.js'
import { isUnlimited, planLimitError, resolveEntitlements } from './entitlements.js'

export const INVITE_TTL_DAYS = 7

type Tx = Prisma.TransactionClient

function slugify(value: string) {
    return (
        value
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'workspace'
    )
}

/** Slug único e legível (ex.: "estudio-ana-3f9k"). */
async function uniqueSlug(tx: Tx, name: string) {
    const base = slugify(name)
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`
        const exists = await tx.workspace.findUnique({ where: { slug: candidate }, select: { id: true } })
        if (!exists) return candidate
    }
    return `${base}-${crypto.randomBytes(8).toString('hex')}`
}

/** Cria o workspace, o dono e o perfil público (provider) numa transação. */
export async function createWorkspaceWithOwner(
    tx: Tx,
    input: { userId: string; ownerName: string; ownerEmail: string; workspaceName: string; segment: WorkspaceSegment }
) {
    const workspace = await tx.workspace.create({
        data: {
            name: input.workspaceName,
            slug: await uniqueSlug(tx, input.workspaceName),
            segment: input.segment,
            members: { create: { userId: input.userId, role: 'OWNER' } },
            providers: {
                create: { userId: input.userId, name: input.workspaceName, email: input.ownerEmail }
            }
        },
        include: { providers: true }
    })
    return workspace
}

export function hashInviteToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex')
}

export async function listUserWorkspaces(userId: string) {
    const memberships = await prisma.workspaceMember.findMany({
        where: { userId },
        include: {
            workspace: {
                select: {
                    id: true, name: true, slug: true, segment: true, logoUrl: true, brandColor: true,
                    planTier: true, billingStatus: true, licensePolicy: true, licensePolicyNote: true,
                    providers: { select: { id: true }, orderBy: { createdAt: 'asc' }, take: 1 }
                }
            }
        },
        orderBy: { createdAt: 'asc' }
    })
    return memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        segment: m.workspace.segment,
        logoUrl: m.workspace.logoUrl,
        brandColor: m.workspace.brandColor,
        role: m.role,
        planTier: m.workspace.planTier,
        billingStatus: m.workspace.billingStatus,
        licensePolicy: m.workspace.licensePolicy,
        licensePolicyNote: m.workspace.licensePolicyNote,
        providerId: m.workspace.providers[0]?.id ?? null,
        entitlements: resolveEntitlements(m.workspace)
    }))
}

/** Uso atual do mês (para limites e para exibir no painel). */
export async function getWorkspaceUsage(workspaceId: string) {
    const startOfMonth = new Date()
    startOfMonth.setUTCDate(1)
    startOfMonth.setUTCHours(0, 0, 0, 0)
    const [proposalsThisMonth, members, pendingInvites] = await Promise.all([
        prisma.proposal.count({ where: { provider: { workspaceId }, createdAt: { gte: startOfMonth } } }),
        prisma.workspaceMember.count({ where: { workspaceId } }),
        prisma.workspaceInvite.count({ where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } } })
    ])
    return { proposalsThisMonth, members, pendingInvites }
}

export async function assertCanCreateProposal(workspaceId: string) {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    const entitlements = resolveEntitlements(workspace)
    if (isUnlimited(entitlements.proposalsPerMonth)) return
    const { proposalsThisMonth } = await getWorkspaceUsage(workspaceId)
    if (proposalsThisMonth >= entitlements.proposalsPerMonth) {
        throw planLimitError(
            `Seu plano permite ${entitlements.proposalsPerMonth} propostas por mês. Faça upgrade para criar mais.`
        )
    }
}

export async function assertCanAddMember(workspaceId: string) {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    const entitlements = resolveEntitlements(workspace)
    const { members, pendingInvites } = await getWorkspaceUsage(workspaceId)
    if (members + pendingInvites >= entitlements.members) {
        throw planLimitError(
            entitlements.members === 1
                ? 'Seu plano é individual. Faça upgrade para o Profissional ou Equipe para convidar pessoas.'
                : `Seu plano permite ${entitlements.members} pessoas na equipe (incluindo convites pendentes).`
        )
    }
}

const ROLE_RANK: Record<WorkspaceRole, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 }

export function hasRole(actual: WorkspaceRole, required: WorkspaceRole) {
    return ROLE_RANK[actual] >= ROLE_RANK[required]
}

export async function createInvite(input: {
    workspaceId: string
    email: string
    role: Exclude<WorkspaceRole, 'OWNER'>
    invitedById: string
}) {
    const email = input.email.trim().toLowerCase()

    const alreadyMember = await prisma.workspaceMember.findFirst({
        where: { workspaceId: input.workspaceId, user: { email } },
        select: { id: true }
    })
    if (alreadyMember) throw new HttpError(409, 'Essa pessoa já faz parte da equipe.', 'ALREADY_MEMBER')

    // Reenviar convite para o mesmo e-mail substitui o pendente (não consome vaga extra).
    await prisma.workspaceInvite.deleteMany({ where: { workspaceId: input.workspaceId, email, acceptedAt: null } })
    await assertCanAddMember(input.workspaceId)

    const token = crypto.randomBytes(32).toString('base64url')
    const invite = await prisma.workspaceInvite.create({
        data: {
            workspaceId: input.workspaceId,
            email,
            role: input.role,
            tokenHash: hashInviteToken(token),
            expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
            invitedById: input.invitedById
        },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true }
    })
    return { invite, token }
}

export async function findValidInvite(token: string) {
    const invite = await prisma.workspaceInvite.findUnique({
        where: { tokenHash: hashInviteToken(token) },
        include: { workspace: { select: { id: true, name: true, logoUrl: true } } }
    })
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
        throw new HttpError(404, 'Convite inválido ou expirado. Peça um novo convite a quem te convidou.', 'INVITE_INVALID')
    }
    return invite
}

/** Aceita o convite: o e-mail do usuário precisa ser o convidado. Idempotente para quem já é membro. */
export async function acceptInvite(tx: Tx, token: string, user: { id: string; email: string }) {
    const invite = await tx.workspaceInvite.findUnique({ where: { tokenHash: hashInviteToken(token) } })
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
        throw new HttpError(404, 'Convite inválido ou expirado. Peça um novo convite a quem te convidou.', 'INVITE_INVALID')
    }
    if (invite.email !== user.email.trim().toLowerCase()) {
        throw new HttpError(403, `Este convite foi enviado para ${invite.email}. Entre com esse e-mail para aceitar.`, 'INVITE_EMAIL_MISMATCH')
    }

    // Marca como aceito só se ainda estiver pendente: dois cliques simultâneos não criam dois membros.
    const claimed = await tx.workspaceInvite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() }
    })
    if (claimed.count === 0) {
        throw new HttpError(409, 'Este convite já foi aceito.', 'INVITE_USED')
    }

    await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
        create: { workspaceId: invite.workspaceId, userId: user.id, role: invite.role },
        update: {}
    })
    return invite.workspaceId
}
