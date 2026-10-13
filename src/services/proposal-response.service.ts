import type { Package, PackageItem, Prisma, Proposal, ProposalResponseType } from '@prisma/client'
import { z } from 'zod'
import { HttpError } from '../lib/httpError.js'
import { prisma } from '../lib/prisma.js'
import { blockSchema } from './blocks.js'
import { toPricingInput } from './package.service.js'
import { calculatePackagePricing } from './pricing.js'
import { contentHashFor } from './content-hash.js'

export { contentHashFor }
import { kickEmailDispatch } from './email/outbox.js'
import { notifyProposalResponse } from './notifications.service.js'
import { codeSchema, consumeSignatureCode, cpfSchema, createClientSignature, signatureDrawingSchema } from './signature.service.js'

/**
 * Aceite online (spec proposal-online-acceptance).
 * O total é sempre recalculado aqui a partir do banco; o navegador só informa o que foi escolhido.
 */

const DAY_MS = 24 * 60 * 60 * 1000

const signer = {
    signerName: z.string().trim().min(3, 'Informe seu nome completo').max(120),
    signerEmail: z.string().trim().toLowerCase().email('E-mail inválido').max(200)
}
const selection = {
    packageId: z.string().cuid().optional(),
    optionalItemIds: z.array(z.string().cuid()).max(100).default([])
}

export const responseInputSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('ACCEPTED'),
        ...signer,
        ...selection,
        /** Aceitar = assinar: CPF, assinatura (desenhada ou digitada) e o código enviado ao e-mail. */
        signerDocument: cpfSchema,
        signature: signatureDrawingSchema,
        code: codeSchema,
        message: z.string().trim().max(2000).optional(),
        agreeTerms: z.literal(true, { errorMap: () => ({ message: 'É preciso concordar com as condições para aceitar.' }) })
    }),
    z.object({
        type: z.literal('CHANGE_REQUESTED'),
        ...signer,
        ...selection,
        message: z.string().trim().min(5, 'Conte o que você gostaria de ajustar').max(2000)
    }),
    z.object({
        type: z.literal('DECLINED'),
        ...signer,
        message: z.string().trim().max(2000).optional()
    })
])

export type ResponseInput = z.infer<typeof responseInputSchema>

type PackageWithItems = Package & { items: PackageItem[] }
type ProposalForResponse = Proposal & { packageIds: PackageWithItems[] }

export function proposalExpiresAt(proposal: Pick<Proposal, 'createdAt' | 'validityDays'>) {
    return new Date(proposal.createdAt.getTime() + proposal.validityDays * DAY_MS)
}

/** Bloco de aceite visível da proposta; sem ele o aceite online não está habilitado. */
export function findAcceptanceBlock(blocks: unknown) {
    if (!Array.isArray(blocks)) return null
    for (const raw of blocks) {
        const parsed = blockSchema.safeParse(raw)
        if (parsed.success && parsed.data.type === 'acceptance' && parsed.data.visible) return parsed.data
    }
    return null
}

export type AcceptanceState = {
    enabled: boolean
    state: 'OPEN' | 'ACCEPTED' | 'EXPIRED' | 'CLOSED'
    expiresAt: string
    acceptedAt?: string
    acceptedBy?: string
    /** O que foi aceito (para a página e o PDF); sem dados pessoais além do nome. */
    accepted?: {
        packageId: string | null
        optionalIds: string[]
        packageName: string | null
        optionals: string[]
        totalCents: number | null
        contentHash: string
    }
}

/** Estado exibido na página pública. Não expõe e-mail, documento nem IP de quem respondeu. */
export async function acceptanceStateFor(proposal: Proposal): Promise<AcceptanceState> {
    const expiresAt = proposalExpiresAt(proposal)
    const base = { enabled: !!findAcceptanceBlock(proposal.blocks), expiresAt: expiresAt.toISOString() }
    if (proposal.status !== 'ABERTA') {
        const accepted =
            proposal.status === 'FECHADA'
                ? await prisma.proposalResponse.findFirst({
                      where: { proposalId: proposal.id, type: 'ACCEPTED' },
                      orderBy: { createdAt: 'desc' },
                      select: { createdAt: true, signerName: true, selection: true, totalCents: true, contentHash: true }
                  })
                : null
        if (!accepted) return { ...base, state: 'CLOSED' }
        const selection = accepted.selection as { packageId?: string; packageName?: string; optionals?: Array<{ id: string; name: string }> } | null
        return {
            ...base,
            state: 'ACCEPTED',
            acceptedAt: accepted.createdAt.toISOString(),
            acceptedBy: accepted.signerName,
            accepted: {
                packageId: selection?.packageId ?? null,
                optionalIds: selection?.optionals?.map((o) => o.id) ?? [],
                packageName: selection?.packageName ?? null,
                optionals: selection?.optionals?.map((o) => o.name) ?? [],
                totalCents: accepted.totalCents,
                contentHash: accepted.contentHash
            }
        }
    }
    if (expiresAt.getTime() < Date.now()) return { ...base, state: 'EXPIRED' }
    return { ...base, state: 'OPEN' }
}

