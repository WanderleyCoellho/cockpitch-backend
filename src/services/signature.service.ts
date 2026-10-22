import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { Package, PackageItem, Prisma, Proposal, ProposalSignature, SignatureRole } from '@prisma/client'
import { z } from 'zod'
import { env } from '../config/env.js'
import { formatCpf, isValidCpf, maskCpf, normalizeCpf } from '../lib/cpf.js'
import { HttpError } from '../lib/httpError.js'
import { prisma } from '../lib/prisma.js'
import { enqueueEmails, kickEmailDispatch } from './email/outbox.js'
import { contentHashFor } from './content-hash.js'

/**
 * Assinatura eletrônica da proposta (spec specs/digital-signature.md).
 * Quem assina — empresa ou cliente — informa CPF, desenha ou digita a assinatura e confirma o e-mail
 * com um código de 6 dígitos. Guardamos a evidência e o código (SHA-256) do conteúdo assinado.
 */

type Db = typeof prisma | Prisma.TransactionClient

export const CODE_TTL_MINUTES = 10
export const CODE_MAX_ATTEMPTS = 5
const RESEND_SECONDS = 60
const MAX_CODES_PER_HOUR = 5
const MAX_IMAGE_BYTES = 200 * 1024
const PNG_PREFIX = 'data:image/png;base64,'
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isPngDataUrl(value: string) {
    if (!value.startsWith(PNG_PREFIX)) return false
    const base64 = value.slice(PNG_PREFIX.length)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return false
    const bytes = Buffer.from(base64, 'base64')
    return bytes.length > PNG_MAGIC.length && bytes.length <= MAX_IMAGE_BYTES && bytes.subarray(0, 8).equals(PNG_MAGIC)
}

export const cpfSchema = z
    .string({ required_error: 'Informe o CPF de quem assina' })
    .trim()
    .refine(isValidCpf, 'CPF inválido. Confira os números.')
    .transform(normalizeCpf)

export const codeSchema = z.string().trim().regex(/^\d{6}$/, 'Digite os 6 números do código enviado por e-mail')

/** Desenhada (PNG) ou digitada (o nome vira assinatura numa fonte manuscrita). */
export const signatureDrawingSchema = z.discriminatedUnion('method', [
    z.object({
        method: z.literal('DRAWN'),
        image: z.string().max(300_000).refine(isPngDataUrl, 'Assinatura inválida. Desenhe de novo.')
    }),
    z.object({
        method: z.literal('TYPED'),
        typedText: z.string().trim().min(2, 'Digite seu nome para gerar a assinatura').max(80)
    })
])
export type SignatureDrawing = z.infer<typeof signatureDrawingSchema>

function drawingFields(drawing: SignatureDrawing) {
    return drawing.method === 'DRAWN' ? { method: drawing.method, image: drawing.image, typedText: null } : { method: drawing.method, image: null, typedText: drawing.typedText }
}

function hashCode(proposalId: string, email: string, code: string) {
    return createHash('sha256').update(`${proposalId}:${email}:${code}:${env.JWT_SECRET}`).digest('hex')
}

/**
 * Gera um código e deixa o e-mail na fila. Limites: 1 código por minuto e 5 por hora para o mesmo
 * e-mail e proposta (o código vale 10 minutos e aceita 5 tentativas).
 */
