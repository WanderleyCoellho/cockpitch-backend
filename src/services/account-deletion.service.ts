import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { Prisma, WorkspaceRole } from '@prisma/client'
import type Stripe from 'stripe'
import { z } from 'zod'
import { env } from '../config/env.js'
import { HttpError } from '../lib/httpError.js'
import { prisma } from '../lib/prisma.js'
import { getStripe, PLAN_CATALOG } from '../lib/stripe.js'
import { enqueueEmails, kickEmailDispatch } from './email/outbox.js'
import { codeSchema } from './signature.service.js'
import { findLiveSubscription } from './stripe-billing.service.js'

/**
 * Exclusão da própria conta (LGPD, art. 18, VI).
 *
 * Para cada empresa de que a pessoa é dona e que tem outros membros, ela escolhe:
 * - TRANSFER: indica um membro como novo dono. A assinatura continua; o cartão do dono anterior sai do
 *   Stripe. O novo dono usa o período já pago e tem até 7 dias depois dele (ou 7 dias a partir de agora,
 *   se a cobrança já estiver atrasada) para cadastrar a forma de pagamento; senão, a assinatura é cancelada.
 * - CLOSE: encerra a empresa. Os membros ficam sem empresa e, no próximo acesso, criam uma nova (Grátis).
 * Empresa sem outros membros é sempre encerrada.
 *
 * Empresa encerrada: a assinatura e o cliente no Stripe são apagados; ficam só as propostas aceitas pelo
 * cliente (proposta + aceite + assinaturas = comprovante), pelo prazo legal. O resto sai.
 */

const DAY_MS = 24 * 60 * 60 * 1000
export const DELETION_CODE_TTL_MINUTES = 10
const CODE_MAX_ATTEMPTS = 5
const RESEND_SECONDS = 60
const MAX_CODES_PER_HOUR = 5
export const PAYMENT_GRACE_DAYS = 7

const ROLE_ORDER: Record<WorkspaceRole, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 }

export const deleteAccountSchema = z.object({
    code: codeSchema,
    confirm: z.literal('EXCLUIR', { error: 'Digite EXCLUIR para confirmar.' }),
    workspaces: z
        .array(
            z.discriminatedUnion('action', [
                z.object({ workspaceId: z.string().min(1).max(64), action: z.literal('TRANSFER'), newOwnerUserId: z.string().min(1).max(64) }),
                z.object({ workspaceId: z.string().min(1).max(64), action: z.literal('CLOSE') })
            ])
        )
        .max(50)
        .default([])
})
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>

function hashCode(userId: string, code: string) {
    return createHash('sha256').update(`account-deletion:${userId}:${code}:${env.JWT_SECRET}`).digest('hex')
}

async function loadMemberships(userId: string) {
    return prisma.workspaceMember.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: {
            role: true,
            workspace: {
                select: {
                    id: true,
                    name: true,
                    brandColor: true,
                    planTier: true,
                    billingStatus: true,
                    licensePolicy: true,
                    stripeCustomerId: true,
                    members: { select: { userId: true, role: true, user: { select: { name: true, email: true } } } }
                }
            }
        }
    })
}

type Membership = Awaited<ReturnType<typeof loadMemberships>>[number]

/** O que a tela de exclusão mostra: empresas que pedem decisão e onde a pessoa é só membro. */
export async function describeAccountDeletion(userId: string) {
    const memberships = await loadMemberships(userId)
    return {
        owned: memberships
            .filter((m) => m.role === 'OWNER')
            .map(({ workspace }) => ({
                id: workspace.id,
                name: workspace.name,
                planTier: workspace.planTier,
                billingStatus: workspace.billingStatus,
                hasSubscription: !!workspace.stripeCustomerId && workspace.planTier !== 'FREE' && workspace.licensePolicy !== 'COURTESY',
                members: workspace.members
                    .filter((member) => member.userId !== userId)
                    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
                    .map((member) => ({ userId: member.userId, name: member.user.name, email: member.user.email, role: member.role }))
            })),
        memberOf: memberships.filter((m) => m.role !== 'OWNER').map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role }))
    }
}

