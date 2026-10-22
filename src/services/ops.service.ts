import type { Prisma } from '@prisma/client'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { ensureCatalogPrices, PLAN_CATALOG } from '../lib/stripe.js'
import { getLastReconciliation } from '../jobs/billingReconciliation.job.js'
import { resolveEntitlements } from './entitlements.js'
import { getWorkspaceUsage } from './workspace.service.js'
import { monthlyPriceCents } from './workspace-events.service.js'

/**
 * Dados do painel Ops (spec ops-panel). Só leitura agregada; as ações ficam nas rotas.
 * "Pagante" = plano pago com cobrança ativa ou atrasada e sem cortesia.
 */
export const PAYING_WHERE: Prisma.WorkspaceWhereInput = {
    licensePolicy: 'STANDARD',
    planTier: { not: 'FREE' },
    billingStatus: { in: ['ACTIVE', 'PAST_DUE'] }
}

const PAID_TIERS = ['STARTER', 'PRO', 'AGENCY'] as const

export function stripeMode(): 'live' | 'test' | 'unconfigured' {
    const key = env.STRIPE_SECRET_KEY
    if (/^(sk|rk)_live_/.test(key)) return 'live'
    if (/^(sk|rk)_test_/.test(key)) return 'test'
    return 'unconfigured'
}

export function stripeDashboardUrl(path: string) {
    return `https://dashboard.stripe.com/${stripeMode() === 'test' ? 'test/' : ''}${path}`
}

export function loginMethodsOf(user: { passwordHash: string | null; googleSub: string | null }) {
    return [user.passwordHash ? 'PASSWORD' : null, user.googleSub ? 'GOOGLE' : null].filter(Boolean) as Array<'PASSWORD' | 'GOOGLE'>
}

const startOfMonth = () => {
    const date = new Date()
    date.setUTCDate(1)
    date.setUTCHours(0, 0, 0, 0)
    return date
}

/** Propostas aceitas: resposta de aceite online ou status comercial marcado como aceita. */
const acceptedProposal: Prisma.ProposalWhereInput = {
    OR: [{ commercialStatus: 'ACEITA' }, { responses: { some: { type: 'ACCEPTED' } } }]
}

// ---------- Visão geral ----------

