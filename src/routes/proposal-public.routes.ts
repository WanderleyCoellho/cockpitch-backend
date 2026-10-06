import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { serializePackage } from '../services/package.service.js'
import { resolveEntitlements } from '../services/entitlements.js'
import { proposalResponseRateLimit } from '../middlewares/rateLimit.js'
import { acceptanceStateFor, responseInputSchema, submitProposalResponse } from '../services/proposal-response.service.js'

export const proposalPublicRouter = Router()

proposalPublicRouter.get('/proposals/:slug', async (req, res) => {
    const { slug } = req.params

    const proposal = await prisma.proposal.findUnique({
        where: { slug },
        include: {
            // Perfil público: sem userId nem timestamps internos.
            provider: {
                omit: { userId: true, createdAt: true, updatedAt: true },
                include: { workspace: { select: { planTier: true, billingStatus: true, licensePolicy: true } } }
            },
            packageIds: {
                include: { items: { orderBy: { order: 'asc' } } },
                orderBy: { order: 'asc' }
            }
        }
    })

    if (!proposal) {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    // Propostas arquivadas não ficam acessíveis pelo link público.
    if (proposal.status === 'ARQUIVADA') {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    // O plano da empresa só decide a marca "Feito com Lumen Deal"; nada do plano em si é exposto.
    const { workspace, ...provider } = proposal.provider
    const removeBranding = workspace ? resolveEntitlements(workspace).removeBranding : false
    return res.json({
        proposal: { ...proposal, provider, packageIds: proposal.packageIds.map(serializePackage) },
        acceptance: await acceptanceStateFor(proposal),
        branding: { removeBranding }
    })
})

// Aceite online: o cliente aceita, pede ajuste ou recusa (spec proposal-online-acceptance).
proposalPublicRouter.post('/proposals/:slug/responses', proposalResponseRateLimit, async (req, res) => {
    const parsed = responseInputSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Dados inválidos', issues: parsed.error.issues })
    }
    const response = await submitProposalResponse(String(req.params.slug), parsed.data, {
        ip: req.ip,
        userAgent: req.get('user-agent') ?? undefined
    })
    return res.status(201).json({
        response: {
            id: response.id,
            type: response.type,
            createdAt: response.createdAt,
            totalCents: response.totalCents,
            selection: response.selection,
            contentHash: response.contentHash
        }
    })
})
