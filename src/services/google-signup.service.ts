import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import type { User, WorkspaceSegment } from '@prisma/client'
import { env } from '../config/env.js'
import { HttpError } from '../lib/httpError.js'
import { prisma } from '../lib/prisma.js'
import { enqueueEmails, kickEmailDispatch } from './email/outbox.js'
import { acceptInviteById, createWorkspaceWithOwner } from './workspace.service.js'

/**
 * Primeiro login com Google (conta nova ou já existente com senha): ninguém entra até abrir o link
 * enviado ao e-mail e criar uma senha. Ao vincular uma conta existente, a senha anterior é trocada e as
 * sessões abertas caem — quem cadastrou o e-mail de outra pessoa com senha perde o acesso.
 */

export const CONFIRMATION_TTL_HOURS = 24
const RESEND_SECONDS = 60
const MAX_PER_HOUR = 5

const INVALID_MESSAGE = 'Link inválido ou expirado. Entre com Google de novo para receber um novo link.'

function hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex')
}

export async function requestGoogleConfirmation(params: {
    google: { sub: string; email: string; name: string }
    existingUserId: string | null
    workspaceName?: string
    segment?: WorkspaceSegment
    inviteId?: string
}) {
    const email = params.google.email
    const now = Date.now()
    const recent = await prisma.googleSignupConfirmation.findMany({
        where: { email, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
    })
    const last = recent[0]
    if (last && now - last.createdAt.getTime() < RESEND_SECONDS * 1000) {
        const wait = Math.ceil((RESEND_SECONDS * 1000 - (now - last.createdAt.getTime())) / 1000)
        throw new HttpError(429, `Já enviamos o link para ${email}. Aguarde ${wait} segundos para pedir outro.`, 'CONFIRMATION_COOLDOWN')
    }
    if (recent.length >= MAX_PER_HOUR) {
        throw new HttpError(429, 'Muitos links pedidos para este e-mail. Tente de novo em uma hora.', 'CONFIRMATION_LIMIT')
    }

    const token = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(now + CONFIRMATION_TTL_HOURS * 60 * 60 * 1000)
    await prisma.$transaction(async (tx) => {
        // Só o link mais novo vale.
        await tx.googleSignupConfirmation.deleteMany({ where: { email, usedAt: null } })
        const row = await tx.googleSignupConfirmation.create({
            data: {
                tokenHash: hashToken(token),
                email,
                googleSub: params.google.sub,
                name: params.google.name,
                userId: params.existingUserId,
                workspaceName: params.workspaceName ?? null,
                segment: params.segment ?? null,
                inviteId: params.inviteId ?? null,
                expiresAt
            }
        })
        await enqueueEmails(tx, [
            {
                to: email,
                template: 'google_confirm',
                dedupeKey: `google-confirm:${row.id}`,
                payload: {
                    companyName: 'Lumen Deal',
                    name: params.google.name,
                    confirmUrl: `${env.FRONTEND_URL}/confirmar-conta/${token}`,
                    expiresHours: CONFIRMATION_TTL_HOURS,
                    linking: !!params.existingUserId
                }
            }
        ])
    })
    kickEmailDispatch()
    return { email, expiresAt }
}

async function findPending(token: string) {
    const row = await prisma.googleSignupConfirmation.findUnique({ where: { tokenHash: hashToken(token) } })
    if (!row || row.usedAt || row.expiresAt <= new Date()) throw new HttpError(404, INVALID_MESSAGE, 'CONFIRMATION_INVALID')
    return row
}

/** Dados para a tela "criar senha". */
export async function describeGoogleConfirmation(token: string) {
    const row = await findPending(token)
    return { email: row.email, name: row.name, newAccount: !row.userId, expiresAt: row.expiresAt }
}

/** Confere o link, grava a senha e cria ou vincula a conta. Devolve o usuário e a empresa em que entrou por convite. */
export async function confirmGoogleSignup(token: string, password: string): Promise<{ user: User; joinedWorkspaceId: string | null }> {
    const row = await findPending(token)
    const passwordHash = await bcrypt.hash(password, 12)

    return prisma.$transaction(async (tx) => {
        // Dois cliques simultâneos: só o primeiro usa o link.
        const claimed = await tx.googleSignupConfirmation.updateMany({
            where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
            data: { usedAt: new Date() }
        })
        if (claimed.count === 0) throw new HttpError(404, INVALID_MESSAGE, 'CONFIRMATION_INVALID')

        const subOwner = await tx.user.findUnique({ where: { googleSub: row.googleSub }, select: { id: true } })
        if (subOwner && subOwner.id !== row.userId) {
            throw new HttpError(409, 'Esta conta Google já está ligada a outro acesso. Entre com Google.', 'GOOGLE_ACCOUNT_CONFLICT')
        }

        let user: User
        if (row.userId) {
            const existing = await tx.user.findUnique({ where: { id: row.userId } })
            if (!existing || existing.email !== row.email) throw new HttpError(404, INVALID_MESSAGE, 'CONFIRMATION_INVALID')
            if (existing.googleSub && existing.googleSub !== row.googleSub) {
                throw new HttpError(409, 'Este e-mail já está ligado a outra conta Google.', 'GOOGLE_ACCOUNT_CONFLICT')
            }
            // Senha nova e sessões antigas encerradas: quem conhecia a senha anterior perde o acesso.
            user = await tx.user.update({
                where: { id: existing.id },
                data: { passwordHash, googleSub: row.googleSub, sessionsValidAfter: new Date() }
            })
        } else {
            if (await tx.user.findUnique({ where: { email: row.email }, select: { id: true } })) {
                throw new HttpError(409, 'Já existe uma conta com este e-mail. Entre com Google de novo para receber um novo link.', 'EMAIL_IN_USE')
            }
            user = await tx.user.create({
                data: { name: row.name, email: row.email, googleSub: row.googleSub, passwordHash, role: 'PROVIDER' }
            })
            if (!row.inviteId) {
                await createWorkspaceWithOwner(tx, {
                    userId: user.id,
                    ownerName: row.name,
                    ownerEmail: row.email,
                    workspaceName: row.workspaceName ?? row.name,
                    segment: row.segment ?? 'GENERAL'
                })
            }
        }

        let joinedWorkspaceId: string | null = null
        if (row.inviteId) {
            // Quem já é da equipe não consome o convite de novo (mesmo comportamento do login normal).
            const invite = await tx.workspaceInvite.findUnique({ where: { id: row.inviteId }, select: { workspaceId: true } })
            const already = invite
                ? await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } }, select: { id: true } })
                : null
            joinedWorkspaceId = already ? invite!.workspaceId : await acceptInviteById(tx, row.inviteId, { id: user.id, email: user.email })
        }
        return { user, joinedWorkspaceId }
    })
}
