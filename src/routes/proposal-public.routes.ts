import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { serializePackage } from '../services/package.service.js'
import { resolveEntitlements } from '../services/entitlements.js'
import { proposalResponseRateLimit, signatureCodeRateLimit } from '../middlewares/rateLimit.js'
import { z } from 'zod'
import { HttpError } from '../lib/httpError.js'
import { acceptanceStateFor, findAcceptanceBlock, proposalExpiresAt, responseInputSchema, submitProposalResponse } from '../services/proposal-response.service.js'
import { sendSignatureCode, signaturesFor } from '../services/signature.service.js'

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
        // Assinaturas da empresa e do cliente, sem e-mail, IP nem CPF completo.
        signatures: await signaturesFor(proposal),
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

const codeRequestSchema = z.object({
    signerName: z.string().trim().min(3, 'Informe seu nome completo').max(120),
    signerEmail: z.string().trim().toLowerCase().email('E-mail inválido').max(200)
})

// Código de 6 dígitos para o cliente assinar o aceite (confirma que o e-mail é dele).
proposalPublicRouter.post('/proposals/:slug/signature-code', signatureCodeRateLimit, async (req, res) => {
    const parsed = codeRequestSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Dados inválidos', issues: parsed.error.issues })
    }
    const proposal = await prisma.proposal.findUnique({
        where: { slug: String(req.params.slug) },
        include: { provider: { include: { workspace: { select: { name: true, brandColor: true } } } } }
    })
    if (!proposal || proposal.status === 'ARQUIVADA') throw new HttpError(404, 'Proposta não encontrada.', 'NOT_FOUND')
    if (!findAcceptanceBlock(proposal.blocks)) throw new HttpError(409, 'Esta proposta não aceita respostas online.', 'NOT_ENABLED')
    if (proposal.status !== 'ABERTA') throw new HttpError(409, 'Esta proposta não está mais aberta para assinatura.', 'CLOSED')
    if (proposalExpiresAt(proposal).getTime() < Date.now()) throw new HttpError(409, 'O prazo desta proposta terminou.', 'EXPIRED')

    const sent = await sendSignatureCode({
        proposalId: proposal.id,
        role: 'CLIENT',
        email: parsed.data.signerEmail,
        name: parsed.data.signerName,
        companyName: proposal.provider.name || proposal.provider.workspace?.name || 'a empresa',
        brandColor: proposal.provider.workspace?.brandColor,
        clientName: proposal.clientName,
        ip: req.ip
    })
    return res.status(201).json({ sentTo: sent.email, expiresAt: sent.expiresAt })
})
