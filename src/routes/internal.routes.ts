import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { runBillingReconciliationOnce } from '../jobs/billingReconciliation.job.js'
import { verifyOpsAccessToken } from '../lib/opsJwt.js'
import { getCookieValue } from '../lib/httpCookies.js'
import { prisma } from '../lib/prisma.js'
import { syncOwnedWorkspaceLicense } from '../services/license.service.js'
import path from 'path'
import fs from 'fs'
import { legacyReceiptUploadsDir, receiptFilePath, receiptUploadsDir } from '../lib/receiptStorage.js'
import { getStorage, isValidObjectKey, PRIVATE_PREFIX } from '../lib/storage/index.js'

export const internalRouter = Router()

let lastManualRunAt = 0
let isManualRunInProgress = false
const agentHeartbeats = new Map<string, { status: 'ok' | 'degraded' | 'down'; notes: string; at: string }>()

const manualLicenseUpdateSchema = z
    .object({
        planTier: z.enum(['FREE', 'STARTER', 'PRO', 'AGENCY']).optional(),
        billingStatus: z.enum(['INACTIVE', 'ACTIVE', 'PAST_DUE', 'CANCELED']).optional(),
        licensePolicy: z.enum(['STANDARD', 'COURTESY']).optional(),
        licensePolicyNote: z.string().max(500).optional(),
        notes: z.string().max(500).optional()
    })
    .refine((payload) => payload.planTier || payload.billingStatus || payload.licensePolicy, {
        message: 'At least one field is required: planTier, billingStatus or licensePolicy'
    })

const heartbeatSchema = z.object({
    agentId: z.string().min(2),
    status: z.enum(['ok', 'degraded', 'down']).default('ok'),
    notes: z.string().max(500).optional()
})

const planTierFilterSchema = z.enum(['FREE', 'STARTER', 'PRO', 'AGENCY'])
const billingStatusFilterSchema = z.enum(['INACTIVE', 'ACTIVE', 'PAST_DUE', 'CANCELED'])
const licensePolicyFilterSchema = z.enum(['STANDARD', 'COURTESY'])
const receiptStatusFilterSchema = z.enum([
    'SUBMITTED',
    'ANALYZED',
    'NEEDS_HUMAN_REVIEW',
    'APPROVED',
    'REJECTED'
])
const receiptRiskLevelFilterSchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])

const receiptAnalysisSchema = z.object({
    status: z.enum(['ANALYZED', 'NEEDS_HUMAN_REVIEW']),
    riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    analysisSummary: z.string().min(10).max(2000),
    extractedText: z.string().max(10000).optional(),
    detectedAmount: z.string().max(100).optional(),
    detectedTransferDate: z.string().max(100).optional(),
    payerName: z.string().max(200).optional(),
    recipientName: z.string().max(200).optional()
})

const receiptReviewSchema = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reviewerName: z.string().min(2).max(200),
    reviewerNotes: z.string().max(1000).optional()
})

const approveAndActivateSchema = z.object({
    reviewerName: z.string().min(2).max(200),
    reviewerNotes: z.string().max(1000).optional(),
    planTier: z.enum(['FREE', 'STARTER', 'PRO', 'AGENCY']),
    billingStatus: z.enum(['INACTIVE', 'ACTIVE', 'PAST_DUE', 'CANCELED']).default('ACTIVE'),
    licensePolicy: z.enum(['STANDARD', 'COURTESY']).default('STANDARD'),
    licensePolicyNote: z.string().max(500).optional(),
    notes: z.string().max(500).optional()
})

function getClientIp(rawIp: string | undefined): string {
    if (!rawIp) return 'unknown'
    return rawIp.replace('::ffff:', '')
}

function auditManualRun(payload: {
    status: 'success' | 'rejected' | 'failed'
    reason: string
    path: string
    method: string
    ip: string
    userAgent: string
    durationMs?: number
}) {
    console.log('[billing-reconciliation][manual]', {
        at: new Date().toISOString(),
        ...payload
    })
}

