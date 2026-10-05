import type { BillingStatus, LicensePolicy, PlanTier, Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

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
    return db.workspace.update({ where: { id: workspace.id }, data })
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
