import cron from 'node-cron'
import Stripe from 'stripe'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { mapBillingStatus, resolvePlanFromSubscription, type AppBillingStatus, type AppPlanTier } from '../lib/billing.js'

const stripe = new Stripe(env.STRIPE_SECRET_KEY)

type ReconcileResult = {
    total: number
    updated: number
    unchanged: number
    failed: number
    skippedCourtesy: number
}

function pickBestSubscription(subscriptions: Stripe.Subscription[]): Stripe.Subscription | null {
    if (!subscriptions.length) return null

    const activeLike = subscriptions.find((sub) =>
        ['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)
    )

    return activeLike ?? subscriptions[0]
}

function hasChanges(
    user: { planTier: AppPlanTier; billingStatus: AppBillingStatus; stripeSubscriptionId: string | null },
    next: { planTier: AppPlanTier; billingStatus: AppBillingStatus; stripeSubscriptionId: string | null }
): boolean {
    return (
        user.planTier !== next.planTier ||
        user.billingStatus !== next.billingStatus ||
        user.stripeSubscriptionId !== next.stripeSubscriptionId
    )
}

export async function runBillingReconciliationOnce(): Promise<ReconcileResult> {
    const users = await prisma.user.findMany({
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
            if (!customerId) {
                result.unchanged += 1
                continue
            }

            const listed = await stripe.subscriptions.list({
                customer: customerId,
                status: 'all',
                limit: 10
            })

            const subscription = pickBestSubscription(listed.data)

            const next = subscription
                ? {
                    stripeSubscriptionId: subscription.id,
                    billingStatus: mapBillingStatus(subscription.status),
                    planTier: resolvePlanFromSubscription(subscription)
                }
                : {
                    stripeSubscriptionId: null,
                    billingStatus: 'INACTIVE' as AppBillingStatus,
                    planTier: 'FREE' as AppPlanTier
                }

            if (!hasChanges(user, next)) {
                result.unchanged += 1
                continue
            }

            await prisma.user.update({
                where: { id: user.id },
                data: next
            })

            result.updated += 1
        } catch (error) {
            result.failed += 1
            console.error('[billing-reconciliation] failed for user', user.id, error)
        }
    }

    console.log('[billing-reconciliation] done', result)
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
