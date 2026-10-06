import cron from 'node-cron'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { syncStripeCustomer } from '../services/stripe-billing.service.js'

type ReconcileResult = {
    total: number
    updated: number
    unchanged: number
    failed: number
    skippedCourtesy: number
}

let lastRun: { at: string; result: ReconcileResult } | null = null

/** Última conferência completa deste processo (painel Ops). Zera a cada deploy. */
export function getLastReconciliation() {
    return lastRun
}

export async function runBillingReconciliationOnce(): Promise<ReconcileResult> {
    // O plano pertence ao workspace (cliente Stripe = workspace).
    const users = await prisma.workspace.findMany({
        where: { stripeCustomerId: { not: null } },
        select: {
            id: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            planTier: true,
            billingStatus: true,
            licensePolicy: true
        }
    })

    const result: ReconcileResult = {
        total: users.length,
        updated: 0,
        unchanged: 0,
        failed: 0,
        skippedCourtesy: 0
    }

    for (const user of users) {
        try {
            if (user.licensePolicy === 'COURTESY') {
                result.skippedCourtesy += 1
                continue
            }

            const customerId = user.stripeCustomerId
            const synced = customerId ? await syncStripeCustomer(customerId) : null
            if (!synced?.changed) {
                result.unchanged += 1
                continue
            }

            result.updated += 1
        } catch (error) {
            result.failed += 1
            console.error('[billing-reconciliation] failed for workspace', user.id, error)
        }
    }

    console.log('[billing-reconciliation] done', result)
    lastRun = { at: new Date().toISOString(), result }
    return result
}

export function startBillingReconciliationJob() {
    if (!env.BILLING_RECONCILIATION_ENABLED) {
        console.log('[billing-reconciliation] disabled')
        return
    }

    const cronExpr = env.BILLING_RECONCILIATION_CRON
    if (!cron.validate(cronExpr)) {
        console.error('[billing-reconciliation] invalid cron expression:', cronExpr)
        return
    }

    cron.schedule(cronExpr, async () => {
        await runBillingReconciliationOnce()
    })

    console.log('[billing-reconciliation] scheduled with', cronExpr)
}