function ensureInternalAccess(req: Request, res: Response) {
    const header = req.headers.authorization
    const bearerToken = header && header.startsWith('Bearer ') ? header.replace('Bearer ', '').trim() : null
    const cookieToken = getCookieValue(req, env.OPS_COOKIE_NAME)
    const opsToken = bearerToken || cookieToken

    if (opsToken) {
        try {
            const payload = verifyOpsAccessToken(opsToken)
            if (payload.role === 'OPS_ADMIN') {
                return { ok: true as const }
            }
        } catch {
            return {
                ok: false as const,
                response: res.status(401).json({ message: 'Invalid ops token' })
            }
        }
    }

    if (!env.INTERNAL_API_KEY_FALLBACK_ENABLED) {
        return {
            ok: false as const,
            response: res.status(401).json({ message: 'Ops session token required' })
        }
    }

    const apiKey = req.headers['x-internal-api-key']

    if (!env.BILLING_RECONCILIATION_API_KEY) {
        return {
            ok: false as const,
            response: res.status(401).json({ message: 'Unauthorized' })
        }
    }

    if (typeof apiKey !== 'string' || apiKey !== env.BILLING_RECONCILIATION_API_KEY) {
        return {
            ok: false as const,
            response: res.status(401).json({ message: 'Unauthorized' })
        }
    }

    return { ok: true as const }
}

internalRouter.post('/billing/reconcile', async (req, res) => {
    const ip = getClientIp(req.ip)
    const userAgent = req.get('user-agent') ?? 'unknown'

    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        auditManualRun({
            status: 'rejected',
            reason: 'unauthorized_internal_access',
            path: req.path,
            method: req.method,
            ip,
            userAgent
        })
        return auth.response
    }

    if (isManualRunInProgress) {
        auditManualRun({
            status: 'rejected',
            reason: 'reconciliation_in_progress',
            path: req.path,
            method: req.method,
            ip,
            userAgent
        })
        return res.status(409).json({ message: 'Reconciliation is already running' })
    }

    const now = Date.now()
    const minIntervalMs = env.BILLING_RECONCILIATION_MIN_INTERVAL_SECONDS * 1000
    const elapsed = now - lastManualRunAt
    if (elapsed < minIntervalMs) {
        const retryAfterSec = Math.ceil((minIntervalMs - elapsed) / 1000)
        res.setHeader('Retry-After', String(retryAfterSec))
        auditManualRun({
            status: 'rejected',
            reason: 'rate_limited',
            path: req.path,
            method: req.method,
            ip,
            userAgent
        })
        return res.status(429).json({
            message: `Too many requests. Try again in ${retryAfterSec}s`
        })
    }

    const startedAt = Date.now()
    isManualRunInProgress = true

    try {
        const result = await runBillingReconciliationOnce()
        const durationMs = Date.now() - startedAt
        lastManualRunAt = Date.now()

        auditManualRun({
            status: 'success',
            reason: 'ok',
            path: req.path,
            method: req.method,
            ip,
            userAgent,
            durationMs
        })

        return res.status(200).json({
            message: 'Billing reconciliation executed',
            durationMs,
            result
        })
    } catch (error) {
        const durationMs = Date.now() - startedAt
        auditManualRun({
            status: 'failed',
            reason: 'unexpected_error',
            path: req.path,
            method: req.method,
            ip,
            userAgent,
            durationMs
        })
        console.error('[billing-reconciliation][manual] execution failed', error)
        return res.status(500).json({ message: 'Billing reconciliation failed' })
    } finally {
        isManualRunInProgress = false
    }
})

internalRouter.get('/licensing/summary', async (req, res) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        return auth.response
    }

    const users = await prisma.user.findMany({
        select: {
            planTier: true,
            billingStatus: true,
            licensePolicy: true
        }
    })

    const byPlan = users.reduce<Record<string, number>>((acc, user) => {
        acc[user.planTier] = (acc[user.planTier] ?? 0) + 1
        return acc
    }, {})

    const byBillingStatus = users.reduce<Record<string, number>>((acc, user) => {
        acc[user.billingStatus] = (acc[user.billingStatus] ?? 0) + 1
        return acc
    }, {})

    const byLicensePolicy = users.reduce<Record<string, number>>((acc, user) => {
        acc[user.licensePolicy] = (acc[user.licensePolicy] ?? 0) + 1
        return acc
    }, {})

    return res.json({
        totalUsers: users.length,
        byPlan,
        byBillingStatus,
        byLicensePolicy,
        generatedAt: new Date().toISOString()
    })
})

