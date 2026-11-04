import { prisma } from '../lib/prisma.js'
import { getStripe } from '../lib/stripe.js'
import { syncStripeCustomer } from './stripe-billing.service.js'

/**
 * Prazo do novo dono (troca de dono por exclusão de conta): vencido o prazo, se a cobrança não estiver
 * em dia, a assinatura é cancelada e a empresa volta para o Grátis. Em dia, o prazo só é apagado.
 */
export async function enforcePaymentGrace(now = new Date()) {
    const due = await prisma.workspace.findMany({
        where: { paymentGraceUntil: { lt: now } },
        select: { id: true, stripeCustomerId: true, licensePolicy: true }
    })
    let canceled = 0
    for (const workspace of due) {
        try {
            if (workspace.stripeCustomerId && workspace.licensePolicy !== 'COURTESY') {
                // Lê o estado atual no Stripe antes de decidir (o webhook pode ter atrasado).
                const state = await syncStripeCustomer(workspace.stripeCustomerId)
                if (state && state.billingStatus !== 'ACTIVE' && state.stripeSubscriptionId && state.billingStatus !== 'CANCELED') {
                    try {
                        await getStripe().subscriptions.cancel(state.stripeSubscriptionId)
                    } catch (error) {
                        if ((error as { code?: string }).code !== 'resource_missing') throw error
                    }
                    await syncStripeCustomer(workspace.stripeCustomerId)
                    canceled += 1
                }
            }
            await prisma.workspace.update({ where: { id: workspace.id }, data: { paymentGraceUntil: null } })
        } catch (error) {
            // Tenta de novo na próxima rodada; uma empresa com problema não trava as outras.
            console.error('[cobranca] falha ao aplicar prazo do novo dono', { workspaceId: workspace.id, error: error instanceof Error ? error.message : error })
        }
    }
    return { checked: due.length, canceled }
}
