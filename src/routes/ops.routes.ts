import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { ensureInternalAccess } from './internal.routes.js'
import {
    getOverview,
    getSystemStatus,
    getWorkspaceDetail,
    listPeople,
    listWorkspaces,
    PEOPLE_FILTERS,
    WORKSPACE_FILTERS
} from '../services/ops.service.js'
import { setWorkspaceLicense } from '../services/license.service.js'
import { syncStripeCustomer } from '../services/stripe-billing.service.js'
import { kickEmailDispatch } from '../services/email/outbox.js'

/** Painel Ops (spec ops-panel): leitura agregada e ações operacionais. Só com sessão do Ops. */
export const opsRouter = Router()

opsRouter.use((req: Request, res: Response, next: NextFunction) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) return
    next()
})

const overviewQuery = z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(365)])).default(30) })

const listQuery = <T extends readonly [string, ...string[]]>(filters: T) =>
    z.object({
        filter: z.enum(filters).default(filters[0]),
        q: z.string().trim().max(120).default(''),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        pageSize: z.coerce.number().int().min(5).max(100).default(25)
    })

const workspacesQuery = listQuery(WORKSPACE_FILTERS)
const peopleQuery = listQuery(PEOPLE_FILTERS)

const licenseBody = z.discriminatedUnion('licensePolicy', [
    z.object({
        licensePolicy: z.literal('COURTESY'),
        planTier: z.enum(['PRO', 'AGENCY']).default('PRO'),
        note: z.string().trim().max(500).optional()
    }),
    z.object({ licensePolicy: z.literal('STANDARD'), note: z.string().trim().max(500).optional() })
])

opsRouter.get('/overview', async (req, res) => {
    const parsed = overviewQuery.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: 'Período inválido (7, 30 ou 365 dias).' })
    return res.json(await getOverview(parsed.data.days))
})

opsRouter.get('/workspaces', async (req, res) => {
    const parsed = workspacesQuery.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: 'Filtro inválido.', issues: parsed.error.issues })
    return res.json(await listWorkspaces(parsed.data))
})

opsRouter.get('/workspaces/:id', async (req, res) => {
    const detail = await getWorkspaceDetail(req.params.id)
    if (!detail) return res.status(404).json({ message: 'Empresa não encontrada.' })
    return res.json(detail)
})

// Confere a assinatura no Stripe agora (sem esperar webhook ou reconciliação).
opsRouter.post('/workspaces/:id/sync', async (req, res) => {
    const workspace = await prisma.workspace.findUnique({ where: { id: req.params.id }, select: { stripeCustomerId: true, licensePolicy: true } })
    if (!workspace) return res.status(404).json({ message: 'Empresa não encontrada.' })
    if (!workspace.stripeCustomerId) return res.status(409).json({ message: 'Esta empresa ainda não tem cliente no Stripe.', code: 'NO_STRIPE_CUSTOMER' })
    if (workspace.licensePolicy === 'COURTESY') return res.status(409).json({ message: 'Empresa em cortesia: o Stripe não altera o plano.', code: 'COURTESY' })
    const result = await syncStripeCustomer(workspace.stripeCustomerId)
    return res.json({ changed: result?.changed ?? false, detail: await getWorkspaceDetail(req.params.id) })
})

// Conceder ou retirar cortesia da empresa.
opsRouter.patch('/workspaces/:id/license', async (req, res) => {
    const parsed = licenseBody.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'Dados inválidos.', issues: parsed.error.issues })
    const workspace = await prisma.workspace.findUnique({ where: { id: req.params.id } })
    if (!workspace) return res.status(404).json({ message: 'Empresa não encontrada.' })

    if (parsed.data.licensePolicy === 'COURTESY') {
        await setWorkspaceLicense(workspace.id, {
            licensePolicy: 'COURTESY',
            planTier: parsed.data.planTier,
            billingStatus: 'ACTIVE',
            licensePolicyNote: parsed.data.note ?? null
        })
    } else {
        // Sem cortesia: volta ao Grátis e, se a empresa tem cliente no Stripe, assume o que estiver lá.
        await setWorkspaceLicense(workspace.id, {
            licensePolicy: 'STANDARD',
            planTier: 'FREE',
            billingStatus: 'INACTIVE',
            stripeSubscriptionId: null,
            licensePolicyNote: parsed.data.note ?? null
        })
        if (workspace.stripeCustomerId) {
            await syncStripeCustomer(workspace.stripeCustomerId).catch((error) => {
                console.error('[ops] falha ao sincronizar após retirar cortesia', error)
            })
        }
    }
    return res.json(await getWorkspaceDetail(workspace.id))
})

opsRouter.get('/people', async (req, res) => {
    const parsed = peopleQuery.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: 'Filtro inválido.', issues: parsed.error.issues })
    return res.json(await listPeople(parsed.data))
})

opsRouter.get('/system', async (_req, res) => {
    return res.json(await getSystemStatus())
})

// Recoloca na fila um e-mail que esgotou as tentativas.
opsRouter.post('/emails/:id/retry', async (req, res) => {
    const updated = await prisma.emailOutbox.updateMany({
        where: { id: req.params.id, status: 'FAILED' },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null }
    })
    if (updated.count === 0) return res.status(409).json({ message: 'Só e-mails que falharam podem ser reenviados.' })
    kickEmailDispatch()
    return res.json({ queued: true })
})