internalRouter.get('/licensing/users', async (req, res) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        return auth.response
    }

    const limitRaw = Number(req.query.limit)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50
    const planTier =
        typeof req.query.planTier === 'string'
            ? planTierFilterSchema.safeParse(req.query.planTier).data
            : undefined
    const billingStatus =
        typeof req.query.billingStatus === 'string'
            ? billingStatusFilterSchema.safeParse(req.query.billingStatus).data
            : undefined
    const licensePolicy =
        typeof req.query.licensePolicy === 'string'
            ? licensePolicyFilterSchema.safeParse(req.query.licensePolicy).data
            : undefined
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''

    const where: {
        planTier?: 'FREE' | 'STARTER' | 'PRO' | 'AGENCY'
        billingStatus?: 'INACTIVE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'
        licensePolicy?: 'STANDARD' | 'COURTESY'
        OR?: Array<
            | { email: { contains: string; mode: 'insensitive' } }
            | { name: { contains: string; mode: 'insensitive' } }
        >
    } = {}

    if (planTier) {
        where.planTier = planTier
    }

    if (billingStatus) {
        where.billingStatus = billingStatus
    }

    if (licensePolicy) {
        where.licensePolicy = licensePolicy
    }

    if (search) {
        where.OR = [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } }
        ]
    }

    const users = await prisma.user.findMany({
        where,
        select: {
            id: true,
            email: true,
            name: true,
            planTier: true,
            billingStatus: true,
            licensePolicy: true,
            licensePolicyNote: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            createdAt: true,
            updatedAt: true
        },
        take: limit,
        orderBy: { updatedAt: 'asc' }
    })

    return res.json({
        count: users.length,
        users
    })
})

internalRouter.patch('/licensing/users/:userId', async (req, res) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        return auth.response
    }

    const parsed = manualLicenseUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.userId } })
    if (!user) {
        return res.status(404).json({ message: 'User not found' })
    }

    const licenseData = {
        planTier: parsed.data.planTier,
        billingStatus: parsed.data.billingStatus,
        licensePolicy: parsed.data.licensePolicy,
        licensePolicyNote: parsed.data.licensePolicyNote
    }
    // Fonte da verdade: o workspace que a pessoa possui. User guarda o espelho exibido no Ops.
    await syncOwnedWorkspaceLicense(prisma, user.id, licenseData)
    const updated = await prisma.user.update({
        where: { id: user.id },
        data: licenseData,
        select: {
            id: true,
            email: true,
            name: true,
            planTier: true,
            billingStatus: true,
            licensePolicy: true,
            licensePolicyNote: true,
            updatedAt: true
        }
    })

    console.log('[licensing][manual-update]', {
        at: new Date().toISOString(),
        userId: updated.id,
        from: {
            planTier: user.planTier,
            billingStatus: user.billingStatus,
            licensePolicy: user.licensePolicy,
            licensePolicyNote: user.licensePolicyNote
        },
        to: {
            planTier: updated.planTier,
            billingStatus: updated.billingStatus,
            licensePolicy: updated.licensePolicy,
            licensePolicyNote: updated.licensePolicyNote
        },
        notes: parsed.data.notes ?? null,
        ip: getClientIp(req.ip),
        userAgent: req.get('user-agent') ?? 'unknown'
    })

    return res.json({
        message: 'License updated manually',
        user: updated
    })
})

internalRouter.get('/licensing/receipts', async (req, res) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        return auth.response
    }

    const limitRaw = Number(req.query.limit)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 50
    const status =
        typeof req.query.status === 'string'
            ? receiptStatusFilterSchema.safeParse(req.query.status).data
            : undefined
    const riskLevel =
        typeof req.query.riskLevel === 'string'
            ? receiptRiskLevelFilterSchema.safeParse(req.query.riskLevel).data
            : undefined
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''

    const receipts = await prisma.paymentReceipt.findMany({
        where: {
            status,
            riskLevel,
            user: search
                ? {
                    OR: [
                        { email: { contains: search, mode: 'insensitive' } },
                        { name: { contains: search, mode: 'insensitive' } }
                    ]
                }
                : undefined
        },
        select: {
            id: true,
            fileUrl: true,
            originalFilename: true,
            mimeType: true,
            status: true,
            riskLevel: true,
            analysisSummary: true,
            detectedAmount: true,
            detectedTransferDate: true,
            payerName: true,
            recipientName: true,
            reviewerName: true,
            reviewedAt: true,
            createdAt: true,
            updatedAt: true,
            user: {
                select: {
                    id: true,
                    email: true,
                    name: true,
                    planTier: true,
                    billingStatus: true,
                    licensePolicy: true
                }
            }
        },
        take: limit,
        orderBy: { createdAt: 'desc' }
    })

    return res.json({
        count: receipts.length,
        // A URL pública antiga deixa de valer: o arquivo só é lido pela rota autenticada abaixo.
        receipts: receipts.map((receipt) => ({ ...receipt, fileUrl: receiptFilePath(receipt.id) }))
    })
})

