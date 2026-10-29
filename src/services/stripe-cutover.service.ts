import { prisma } from '../lib/prisma.js'
import { getStripe } from '../lib/stripe.js'
import { setWorkspaceLicense } from './license.service.js'

/**
 * Virada do Stripe de teste para produção. Clientes criados com a chave de teste não existem com a
 * chave live: sem esta limpeza, quem "assinou" com cartão de teste continuaria com o plano pago.
 *
 * Para cada empresa com cliente Stripe que a chave atual não encontra:
 * - padrão: volta ao Grátis e desliga o cliente/assinatura antigos;
 * - cortesia: mantém a cortesia, só desliga o cliente/assinatura antigos.
 * Sem `apply`, só lista o que mudaria.
 */

export type CutoverRow = {
    workspaceId: string
    name: string
    customerId: string
    planTier: string
    billingStatus: string
    licensePolicy: string
    action: 'keep' | 'reset_to_free' | 'clear_ids'
}

async function customerExists(customerId: string) {
    try {
        const customer = await getStripe().customers.retrieve(customerId)
        return !('deleted' in customer && customer.deleted)
    } catch (error) {
        if ((error as { code?: string }).code === 'resource_missing') return false
        throw error
    }
}

export async function runStripeCutover(options: { apply: boolean }) {
    const workspaces = await prisma.workspace.findMany({
        where: { stripeCustomerId: { not: null } },
        select: { id: true, name: true, stripeCustomerId: true, planTier: true, billingStatus: true, licensePolicy: true },
        orderBy: { createdAt: 'asc' }
    })

    const rows: CutoverRow[] = []
    for (const ws of workspaces) {
        const customerId = ws.stripeCustomerId!
        const exists = await customerExists(customerId)
        const action: CutoverRow['action'] = exists ? 'keep' : ws.licensePolicy === 'COURTESY' ? 'clear_ids' : 'reset_to_free'
        rows.push({ workspaceId: ws.id, name: ws.name, customerId, planTier: ws.planTier, billingStatus: ws.billingStatus, licensePolicy: ws.licensePolicy, action })
        if (!options.apply || action === 'keep') continue

        if (action === 'reset_to_free') {
            // Registra no histórico (como ajuste do Ops) e espelha nos donos.
            await setWorkspaceLicense(ws.id, {
                planTier: 'FREE',
                billingStatus: 'INACTIVE',
                stripeSubscriptionId: null,
                licensePolicyNote: 'Virada do Stripe para produção: assinatura de teste removida.'
            })
        }
        await prisma.$transaction([
            prisma.workspace.update({ where: { id: ws.id }, data: { stripeCustomerId: null, stripeSubscriptionId: null, subscriptionCancelAt: null } }),
            prisma.user.updateMany({ where: { stripeCustomerId: customerId }, data: { stripeCustomerId: null, stripeSubscriptionId: null } })
        ])
    }
    return rows
}