function resolveSelection(proposal: ProposalForResponse, packageId: string | undefined, optionalItemIds: string[], required: boolean) {
    const packages = proposal.packageIds
    const chosenId = packageId ?? (packages.length === 1 ? packages[0].id : undefined)
    if (!chosenId) {
        if (required && packages.length > 0) throw new HttpError(400, 'Escolha um dos pacotes da proposta.', 'PACKAGE_REQUIRED')
        if (optionalItemIds.length > 0) throw new HttpError(400, 'Opcionais precisam de um pacote escolhido.', 'INVALID_SELECTION')
        return { selection: null, totalCents: null }
    }

    const pkg = packages.find((p) => p.id === chosenId)
    if (!pkg) throw new HttpError(400, 'O pacote escolhido não faz parte desta proposta.', 'INVALID_SELECTION')
    const optionals = pkg.items.filter((item) => item.kind === 'OPTIONAL')
    const unique = [...new Set(optionalItemIds)]
    if (unique.some((id) => !optionals.some((item) => item.id === id))) {
        throw new HttpError(400, 'Algum opcional escolhido não pertence a este pacote.', 'INVALID_SELECTION')
    }

    const pricing = calculatePackagePricing(toPricingInput(pkg), unique)
    const chosen = optionals.filter((item) => unique.includes(item.id))
    return {
        totalCents: pricing.onRequest ? null : pricing.totalCents,
        selection: {
            packageId: pkg.id,
            packageName: pkg.name,
            optionals: chosen.map((item) => ({
                id: item.id,
                name: item.name,
                cents: pricing.lines.find((line) => line.id === item.id)?.lineCents ?? 0
            })),
            pricing: {
                onRequest: pricing.onRequest,
                baseCents: pricing.baseCents,
                optionalsCents: pricing.optionalsCents,
                discountCents: pricing.discountCents,
                totalCents: pricing.totalCents
            }
        }
    }
}

const COMMERCIAL_STATUS: Record<ProposalResponseType, 'ACEITA' | 'NEGADA' | 'NEGOCIANDO'> = {
    ACCEPTED: 'ACEITA',
    DECLINED: 'NEGADA',
    CHANGE_REQUESTED: 'NEGOCIANDO'
}

export async function submitProposalResponse(slug: string, input: ResponseInput, meta: { ip?: string; userAgent?: string }) {
    const proposal = await prisma.proposal.findUnique({
        where: { slug },
        include: { packageIds: { include: { items: true } } }
    })
    if (!proposal || proposal.status === 'ARQUIVADA') throw new HttpError(404, 'Proposta não encontrada.', 'NOT_FOUND')

    const block = findAcceptanceBlock(proposal.blocks)
    if (!block) throw new HttpError(409, 'Esta proposta não aceita respostas online. Fale com a empresa pelo contato da página.', 'NOT_ENABLED')
    if (input.type === 'DECLINED' && !block.data.allowDecline) throw new HttpError(400, 'Opção indisponível nesta proposta.', 'NOT_ALLOWED')
    if (input.type === 'CHANGE_REQUESTED' && !block.data.allowChangeRequest) throw new HttpError(400, 'Opção indisponível nesta proposta.', 'NOT_ALLOWED')

    if (proposal.status !== 'ABERTA') {
        const accepted = proposal.status === 'FECHADA'
        throw new HttpError(409, accepted ? 'Esta proposta já foi aceita.' : 'Esta proposta não está mais aberta para respostas.', accepted ? 'ALREADY_ACCEPTED' : 'CLOSED')
    }
    if (proposalExpiresAt(proposal).getTime() < Date.now()) {
        throw new HttpError(409, 'O prazo desta proposta terminou. Fale com a empresa para receber uma versão atualizada.', 'EXPIRED')
    }

    const { selection, totalCents } =
        input.type === 'DECLINED'
            ? { selection: null, totalCents: null }
            : resolveSelection(proposal, input.packageId, input.optionalItemIds, input.type === 'ACCEPTED')

    const saved = await prisma.$transaction(async (tx) => {
        // Aceite exige o código enviado ao e-mail de quem assina (confere antes de mudar qualquer coisa).
        const verifiedAt =
            input.type === 'ACCEPTED'
                ? await consumeSignatureCode(tx, { proposalId: proposal.id, role: 'CLIENT', email: input.signerEmail, code: input.code })
                : null

        // Condição no próprio UPDATE: com cliques duplos ou abas simultâneas, só a primeira resposta vence.
        const updated = await tx.proposal.updateMany({
            where: { id: proposal.id, status: 'ABERTA' },
            data: input.type === 'ACCEPTED' ? { status: 'FECHADA', commercialStatus: 'ACEITA' } : { commercialStatus: COMMERCIAL_STATUS[input.type] }
        })
        if (updated.count === 0) throw new HttpError(409, 'Esta proposta já foi respondida.', 'ALREADY_ACCEPTED')

        const created = await tx.proposalResponse.create({
            data: {
                proposalId: proposal.id,
                type: input.type,
                signerName: input.signerName,
                signerEmail: input.signerEmail,
                signerDocument: input.type === 'ACCEPTED' ? input.signerDocument : null,
                message: input.message || null,
                selection: (selection ?? undefined) as Prisma.InputJsonValue | undefined,
                totalCents,
                contentHash: contentHashFor(proposal, selection),
                ip: meta.ip?.slice(0, 64) ?? null,
                userAgent: meta.userAgent?.slice(0, 500) ?? null
            }
        })
        if (input.type === 'ACCEPTED' && verifiedAt) {
            await createClientSignature(tx, {
                proposalId: proposal.id,
                responseId: created.id,
                signerName: input.signerName,
                signerEmail: input.signerEmail,
                cpf: input.signerDocument,
                drawing: input.signature,
                contentHash: created.contentHash,
                verifiedAt,
                meta
            })
        }
        // Avisos por e-mail entram na fila na mesma transação: sem resposta gravada, sem e-mail.
        await notifyProposalResponse(tx, created)
        return created
    })
    kickEmailDispatch()
    return saved
}