internalRouter.get('/licensing/receipts/:receiptId/file', async (req, res) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        return auth.response
    }

    const receipt = await prisma.paymentReceipt.findUnique({
        where: { id: req.params.receiptId },
        select: { storedFilename: true, mimeType: true, originalFilename: true }
    })
    if (!receipt) {
        return res.status(404).json({ message: 'Receipt not found' })
    }

    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')

    // Comprovantes atuais ficam no espaço privado do storage (chave "private/...").
    if (receipt.storedFilename.startsWith(PRIVATE_PREFIX) && isValidObjectKey(receipt.storedFilename)) {
        const storage = getStorage()
        if (storage.kind === 's3') {
            // URL assinada curta: o arquivo sai direto do bucket, só para quem tem sessão Ops.
            const url = await storage.getSignedReadUrl(receipt.storedFilename, 5 * 60)
            if (!url) return res.status(404).json({ message: 'Receipt file not found' })
            return res.redirect(302, url)
        }
        const localFile = storage.localPath(receipt.storedFilename)
        if (!localFile || !(await storage.exists(receipt.storedFilename))) {
            return res.status(404).json({ message: 'Receipt file not found' })
        }
        res.setHeader('Content-Type', receipt.mimeType)
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(receipt.originalFilename)}"`)
        return res.sendFile(localFile)
    }

    // Legado (disco do container). basename impede path traversal mesmo com storedFilename adulterado.
    const filename = path.basename(receipt.storedFilename)
    const candidates = [path.join(receiptUploadsDir, filename), path.join(legacyReceiptUploadsDir, filename)]
    const filePath = candidates.find((candidate) => fs.existsSync(candidate))
    if (!filePath) {
        return res.status(404).json({ message: 'Receipt file not found' })
    }

    res.setHeader('Content-Type', receipt.mimeType)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(receipt.originalFilename)}"`)
    return res.sendFile(filePath)
})

internalRouter.patch('/licensing/receipts/:receiptId/analyze', async (req, res) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        return auth.response
    }

    const parsed = receiptAnalysisSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const receipt = await prisma.paymentReceipt.findUnique({ where: { id: req.params.receiptId } })
    if (!receipt) {
        return res.status(404).json({ message: 'Receipt not found' })
    }

    const updated = await prisma.paymentReceipt.update({
        where: { id: receipt.id },
        data: {
            status: parsed.data.status,
            riskLevel: parsed.data.riskLevel,
            analysisSummary: parsed.data.analysisSummary,
            extractedText: parsed.data.extractedText,
            detectedAmount: parsed.data.detectedAmount,
            detectedTransferDate: parsed.data.detectedTransferDate,
            payerName: parsed.data.payerName,
            recipientName: parsed.data.recipientName
        },
        select: {
            id: true,
            status: true,
            riskLevel: true,
            analysisSummary: true,
            detectedAmount: true,
            detectedTransferDate: true,
            payerName: true,
            recipientName: true,
            updatedAt: true
        }
    })

    console.log('[licensing][receipt-analysis]', {
        at: new Date().toISOString(),
        receiptId: updated.id,
        status: updated.status,
        riskLevel: updated.riskLevel,
        ip: getClientIp(req.ip),
        userAgent: req.get('user-agent') ?? 'unknown'
    })

    return res.json({
        message: 'Receipt analysis recorded',
        receipt: updated
    })
})

internalRouter.patch('/licensing/receipts/:receiptId/review', async (req, res) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        return auth.response
    }

    const parsed = receiptReviewSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const receipt = await prisma.paymentReceipt.findUnique({ where: { id: req.params.receiptId } })
    if (!receipt) {
        return res.status(404).json({ message: 'Receipt not found' })
    }

    const updated = await prisma.paymentReceipt.update({
        where: { id: receipt.id },
        data: {
            status: parsed.data.decision,
            reviewerName: parsed.data.reviewerName,
            reviewerNotes: parsed.data.reviewerNotes,
            reviewedAt: new Date()
        },
        select: {
            id: true,
            status: true,
            reviewerName: true,
            reviewerNotes: true,
            reviewedAt: true,
            updatedAt: true
        }
    })

    console.log('[licensing][receipt-review]', {
        at: new Date().toISOString(),
        receiptId: updated.id,
        status: updated.status,
        reviewerName: updated.reviewerName,
        ip: getClientIp(req.ip),
        userAgent: req.get('user-agent') ?? 'unknown'
    })

    return res.json({
        message: 'Receipt review recorded',
        receipt: updated
    })
})