export async function getOverview(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const cohort: Prisma.WorkspaceWhereInput = { createdAt: { gte: since } }

    const [
        totalWorkspaces,
        payingByTier,
        courtesy,
        pastDueCount,
        pastDue,
        newUsers,
        newGoogleUsers,
        periodEvents,
        canceledEvents,
        funnelCreated,
        funnelProposal,
        funnelOpened,
        funnelAccepted,
        funnelPaying,
        failedEmails,
        lastFailedEmail,
        pendingReceipts,
        oldestReceipt,
        recent
    ] = await Promise.all([
        prisma.workspace.count(),
        prisma.workspace.groupBy({ by: ['planTier'], where: PAYING_WHERE, _count: { _all: true } }),
        prisma.workspace.count({ where: { licensePolicy: 'COURTESY' } }),
        prisma.workspace.count({ where: { licensePolicy: 'STANDARD', billingStatus: 'PAST_DUE' } }),
        prisma.workspace.findMany({
            where: { licensePolicy: 'STANDARD', billingStatus: 'PAST_DUE' },
            select: { id: true, name: true },
            orderBy: { updatedAt: 'desc' },
            take: 5
        }),
        prisma.user.count({ where: { createdAt: { gte: since } } }),
        prisma.user.count({ where: { createdAt: { gte: since }, googleSub: { not: null } } }),
        prisma.workspaceEvent.groupBy({
            by: ['type'],
            where: { createdAt: { gte: since }, type: { in: ['SUBSCRIBED', 'CANCELED'] } },
            _count: { _all: true }
        }),
        prisma.workspaceEvent.findMany({ where: { createdAt: { gte: since }, type: 'CANCELED' }, select: { detail: true } }),
        prisma.workspace.count({ where: cohort }),
        prisma.workspace.count({ where: { ...cohort, providers: { some: { proposals: { some: {} } } } } }),
        prisma.workspace.count({ where: { ...cohort, providers: { some: { proposals: { some: { views: { some: {} } } } } } } }),
        prisma.workspace.count({ where: { ...cohort, providers: { some: { proposals: { some: acceptedProposal } } } } }),
        prisma.workspace.count({ where: { ...cohort, ...PAYING_WHERE } }),
        prisma.emailOutbox.count({ where: { status: 'FAILED' } }),
        prisma.emailOutbox.findFirst({
            where: { status: 'FAILED' },
            orderBy: { createdAt: 'desc' },
            select: { template: true, attempts: true, createdAt: true }
        }),
        prisma.paymentReceipt.count({ where: { status: { in: ['SUBMITTED', 'ANALYZED', 'NEEDS_HUMAN_REVIEW'] } } }),
        prisma.paymentReceipt.findFirst({
            where: { status: { in: ['SUBMITTED', 'ANALYZED', 'NEEDS_HUMAN_REVIEW'] } },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true }
        }),
        prisma.workspace.findMany({
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { id: true, name: true, segment: true, planTier: true, billingStatus: true, licensePolicy: true, createdAt: true }
        })
    ])

    const byTier = Object.fromEntries(PAID_TIERS.map((tier) => {
        const count = payingByTier.find((row) => row.planTier === tier)?._count._all ?? 0
        return [tier, { count, priceCents: monthlyPriceCents(tier), mrrCents: count * monthlyPriceCents(tier) }]
    })) as Record<(typeof PAID_TIERS)[number], { count: number; priceCents: number; mrrCents: number }>
    const subscribers = PAID_TIERS.reduce((sum, tier) => sum + byTier[tier].count, 0)
    const eventCount = (type: string) => periodEvents.find((row) => row.type === type)?._count._all ?? 0
    const canceledCents = canceledEvents.reduce((sum, event) => {
        const cents = (event.detail as { priceCents?: number } | null)?.priceCents
        return sum + (typeof cents === 'number' ? cents : 0)
    }, 0)

    return {
        days,
        generatedAt: new Date().toISOString(),
        stripeMode: stripeMode(),
        mrrCents: PAID_TIERS.reduce((sum, tier) => sum + byTier[tier].mrrCents, 0),
        subscribers,
        totalWorkspaces,
        free: Math.max(totalWorkspaces - subscribers - courtesy, 0),
        courtesy,
        byTier,
        newSubscriptions: eventCount('SUBSCRIBED'),
        newUsers,
        newGoogleUsers,
        cancellations: eventCount('CANCELED'),
        canceledMrrCents: canceledCents,
        pastDue: { count: pastDueCount, workspaces: pastDue },
        funnel: {
            created: funnelCreated,
            firstProposal: funnelProposal,
            opened: funnelOpened,
            accepted: funnelAccepted,
            paying: funnelPaying
        },
        attention: {
            failedEmails: { count: failedEmails, last: lastFailedEmail },
            pendingReceipts: { count: pendingReceipts, oldestAt: oldestReceipt?.createdAt ?? null }
        },
        recentWorkspaces: recent.map(({ planTier, billingStatus, licensePolicy, ...ws }) => {
            const entitlements = resolveEntitlements({ planTier, billingStatus, licensePolicy })
            return { ...ws, effectiveTier: entitlements.effectiveTier, isCourtesy: entitlements.isCourtesy }
        })
    }
}

// ---------- Empresas ----------

export const WORKSPACE_FILTERS = ['all', 'paying', 'free', 'courtesy', 'past_due'] as const
export type WorkspaceFilter = (typeof WORKSPACE_FILTERS)[number]

const workspaceFilterWhere: Record<WorkspaceFilter, Prisma.WorkspaceWhereInput> = {
    all: {},
    paying: PAYING_WHERE,
    free: { licensePolicy: 'STANDARD', NOT: PAYING_WHERE },
    courtesy: { licensePolicy: 'COURTESY' },
    past_due: { licensePolicy: 'STANDARD', billingStatus: 'PAST_DUE' }
}