/** Envia o código de confirmação ao e-mail da conta. Limites: 1 por minuto e 5 por hora. */
export async function requestAccountDeletionCode(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } })
    const now = Date.now()
    const recent = await prisma.accountDeletionCode.findMany({
        where: { userId, createdAt: { gt: new Date(now - 60 * 60 * 1000) } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
    })
    const last = recent[0]
    if (last && now - last.createdAt.getTime() < RESEND_SECONDS * 1000) {
        const wait = Math.ceil((RESEND_SECONDS * 1000 - (now - last.createdAt.getTime())) / 1000)
        throw new HttpError(429, `Aguarde ${wait} segundos para pedir um novo código.`, 'CODE_COOLDOWN')
    }
    if (recent.length >= MAX_CODES_PER_HOUR) throw new HttpError(429, 'Muitos códigos pedidos. Tente de novo em uma hora.', 'CODE_LIMIT')

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expiresAt = new Date(now + DELETION_CODE_TTL_MINUTES * 60 * 1000)
    await prisma.$transaction(async (tx) => {
        const row = await tx.accountDeletionCode.create({ data: { userId, codeHash: hashCode(userId, code), expiresAt } })
        await enqueueEmails(tx, [
            {
                to: user.email,
                template: 'account_deletion_code',
                dedupeKey: `account-deletion-code:${row.id}`,
                payload: { companyName: 'Lumen Deal', name: user.name, code, expiresMinutes: DELETION_CODE_TTL_MINUTES }
            }
        ])
    })
    kickEmailDispatch()
    return { sentTo: user.email, expiresAt: expiresAt.toISOString() }
}

async function consumeDeletionCode(userId: string, code: string) {
    const row = await prisma.accountDeletionCode.findFirst({ where: { userId, usedAt: null }, orderBy: { createdAt: 'desc' } })
    if (!row || row.expiresAt.getTime() < Date.now()) throw new HttpError(400, 'O código expirou ou não foi pedido. Peça um novo código.', 'CODE_EXPIRED')
    if (row.attempts >= CODE_MAX_ATTEMPTS) throw new HttpError(400, 'Muitas tentativas com este código. Peça um novo.', 'CODE_LOCKED')
    if (!timingSafeEqual(Buffer.from(row.codeHash, 'hex'), Buffer.from(hashCode(userId, code), 'hex'))) {
        await prisma.accountDeletionCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
        const left = CODE_MAX_ATTEMPTS - row.attempts - 1
        throw new HttpError(400, left > 0 ? `Código incorreto. ${left === 1 ? 'Resta 1 tentativa' : `Restam ${left} tentativas`}.` : 'Código incorreto. Peça um novo.', 'CODE_INVALID')
    }
    const used = await prisma.accountDeletionCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
    if (used.count === 0) throw new HttpError(400, 'Este código já foi usado. Peça um novo.', 'CODE_EXPIRED')
}

type Plan = {
    transfers: Array<{ membership: Membership; newOwner: Membership['workspace']['members'][number] }>
    closures: Membership[]
    memberOnly: Membership[]
}

/** Confere as decisões contra o estado atual das empresas (os membros podem ter mudado desde a tela). */
function buildPlan(userId: string, memberships: Membership[], decisions: DeleteAccountInput['workspaces']): Plan {
    const byId = new Map(decisions.map((d) => [d.workspaceId, d]))
    const plan: Plan = { transfers: [], closures: [], memberOnly: [] }
    for (const membership of memberships) {
        const { workspace } = membership
        if (membership.role !== 'OWNER') {
            plan.memberOnly.push(membership)
            continue
        }
        const others = workspace.members.filter((m) => m.userId !== userId)
        const decision = byId.get(workspace.id)
        if (others.length === 0) {
            plan.closures.push(membership)
            continue
        }
        if (!decision) {
            throw new HttpError(400, `Escolha o que fazer com a empresa ${workspace.name}: indicar um novo dono ou encerrar.`, 'DECISION_REQUIRED')
        }
        if (decision.action === 'CLOSE') {
            plan.closures.push(membership)
            continue
        }
        const newOwner = others.find((m) => m.userId === decision.newOwnerUserId)
        if (!newOwner) throw new HttpError(400, `O novo dono indicado não faz parte da empresa ${workspace.name}.`, 'INVALID_NEW_OWNER')
        plan.transfers.push({ membership, newOwner })
    }
    return plan
}

type TransferBilling = { planName: string | null; paidUntil: Date | null; graceUntil: Date | null }