internalRouter.post('/licensing/receipts/:receiptId/approve-and-activate', async (req, res) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        return auth.response
    }

    const parsed = approveAndActivateSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const receipt = await prisma.paymentReceipt.findUnique({
        where: { id: req.params.receiptId },
        include: {
            user: {
                select: {
                    id: true,
                    planTier: true,
                    billingStatus: true,
                    licensePolicy: true,
                    licensePolicyNote: true
                }
            }
        }
    })

    if (!receipt) {
        return res.status(404).json({ message: 'Receipt not found' })
    }

    const result = await prisma.$transaction(async (tx) => {
        const updatedReceipt = await tx.paymentReceipt.update({
            where: { id: receipt.id },
            data: {
                status: 'APPROVED',
                reviewerName: parsed.data.reviewerName,
                reviewerNotes: parsed.data.reviewerNotes,
                reviewedAt: new Date()
            },
            select: {
                id: true,
                status: true,
                reviewerName: true,
                reviewerNotes: true,
                reviewedAt: true,
                updatedAt: true
            }
        })

        await syncOwnedWorkspaceLicense(tx, receipt.userId, {
            planTier: parsed.data.planTier,
            billingStatus: parsed.data.billingStatus,
            licensePolicy: parsed.data.licensePolicy,
            licensePolicyNote: parsed.data.licensePolicyNote
        })

        const updatedUser = await tx.user.update({
            where: { id: receipt.userId },
            data: {
                planTier: parsed.data.planTier,
                billingStatus: parsed.data.billingStatus,
                licensePolicy: parsed.data.licensePolicy,
                licensePolicyNote: parsed.data.licensePolicyNote
            },
            select: {
                id: true,
                email: true,
                name: true,
                planTier: true,
                billingStatus: true,
                licensePolicy: true,
                licensePolicyNote: true,
                updatedAt: true
            }
        })

        return { updatedReceipt, updatedUser }
    })

    console.log('[licensing][approve-and-activate]', {
        at: new Date().toISOString(),
        receiptId: result.updatedReceipt.id,
        userId: result.updatedUser.id,
        from: {
            planTier: receipt.user.planTier,
            billingStatus: receipt.user.billingStatus,
            licensePolicy: receipt.user.licensePolicy,
            licensePolicyNote: receipt.user.licensePolicyNote
        },
        to: {
            planTier: result.updatedUser.planTier,
            billingStatus: result.updatedUser.billingStatus,
            licensePolicy: result.updatedUser.licensePolicy,
            licensePolicyNote: result.updatedUser.licensePolicyNote
        },
        notes: parsed.data.notes ?? null,
        ip: getClientIp(req.ip),
        userAgent: req.get('user-agent') ?? 'unknown'
    })

    return res.json({
        message: 'Receipt approved and license activated',
        receipt: result.updatedReceipt,
        user: result.updatedUser
    })
})

internalRouter.post('/licensing/heartbeat', async (req, res) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        return auth.response
    }

    const parsed = heartbeatSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const heartbeat = {
        status: parsed.data.status,
        notes: parsed.data.notes ?? '',
        at: new Date().toISOString()
    }
    agentHeartbeats.set(parsed.data.agentId, heartbeat)

    console.log('[licensing][heartbeat]', {
        agentId: parsed.data.agentId,
        ...heartbeat,
        ip: getClientIp(req.ip),
        userAgent: req.get('user-agent') ?? 'unknown'
    })

    return res.status(202).json({
        message: 'Heartbeat recorded',
        agentId: parsed.data.agentId,
        heartbeat
    })
})

internalRouter.get('/licensing/heartbeat', async (req, res) => {
    const auth = ensureInternalAccess(req, res)
    if (!auth.ok) {
        return auth.response
    }

    const heartbeats = Array.from(agentHeartbeats.entries()).map(([agentId, heartbeat]) => ({
        agentId,
        ...heartbeat
    }))

    return res.json({
        count: heartbeats.length,
        heartbeats
    })
})
