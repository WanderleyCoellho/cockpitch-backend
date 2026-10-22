import type { Prisma, ProposalResponse } from '@prisma/client'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { enqueueEmails, type QueuedEmail } from './email/outbox.js'

/**
 * Eventos que viram e-mail (spec email-notifications). As funções recebem o `tx` do evento:
 * a fila só recebe o e-mail se o evento for gravado.
 */

type Db = typeof prisma | Prisma.TransactionClient

const panelUrl = () => `${env.FRONTEND_URL}/proposals`
const proposalUrl = (slug: string) => `${env.FRONTEND_URL}/p/${encodeURIComponent(slug)}`

async function loadProposalContext(db: Db, proposalId: string) {
    return db.proposal.findUniqueOrThrow({
        where: { id: proposalId },
        select: {
            id: true,
            slug: true,
            clientName: true,
            provider: {
                select: {
                    name: true,
                    email: true,
                    whatsapp: true,
                    workspace: {
                        select: {
                            name: true,
                            brandColor: true,
                            members: { select: { userId: true, notifyOnOpen: true, notifyOnResponse: true, user: { select: { email: true } } } }
                        }
                    }
                }
            }
        }
    })
}

function brandOf(ctx: Awaited<ReturnType<typeof loadProposalContext>>) {
    return { companyName: ctx.provider.name || ctx.provider.workspace?.name || 'Sua empresa', brandColor: ctx.provider.workspace?.brandColor ?? null }
}

/** Primeira abertura do link pelo cliente: um aviso por pessoa da equipe, uma única vez por proposta. */
export async function notifyProposalOpened(db: Db, proposalId: string, openedAt = new Date()) {
    const ctx = await loadProposalContext(db, proposalId)
    const members = ctx.provider.workspace?.members.filter((m) => m.notifyOnOpen) ?? []
    return enqueueEmails(
        db,
        members.map((member) => ({
            to: member.user.email,
            template: 'proposal_opened',
            dedupeKey: `opened:${ctx.id}:${member.userId}`,
            payload: { ...brandOf(ctx), clientName: ctx.clientName, proposalUrl: proposalUrl(ctx.slug), panelUrl: panelUrl(), openedAt: openedAt.toISOString() }
        }))
    )
}

type SelectionSnapshot = { packageName?: string; optionals?: Array<{ name: string }> } | null

/** Resposta do cliente: aviso para a equipe e, no aceite, confirmação para quem aceitou. */
export async function notifyProposalResponse(db: Db, response: ProposalResponse) {
    const ctx = await loadProposalContext(db, response.proposalId)
    const brand = brandOf(ctx)
    const selection = response.selection as SelectionSnapshot
    const summary = {
        packageName: selection?.packageName ?? null,
        optionals: selection?.optionals?.map((o) => o.name) ?? [],
        totalCents: response.totalCents
    }

    const emails: QueuedEmail[] = (ctx.provider.workspace?.members.filter((m) => m.notifyOnResponse) ?? []).map((member) => ({
        to: member.user.email,
        template: 'proposal_response',
        dedupeKey: `response:${response.id}:${member.userId}`,
        // Responder o aviso escreve direto para o cliente.
        replyTo: response.signerEmail,
        payload: {
            ...brand,
            ...summary,
            type: response.type,
            clientName: ctx.clientName,
            signerName: response.signerName,
            signerEmail: response.signerEmail,
            signerDocument: response.signerDocument,
            message: response.message,
            panelUrl: panelUrl(),
            proposalUrl: proposalUrl(ctx.slug),
            at: response.createdAt.toISOString()
        }
    }))

    if (response.type === 'ACCEPTED') {
        emails.push({
            to: response.signerEmail,
            template: 'acceptance_confirmation',
            dedupeKey: `accepted-client:${response.id}`,
            replyTo: ctx.provider.email || null,
            payload: {
                ...brand,
                ...summary,
                clientName: ctx.clientName,
                signerName: response.signerName,
                proposalUrl: proposalUrl(ctx.slug),
                at: response.createdAt.toISOString(),
                hash: response.contentHash,
                companyEmail: ctx.provider.email || null,
                companyWhatsapp: ctx.provider.whatsapp || null
            }
        })
    }
    return enqueueEmails(db, emails)
}

/** Convite de equipe: o link chega por e-mail (o painel continua mostrando o link para copiar). */
export async function notifyTeamInvite(
    db: Db,
    input: { inviteId: string; email: string; role: 'OWNER' | 'ADMIN' | 'MEMBER'; expiresAt: Date; inviteUrl: string; workspaceId: string; invitedById: string }
) {
    const [workspace, inviter] = await Promise.all([
        db.workspace.findUniqueOrThrow({ where: { id: input.workspaceId }, select: { name: true, brandColor: true } }),
        db.user.findUnique({ where: { id: input.invitedById }, select: { name: true, email: true } })
    ])
    return enqueueEmails(db, [
        {
            to: input.email,
            template: 'team_invite',
            dedupeKey: `invite:${input.inviteId}`,
            replyTo: inviter?.email ?? null,
            payload: {
                companyName: workspace.name,
                brandColor: workspace.brandColor,
                inviterName: inviter?.name ?? null,
                role: input.role,
                inviteUrl: input.inviteUrl,
                expiresAt: input.expiresAt.toISOString()
            }
        }
    ])
}
