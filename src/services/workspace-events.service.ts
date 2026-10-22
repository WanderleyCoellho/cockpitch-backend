import type { BillingStatus, PlanTier, Prisma, PrismaClient, WorkspaceEventType } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { PLAN_CATALOG } from '../lib/stripe.js'

type Db = PrismaClient | Prisma.TransactionClient

export type WorkspaceEventInput = { type: WorkspaceEventType; detail?: Prisma.InputJsonValue }

type BillingSnapshot = {
    planTier: PlanTier
    billingStatus: BillingStatus
    subscriptionCancelAt: Date | null
}

const isPaid = (s: BillingSnapshot) => s.planTier !== 'FREE' && (s.billingStatus === 'ACTIVE' || s.billingStatus === 'PAST_DUE')

/** Preço mensal do plano em centavos (catálogo atual). Grátis = 0. */
export function monthlyPriceCents(tier: PlanTier) {
    return tier === 'FREE' ? 0 : PLAN_CATALOG[tier].unitAmount
}

/** Traduz a mudança de cobrança (antes → depois) em eventos do histórico da empresa. */
export function billingEventsFor(prev: BillingSnapshot, next: BillingSnapshot): WorkspaceEventInput[] {
    const events: WorkspaceEventInput[] = []
    const wasPaid = isPaid(prev)
    const nowPaid = isPaid(next)

    if (!wasPaid && nowPaid) {
        events.push({ type: 'SUBSCRIBED', detail: { planTier: next.planTier } })
    } else if (wasPaid && !nowPaid) {
        events.push({ type: 'CANCELED', detail: { planTier: prev.planTier, priceCents: monthlyPriceCents(prev.planTier) } })
    } else if (wasPaid && nowPaid) {
        if (prev.planTier !== next.planTier) {
            events.push({ type: 'PLAN_CHANGED', detail: { from: prev.planTier, to: next.planTier } })
        }
        if (prev.billingStatus === 'ACTIVE' && next.billingStatus === 'PAST_DUE') events.push({ type: 'PAYMENT_FAILED' })
        if (prev.billingStatus === 'PAST_DUE' && next.billingStatus === 'ACTIVE') events.push({ type: 'PAYMENT_RECOVERED' })
    }

    if (nowPaid) {
        if (!prev.subscriptionCancelAt && next.subscriptionCancelAt) {
            events.push({ type: 'CANCEL_SCHEDULED', detail: { at: next.subscriptionCancelAt.toISOString() } })
        } else if (prev.subscriptionCancelAt && !next.subscriptionCancelAt) {
            events.push({ type: 'CANCEL_REVERTED' })
        }
    }
    return events
}

export async function recordWorkspaceEvents(workspaceId: string, events: WorkspaceEventInput[], db: Db = prisma) {
    if (!events.length) return
    await db.workspaceEvent.createMany({
        data: events.map((event) => ({ workspaceId, type: event.type, detail: event.detail }))
    })
}

type LicenseSnapshot = { planTier: PlanTier; billingStatus: BillingStatus; licensePolicy: 'STANDARD' | 'COURTESY' }

/** Mudança manual de licença feita pelo Ops (cortesia ou ajuste de plano). */
export function licenseEventsFor(prev: LicenseSnapshot, next: LicenseSnapshot, note?: string | null): WorkspaceEventInput[] {
    const base = { by: 'ops', ...(note ? { note } : {}) }
    if (prev.licensePolicy !== 'COURTESY' && next.licensePolicy === 'COURTESY') {
        return [{ type: 'COURTESY_GRANTED', detail: { ...base, planTier: next.planTier } }]
    }
    if (prev.licensePolicy === 'COURTESY' && next.licensePolicy !== 'COURTESY') {
        return [{ type: 'COURTESY_REVOKED', detail: base }]
    }
    if (prev.planTier !== next.planTier || prev.billingStatus !== next.billingStatus) {
        return [{
            type: 'LICENSE_CHANGED',
            detail: { ...base, from: prev.planTier, to: next.planTier, billingStatus: next.billingStatus }
        }]
    }
    return []
}