export async function listWorkspaces(params: { filter: WorkspaceFilter; q: string; page: number; pageSize: number }) {
    const search: Prisma.WorkspaceWhereInput = params.q
        ? {
            OR: [
                { name: { contains: params.q, mode: 'insensitive' } },
                { members: { some: { user: { email: { contains: params.q, mode: 'insensitive' } } } } },
                { members: { some: { user: { name: { contains: params.q, mode: 'insensitive' } } } } }
            ]
        }
        : {}
    const where: Prisma.WorkspaceWhereInput = { AND: [workspaceFilterWhere[params.filter], search] }

    const [total, rows, ...counts] = await Promise.all([
        prisma.workspace.count({ where }),
        prisma.workspace.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (params.page - 1) * params.pageSize,
            take: params.pageSize,
            select: {
                id: true,
                name: true,
                segment: true,
                planTier: true,
                billingStatus: true,
                licensePolicy: true,
                subscriptionCancelAt: true,
                createdAt: true,
                _count: { select: { members: true } },
                members: {
                    where: { role: 'OWNER' },
                    orderBy: { createdAt: 'asc' },
                    take: 1,
                    select: { user: { select: { name: true, email: true } } }
                }
            }
        }),
        ...WORKSPACE_FILTERS.map((filter) => prisma.workspace.count({ where: workspaceFilterWhere[filter] }))
    ])

    const monthStart = startOfMonth()
    const items = await Promise.all(rows.map(async ({ _count, members, ...ws }) => {
        const entitlements = resolveEntitlements(ws)
        const proposalsThisMonth = await prisma.proposal.count({ where: { provider: { workspaceId: ws.id }, createdAt: { gte: monthStart } } })
        return {
            ...ws,
            effectiveTier: entitlements.effectiveTier,
            isCourtesy: entitlements.isCourtesy,
            owner: members[0]?.user ?? null,
            members: _count.members,
            memberLimit: entitlements.members,
            proposalsThisMonth,
            proposalLimit: entitlements.proposalsPerMonth
        }
    }))

    return {
        total,
        page: params.page,
        pageSize: params.pageSize,
        counts: Object.fromEntries(WORKSPACE_FILTERS.map((filter, index) => [filter, counts[index]])) as Record<WorkspaceFilter, number>,
        items
    }
}

export async function getWorkspaceDetail(id: string) {
    const workspace = await prisma.workspace.findUnique({
        where: { id },
        select: {
            id: true,
            name: true,
            slug: true,
            segment: true,
            planTier: true,
            billingStatus: true,
            licensePolicy: true,
            licensePolicyNote: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            subscriptionCancelAt: true,
            createdAt: true,
            members: {
                orderBy: { createdAt: 'asc' },
                select: {
                    role: true,
                    createdAt: true,
                    user: { select: { id: true, name: true, email: true, passwordHash: true, googleSub: true } }
                }
            },
            events: { orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, type: true, detail: true, createdAt: true } }
        }
    })
    if (!workspace) return null

    const inWorkspace: Prisma.ProposalWhereInput = { provider: { workspaceId: id } }
    const [usage, proposalsTotal, accepted, opens] = await Promise.all([
        getWorkspaceUsage(id),
        prisma.proposal.count({ where: inWorkspace }),
        prisma.proposal.count({ where: { AND: [inWorkspace, acceptedProposal] } }),
        prisma.proposalView.count({ where: { proposal: inWorkspace } })
    ])
    const entitlements = resolveEntitlements(workspace)
    const { members, stripeCustomerId, stripeSubscriptionId, ...rest } = workspace

    return {
        ...rest,
        entitlements,
        priceCents: monthlyPriceCents(workspace.planTier),
        members: members.map(({ user: { passwordHash, googleSub, ...user }, ...member }) => ({
            ...member,
            user: { ...user, loginMethods: loginMethodsOf({ passwordHash, googleSub }) }
        })),
        usage: { ...usage, proposalsTotal, accepted, opens },
        stripe: {
            mode: stripeMode(),
            customerId: stripeCustomerId,
            subscriptionId: stripeSubscriptionId,
            dashboardUrl: stripeCustomerId ? stripeDashboardUrl(`customers/${stripeCustomerId}`) : null
        }
    }
}

// ---------- Pessoas ----------

export const PEOPLE_FILTERS = ['all', 'owners', 'members', 'google', 'password'] as const
export type PeopleFilter = (typeof PEOPLE_FILTERS)[number]

const peopleFilterWhere: Record<PeopleFilter, Prisma.UserWhereInput> = {
    all: {},
    owners: { memberships: { some: { role: 'OWNER' } } },
    members: { memberships: { some: {}, none: { role: 'OWNER' } } },
    google: { googleSub: { not: null } },
    password: { googleSub: null, passwordHash: { not: null } }
}