function periodEndOf(sub: Stripe.Subscription): number | null {
    const legacy = (sub as unknown as { current_period_end?: number }).current_period_end
    const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined
    return legacy ?? item?.current_period_end ?? null
}

/**
 * Prepara a cobrança para o novo dono: e-mail do cliente no Stripe passa a ser o dele e as formas de
 * pagamento do dono anterior são removidas (ele não pode continuar pagando depois de sair).
 */
async function prepareTransferBilling(workspace: Membership['workspace'], newOwner: { userId: string; email: string }, now: Date): Promise<TransferBilling> {
    const customerId = workspace.stripeCustomerId
    if (!customerId || workspace.licensePolicy === 'COURTESY') return { planName: null, paidUntil: null, graceUntil: null }
    const stripe = getStripe()
    const methods = await stripe.customers.listPaymentMethods(customerId, { limit: 100 })
    for (const method of methods.data) await stripe.paymentMethods.detach(method.id)
    await stripe.customers.update(customerId, { email: newOwner.email, metadata: { workspaceId: workspace.id, ownerUserId: newOwner.userId } })

    const sub = await findLiveSubscription(customerId)
    if (!sub) return { planName: null, paidUntil: null, graceUntil: null }
    const planName = workspace.planTier !== 'FREE' ? PLAN_CATALOG[workspace.planTier].name : null
    const periodEnd = periodEndOf(sub)
    const inGoodStanding = sub.status === 'active' || sub.status === 'trialing'
    const paidUntil = inGoodStanding && periodEnd ? new Date(periodEnd * 1000) : null
    // Cancelamento já agendado: termina no fim do período, sem prazo extra.
    if (sub.cancel_at || sub.cancel_at_period_end) return { planName, paidUntil, graceUntil: null }
    const graceUntil = new Date((paidUntil ?? now).getTime() + PAYMENT_GRACE_DAYS * DAY_MS)
    return { planName, paidUntil, graceUntil }
}

/** Empresa encerrada: apagar o cliente no Stripe cancela a assinatura na hora e remove os cartões. */
async function closeBilling(workspace: Membership['workspace']) {
    if (!workspace.stripeCustomerId) return
    try {
        await getStripe().customers.del(workspace.stripeCustomerId)
    } catch (error) {
        if ((error as { code?: string }).code !== 'resource_missing') throw error
    }
}

async function closeWorkspace(tx: Prisma.TransactionClient, membership: Membership, userId: string) {
    const { workspace } = membership
    const providerIds = (await tx.provider.findMany({ where: { workspaceId: workspace.id }, select: { id: true } })).map((p) => p.id)
    const kept = (
        await tx.proposal.findMany({ where: { providerId: { in: providerIds }, responses: { some: { type: 'ACCEPTED' } } }, select: { id: true } })
    ).map((p) => p.id)

    await tx.proposal.deleteMany({ where: { providerId: { in: providerIds }, id: { notIn: kept } } })
    // Do que fica, só o necessário para o comprovante: o aceite e as assinaturas.
    await tx.proposalResponse.deleteMany({ where: { proposalId: { in: kept }, type: { not: 'ACCEPTED' } } })
    await tx.proposalView.deleteMany({ where: { proposalId: { in: kept } } })
    await tx.package.deleteMany({ where: { providerId: { in: providerIds }, proposals: { none: {} } } })
    await tx.provider.deleteMany({ where: { workspaceId: workspace.id, proposals: { none: {} } } })
    await tx.proposalTemplate.deleteMany({ where: { workspaceId: workspace.id } })
    await tx.savedBlock.deleteMany({ where: { workspaceId: workspace.id } })
    await tx.workspaceInvite.deleteMany({ where: { workspaceId: workspace.id } })

    const others = workspace.members.filter((m) => m.userId !== userId)
    await enqueueEmails(
        tx,
        others.map((member) => ({
            to: member.user.email,
            template: 'workspace_closed' as const,
            dedupeKey: `workspace-closed:${workspace.id}:${member.userId}`,
            payload: { companyName: workspace.name, brandColor: workspace.brandColor, name: member.user.name, panelUrl: `${env.FRONTEND_URL}/login` }
        }))
    )
    await tx.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } })

    if (kept.length === 0) {
        await tx.workspace.delete({ where: { id: workspace.id } })
        return
    }
    await tx.workspace.update({
        where: { id: workspace.id },
        data: {
            closedAt: new Date(),
            planTier: 'FREE',
            billingStatus: 'CANCELED',
            licensePolicy: 'STANDARD',
            licensePolicyNote: null,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            subscriptionCancelAt: null,
            paymentGraceUntil: null
        }
    })
    await tx.workspaceEvent.create({ data: { workspaceId: workspace.id, type: 'WORKSPACE_CLOSED', detail: { keptProposals: kept.length } } })
}

