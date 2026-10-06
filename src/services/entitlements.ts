import type { BillingStatus, LicensePolicy, PlanTier } from '@prisma/client'
import { HttpError } from '../lib/httpError.js'

/** Recursos e limites de cada plano. -1 = ilimitado. Fonte única (o frontend recebe isto pela API). */
export type Entitlements = {
    tier: PlanTier
    /** Plano efetivo considerando cobrança e cortesia (o que o cliente realmente pode usar). */
    effectiveTier: PlanTier
    isCourtesy: boolean
    proposalsPerMonth: number
    members: number
    storageGb: number
    removeBranding: boolean
    customTemplates: boolean
    emailNotifications: boolean
    analytics: boolean
}

const LIMITS: Record<PlanTier, Omit<Entitlements, 'tier' | 'effectiveTier' | 'isCourtesy'>> = {
    // Grátis inclui aceite online, PDF e avisos por e-mail (decisão de produto 2026-10-07): limita por volume e marca.
    FREE: { proposalsPerMonth: 3, members: 1, storageGb: 0.5, removeBranding: false, customTemplates: false, emailNotifications: true, analytics: false },
    STARTER: { proposalsPerMonth: 30, members: 1, storageGb: 5, removeBranding: true, customTemplates: false, emailNotifications: true, analytics: true },
    PRO: { proposalsPerMonth: -1, members: 3, storageGb: 20, removeBranding: true, customTemplates: true, emailNotifications: true, analytics: true },
    AGENCY: { proposalsPerMonth: -1, members: 10, storageGb: 100, removeBranding: true, customTemplates: true, emailNotifications: true, analytics: true }
}

export function resolveEntitlements(workspace: {
    planTier: PlanTier
    billingStatus: BillingStatus
    licensePolicy: LicensePolicy
}): Entitlements {
    const isCourtesy = workspace.licensePolicy === 'COURTESY'
    const hasPaidAccess = workspace.billingStatus === 'ACTIVE' || workspace.billingStatus === 'PAST_DUE'
    // Cortesia libera no mínimo o Profissional; plano pago sem cobrança ativa volta ao Grátis.
    const effectiveTier: PlanTier = isCourtesy
        ? workspace.planTier === 'AGENCY' ? 'AGENCY' : 'PRO'
        : hasPaidAccess ? workspace.planTier : 'FREE'

    return { tier: workspace.planTier, effectiveTier, isCourtesy, ...LIMITS[effectiveTier] }
}

/** Erro padronizado de limite de plano: o frontend mostra o convite para fazer upgrade. */
export function planLimitError(message: string) {
    return new HttpError(402, message, 'PLAN_LIMIT')
}

export function isUnlimited(limit: number) {
    return limit < 0
}