export async function listPeople(params: { filter: PeopleFilter; q: string; page: number; pageSize: number }) {
    const search: Prisma.UserWhereInput = params.q
        ? { OR: [{ email: { contains: params.q, mode: 'insensitive' } }, { name: { contains: params.q, mode: 'insensitive' } }] }
        : {}
    const where: Prisma.UserWhereInput = { AND: [peopleFilterWhere[params.filter], search] }

    const [total, rows, ...counts] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (params.page - 1) * params.pageSize,
            take: params.pageSize,
            select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
                passwordHash: true,
                googleSub: true,
                memberships: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                        role: true,
                        workspace: { select: { id: true, name: true, planTier: true, billingStatus: true, licensePolicy: true } }
                    }
                }
            }
        }),
        ...PEOPLE_FILTERS.map((filter) => prisma.user.count({ where: peopleFilterWhere[filter] }))
    ])

    return {
        total,
        page: params.page,
        pageSize: params.pageSize,
        counts: Object.fromEntries(PEOPLE_FILTERS.map((filter, index) => [filter, counts[index]])) as Record<PeopleFilter, number>,
        items: rows.map(({ passwordHash, googleSub, memberships, ...user }) => ({
            ...user,
            loginMethods: loginMethodsOf({ passwordHash, googleSub }),
            memberships: memberships.map(({ role, workspace }) => {
                const entitlements = resolveEntitlements(workspace)
                return {
                    role,
                    workspaceId: workspace.id,
                    workspaceName: workspace.name,
                    effectiveTier: entitlements.effectiveTier,
                    isCourtesy: entitlements.isCourtesy
                }
            })
        }))
    }
}

// ---------- Sistema ----------

const processStartedAt = new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString()

async function databaseStatus() {
    try {
        const [row] = await prisma.$queryRaw<Array<{ applied: number; last: string | null }>>`
            SELECT count(*)::int AS applied, max(migration_name) AS last
            FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
        return { ok: true, migrations: row?.applied ?? 0, lastMigration: row?.last ?? null }
    } catch (error) {
        return { ok: false, migrations: 0, lastMigration: null, error: error instanceof Error ? error.message : String(error) }
    }
}

async function catalogStatus() {
    if (stripeMode() === 'unconfigured') return { ok: false, error: 'Chave do Stripe não configurada.', items: [] }
    try {
        const prices = await ensureCatalogPrices()
        return {
            ok: true,
            items: PAID_TIERS.map((tier) => ({
                tier,
                name: PLAN_CATALOG[tier].name,
                priceId: prices[tier].priceId,
                amountCents: PLAN_CATALOG[tier].unitAmount
            }))
        }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), items: [] }
    }
}

export async function getSystemStatus() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [database, sent24h, pending, failed, lastSent, recentEmails, catalog, webhookEvents, pendingReceipts, payingCount] = await Promise.all([
        databaseStatus(),
        prisma.emailOutbox.count({ where: { status: 'SENT', sentAt: { gte: dayAgo } } }),
        prisma.emailOutbox.count({ where: { status: 'PENDING' } }),
        prisma.emailOutbox.count({ where: { status: 'FAILED' } }),
        prisma.emailOutbox.findFirst({ where: { status: 'SENT' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
        prisma.emailOutbox.findMany({
            orderBy: { createdAt: 'desc' },
            take: 25,
            select: { id: true, to: true, template: true, status: true, attempts: true, lastError: true, createdAt: true, sentAt: true }
        }),
        catalogStatus(),
        prisma.stripeEventLog.findMany({ orderBy: { receivedAt: 'desc' }, take: 12 }),
        prisma.paymentReceipt.count({ where: { status: { in: ['SUBMITTED', 'ANALYZED', 'NEEDS_HUMAN_REVIEW'] } } }),
        prisma.workspace.count({ where: PAYING_WHERE })
    ])

    return {
        generatedAt: new Date().toISOString(),
        api: {
            ok: true,
            commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
            startedAt: processStartedAt,
            node: process.version,
            environment: env.NODE_ENV
        },
        database,
        email: {
            provider: env.RESEND_API_KEY ? 'resend' : 'console',
            jobEnabled: env.EMAIL_JOB_ENABLED,
            sent24h,
            pending,
            failed,
            lastSentAt: lastSent?.sentAt ?? null,
            recent: recentEmails.map((email) => ({ ...email, lastError: email.lastError?.slice(0, 300) ?? null }))
        },
        stripe: {
            mode: stripeMode(),
            dashboardUrl: stripeDashboardUrl('dashboard'),
            catalog,
            webhook: {
                lastReceivedAt: webhookEvents[0]?.receivedAt ?? null,
                recent: webhookEvents
            },
            reconciliation: {
                enabled: env.BILLING_RECONCILIATION_ENABLED,
                cron: env.BILLING_RECONCILIATION_CRON,
                payingWorkspaces: payingCount,
                lastRun: getLastReconciliation()
            }
        },
        receipts: { pending: pendingReceipts }
    }
}