export async function sendSignatureCode(params: {
    proposalId: string
    role: SignatureRole
    email: string
    name: string
    companyName: string
    brandColor?: string | null
    clientName: string
    ip?: string
}) {
    const email = params.email.trim().toLowerCase()
    const now = Date.now()
    const recent = await prisma.signatureCode.findMany({
        where: { proposalId: params.proposalId, email, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
    })
    const last = recent[0]
    if (last && now - last.createdAt.getTime() < RESEND_SECONDS * 1000) {
        const wait = Math.ceil((RESEND_SECONDS * 1000 - (now - last.createdAt.getTime())) / 1000)
        throw new HttpError(429, `Aguarde ${wait} segundos para pedir um novo código.`, 'CODE_COOLDOWN')
    }
    if (recent.length >= MAX_CODES_PER_HOUR) {
        throw new HttpError(429, 'Muitos códigos pedidos. Tente de novo em uma hora.', 'CODE_LIMIT')
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expiresAt = new Date(now + CODE_TTL_MINUTES * 60 * 1000)
    await prisma.$transaction(async (tx) => {
        const row = await tx.signatureCode.create({
            data: { proposalId: params.proposalId, role: params.role, email, codeHash: hashCode(params.proposalId, email, code), expiresAt, ip: params.ip?.slice(0, 64) }
        })
        await enqueueEmails(tx, [
            {
                to: email,
                template: 'signature_code',
                dedupeKey: `signature-code:${row.id}`,
                payload: {
                    companyName: params.companyName,
                    brandColor: params.brandColor ?? null,
                    name: params.name,
                    code,
                    role: params.role,
                    clientName: params.clientName,
                    expiresMinutes: CODE_TTL_MINUTES
                }
            }
        ])
    })
    kickEmailDispatch()
    return { email, expiresAt }
}

/** Confere o código e o marca como usado. Erros explicam o que fazer (pedir outro, quantas tentativas restam). */
export async function consumeSignatureCode(db: Db, params: { proposalId: string; role: SignatureRole; email: string; code: string }) {
    const email = params.email.trim().toLowerCase()
    const row = await db.signatureCode.findFirst({
        where: { proposalId: params.proposalId, role: params.role, email, usedAt: null },
        orderBy: { createdAt: 'desc' }
    })
    if (!row || row.expiresAt.getTime() < Date.now()) {
        throw new HttpError(400, 'O código expirou ou não foi pedido. Peça um novo código.', 'CODE_EXPIRED')
    }
    if (row.attempts >= CODE_MAX_ATTEMPTS) {
        throw new HttpError(400, 'Muitas tentativas com este código. Peça um novo.', 'CODE_LOCKED')
    }
    const expected = Buffer.from(row.codeHash, 'hex')
    const given = Buffer.from(hashCode(params.proposalId, email, params.code), 'hex')
    if (!timingSafeEqual(expected, given)) {
        // Fora da transação do chamador: a tentativa errada conta mesmo que o resto falhe.
        await prisma.signatureCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
        const left = CODE_MAX_ATTEMPTS - row.attempts - 1
        throw new HttpError(400, left > 0 ? `Código incorreto. ${left === 1 ? 'Resta 1 tentativa' : `Restam ${left} tentativas`}.` : 'Código incorreto. Peça um novo.', 'CODE_INVALID')
    }
    const used = await db.signatureCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
    if (used.count === 0) throw new HttpError(400, 'Este código já foi usado. Peça um novo.', 'CODE_EXPIRED')
    return new Date()
}

type ProposalWithPackages = Proposal & { packageIds: Array<Package & { items: PackageItem[] }> }

/** Conteúdo que a empresa assina: blocos + pacotes (a escolha do cliente entra só na assinatura dele). */
export function providerContentHash(proposal: ProposalWithPackages) {
    return contentHashFor(proposal, null)
}

export const providerSignInputSchema = z.object({
    code: codeSchema,
    cpf: cpfSchema,
    signerTitle: z.string().trim().max(80).optional(),
    signature: signatureDrawingSchema,
    /** Guardar assinatura e CPF no perfil para as próximas propostas. */
    saveToProfile: z.boolean().default(true)
})

export async function signAsProvider(params: {
    proposal: ProposalWithPackages
    user: { id: string; name: string; email: string }
    input: z.infer<typeof providerSignInputSchema>
    meta: { ip?: string; userAgent?: string }
}) {
    const { proposal, user, input } = params
    if (proposal.status === 'ARQUIVADA') throw new HttpError(409, 'Proposta arquivada não pode ser assinada.', 'ARCHIVED')
    const contentHash = providerContentHash(proposal)
    const already = await prisma.proposalSignature.findFirst({ where: { proposalId: proposal.id, role: 'PROVIDER', contentHash } })
    if (already) throw new HttpError(409, 'Esta versão da proposta já está assinada pela empresa.', 'ALREADY_SIGNED')

    return prisma.$transaction(async (tx) => {
        const verifiedAt = await consumeSignatureCode(tx, { proposalId: proposal.id, role: 'PROVIDER', email: user.email, code: input.code })
        const signature = await tx.proposalSignature.create({
            data: {
                proposalId: proposal.id,
                role: 'PROVIDER',
                userId: user.id,
                signerName: user.name,
                signerEmail: user.email.toLowerCase(),
                signerDocument: input.cpf,
                signerTitle: input.signerTitle || null,
                ...drawingFields(input.signature),
                contentHash,
                emailVerifiedAt: verifiedAt,
                ip: params.meta.ip?.slice(0, 64) ?? null,
                userAgent: params.meta.userAgent?.slice(0, 500) ?? null
            }
        })
        if (input.saveToProfile) {
            await tx.user.update({
                where: { id: user.id },
                data: { cpf: input.cpf, savedSignature: { ...drawingFields(input.signature), signerTitle: input.signerTitle || null } as Prisma.InputJsonValue }
            })
        }
        return signature
    })
}

/** Assinatura do cliente, gravada junto com o aceite (mesma transação). */
export async function createClientSignature(
    tx: Prisma.TransactionClient,
    params: {
        proposalId: string
        responseId: string
        signerName: string
        signerEmail: string
        cpf: string
        drawing: SignatureDrawing
        contentHash: string
        verifiedAt: Date
        meta: { ip?: string; userAgent?: string }
    }
) {
    return tx.proposalSignature.create({
        data: {
            proposalId: params.proposalId,
            role: 'CLIENT',
            responseId: params.responseId,
            signerName: params.signerName,
            signerEmail: params.signerEmail.toLowerCase(),
            signerDocument: params.cpf,
            ...drawingFields(params.drawing),
            contentHash: params.contentHash,
            emailVerifiedAt: params.verifiedAt,
            ip: params.meta.ip?.slice(0, 64) ?? null,
            userAgent: params.meta.userAgent?.slice(0, 500) ?? null
        }
    })
}

export type PublicSignature = {
    id: string
    role: SignatureRole
    signerName: string
    signerTitle: string | null
    /** CPF mascarado na página pública; completo no painel. */
    document: string
    method: 'DRAWN' | 'TYPED'
    image: string | null
    typedText: string | null
    contentHash: string
    signedAt: string
    emailVerifiedAt: string
    /** Empresa: assinou o conteúdo atual? (editar a proposta depois de assinar pede nova assinatura). */
    current: boolean
}

export type PanelSignature = PublicSignature & { signerEmail: string; ip: string | null; userAgent: string | null }

function toPublic(sig: ProposalSignature, current: boolean): PublicSignature {
    return {
        id: sig.id,
        role: sig.role,
        signerName: sig.signerName,
        signerTitle: sig.signerTitle,
        document: maskCpf(sig.signerDocument),
        method: sig.method,
        image: sig.image,
        typedText: sig.typedText,
        contentHash: sig.contentHash,
        signedAt: sig.createdAt.toISOString(),
        emailVerifiedAt: sig.emailVerifiedAt.toISOString(),
        current
    }
}

/**
 * Assinaturas vigentes da proposta: a última da empresa e a do cliente no aceite atual.
 * `panel` inclui e-mail, CPF completo, IP e navegador (só para a equipe).
 */
export async function signaturesFor(proposal: ProposalWithPackages, options: { panel: true }): Promise<{ provider: PanelSignature | null; client: PanelSignature | null }>
export async function signaturesFor(proposal: ProposalWithPackages, options?: { panel?: false }): Promise<{ provider: PublicSignature | null; client: PublicSignature | null }>
export async function signaturesFor(proposal: ProposalWithPackages, options: { panel?: boolean } = {}) {
    const [provider, accepted] = await Promise.all([
        prisma.proposalSignature.findFirst({ where: { proposalId: proposal.id, role: 'PROVIDER' }, orderBy: { createdAt: 'desc' } }),
        proposal.status === 'FECHADA'
            ? prisma.proposalResponse.findFirst({ where: { proposalId: proposal.id, type: 'ACCEPTED' }, orderBy: { createdAt: 'desc' }, select: { id: true } })
            : null
    ])
    const client = accepted ? await prisma.proposalSignature.findUnique({ where: { responseId: accepted.id } }) : null
    const view = (sig: ProposalSignature | null, current: boolean) => {
        if (!sig) return null
        const base = toPublic(sig, current)
        return options.panel ? { ...base, document: formatCpf(sig.signerDocument), signerEmail: sig.signerEmail, ip: sig.ip, userAgent: sig.userAgent } : base
    }
    return {
        provider: view(provider, !!provider && provider.contentHash === providerContentHash(proposal)),
        client: view(client, true)
    }
}