export async function deleteAccount(userId: string, input: DeleteAccountInput) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } })
    const memberships = await loadMemberships(userId)
    const plan = buildPlan(userId, memberships, input.workspaces)
    await consumeDeletionCode(userId, input.code)

    // Stripe antes do banco: se falhar, nada foi apagado e a pessoa tenta de novo (com outro código).
    // O contrário deixaria uma assinatura cobrando o cartão de quem já excluiu a conta.
    const now = new Date()
    const billing = new Map<string, TransferBilling>()
    try {
        for (const { membership, newOwner } of plan.transfers) {
            billing.set(membership.workspace.id, await prepareTransferBilling(membership.workspace, { userId: newOwner.userId, email: newOwner.user.email }, now))
        }
        for (const membership of plan.closures) await closeBilling(membership.workspace)
    } catch (error) {
        console.error('[conta] falha no Stripe ao excluir conta', { userId, error: error instanceof Error ? error.message : error })
        throw new HttpError(502, 'Não conseguimos atualizar a cobrança no Stripe, então a conta não foi excluída. Tente de novo em alguns minutos.', 'BILLING_UNAVAILABLE')
    }

    await prisma.$transaction(
        async (tx) => {
            for (const { membership, newOwner } of plan.transfers) {
                const { workspace } = membership
                const info = billing.get(workspace.id)!
                await tx.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: newOwner.userId } }, data: { role: 'OWNER' } })
                await tx.provider.updateMany({ where: { workspaceId: workspace.id, userId }, data: { userId: newOwner.userId } })
                await tx.workspace.update({ where: { id: workspace.id }, data: { paymentGraceUntil: info.graceUntil } })
                await tx.workspaceEvent.create({
                    data: { workspaceId: workspace.id, type: 'OWNERSHIP_TRANSFERRED', detail: { newOwnerUserId: newOwner.userId, graceUntil: info.graceUntil?.toISOString() ?? null } }
                })
                await enqueueEmails(tx, [
                    {
                        to: newOwner.user.email,
                        template: 'ownership_transferred',
                        dedupeKey: `ownership-transferred:${workspace.id}:${newOwner.userId}:${now.getTime()}`,
                        payload: {
                            companyName: workspace.name,
                            brandColor: workspace.brandColor,
                            name: newOwner.user.name,
                            previousOwnerName: user.name,
                            planName: info.planName,
                            paidUntil: info.paidUntil?.toISOString() ?? null,
                            graceUntil: info.graceUntil?.toISOString() ?? null,
                            billingUrl: `${env.FRONTEND_URL}/analytics`
                        }
                    }
                ])
            }

            // Perfis que a pessoa criou numa empresa que continua passam para o dono atual.
            for (const membership of plan.memberOnly) {
                const owner = membership.workspace.members.find((m) => m.role === 'OWNER' && m.userId !== userId)
                if (owner) await tx.provider.updateMany({ where: { workspaceId: membership.workspace.id, userId }, data: { userId: owner.userId } })
            }

            for (const membership of plan.closures) await closeWorkspace(tx, membership, userId)

            // E-mails para a própria pessoa: os pendentes não saem mais; os antigos ficam sem conteúdo.
            await tx.emailOutbox.deleteMany({ where: { to: user.email, status: 'PENDING' } })
            await tx.emailOutbox.updateMany({ where: { to: user.email }, data: { to: '', payload: {}, lastError: null } })
            await tx.signatureCode.deleteMany({ where: { email: user.email } })
            // Assinaturas que a pessoa fez em propostas ficam como evidência (art. 16, II; art. 7º, VI).
            await tx.user.delete({ where: { id: userId } })
        },
        { timeout: 30_000 }
    )
    kickEmailDispatch()
    console.log('[conta] conta excluída', { transfers: plan.transfers.length, closures: plan.closures.length, memberOnly: plan.memberOnly.length })
}
