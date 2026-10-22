import type { BillingStatus, LicensePolicy, PlanTier, Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { licenseEventsFor, recordWorkspaceEvents } from './workspace-events.service.js'

type Db = PrismaClient | Prisma.TransactionClient

export type LicenseData = {
    planTier?: PlanTier
    billingStatus?: BillingStatus
    licensePolicy?: LicensePolicy
    licensePolicyNote?: string | null
    stripeSubscriptionId?: string | null
}

/**
 * O plano vive no Workspace (fonte da verdade). Os campos de licença em User são um ESPELHO do
 * workspace que a pessoa possui (o mais antigo como OWNER), mantido só para o painel Ops, que lista por pessoa.
 */
export async function findOwnedWorkspace(db: Db, userId: string) {
    const membership = await db.workspaceMember.findFirst({
        where: { userId, role: 'OWNER' },
        orderBy: { createdAt: 'asc' },
        select: { workspace: true }
    })
    return membership?.workspace ?? null
}

/** Ops altera a licença de uma pessoa → aplica no workspace que ela possui (o espelho em User é gravado por quem chama). */
export async function syncOwnedWorkspaceLicense(db: Db, userId: string, data: LicenseData) {
    const workspace = await findOwnedWorkspace(db, userId)
    if (!workspace) return null
    const updated = await db.workspace.update({ where: { id: workspace.id }, data })
    await recordWorkspaceEvents(workspace.id, licenseEventsFor(workspace, updated, data.licensePolicyNote), db)
    return updated
}

/** Webhook/reconciliação do Stripe: atualiza o workspace do cliente e espelha nos donos. Cortesia nunca é sobrescrita. */
export async function applyStripeBilling(customerId: string, data: LicenseData) {
    const workspaces = await prisma.workspace.findMany({
        where: { stripeCustomerId: customerId, licensePolicy: { not: 'COURTESY' } },
        select: { id: true }
    })
    if (workspaces.length === 0) return 0

    const ids = workspaces.map((w) => w.id)
    await prisma.$transaction([
        prisma.workspace.updateMany({ where: { id: { in: ids } }, data }),
        prisma.user.updateMany({
            where: { memberships: { some: { workspaceId: { in: ids }, role: 'OWNER' } }, licensePolicy: { not: 'COURTESY' } },
            data: {
                planTier: data.planTier,
                billingStatus: data.billingStatus,
                stripeSubscriptionId: data.stripeSubscriptionId
            }
        })
    ])
    return ids.length
}

/**
 * Ops altera a licença de uma EMPRESA (cortesia, ajuste manual). Espelha nos donos cuja empresa
 * principal é esta e registra no histórico. Retirar a cortesia devolve a empresa ao estado do Stripe
 * (quem chama sincroniza) ou ao Grátis, se ela nunca assinou.
 */
export async function setWorkspaceLicense(workspaceId: string, data: LicenseData) {
    return prisma.$transaction(async (tx) => {
        const before = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
        const updated = await tx.workspace.update({ where: { id: workspaceId }, data })
        const owners = await tx.workspaceMember.findMany({ where: { workspaceId, role: 'OWNER' }, select: { userId: true } })
        for (const { userId } of owners) {
            const main = await findOwnedWorkspace(tx, userId)
            if (main?.id !== workspaceId) continue
            await tx.user.update({
                where: { id: userId },
                data: {
                    planTier: updated.planTier,
                    billingStatus: updated.billingStatus,
                    licensePolicy: updated.licensePolicy,
                    licensePolicyNote: updated.licensePolicyNote
                }
            })
        }
        await recordWorkspaceEvents(workspaceId, licenseEventsFor(before, updated, data.licensePolicyNote), tx)
        return updated
    })
}
