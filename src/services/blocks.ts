import { z } from 'zod'
import { sanitizeRichText } from '../lib/sanitizeHtml.js'

/**
 * Contrato dos blocos da proposta (spec architecture/003-proposal-blocks).
 * Escrita é ESTRITA (tipo desconhecido → 400); o renderer ignora tipos desconhecidos (Must-Ignore).
 */
export const BLOCKS_VERSION = 1
export const MAX_BLOCKS = 60
export const MAX_BLOCKS_BYTES = 512 * 1024

const text = (max: number) => z.string().max(max)
const optionalText = (max: number) => z.string().max(max).optional().default('')
const richText = (max: number) => z.string().max(max).transform(sanitizeRichText)
const mediaType = z.enum(['image', 'video'])
const mediaUrl = z.string().max(2000)

const mediaItem = z.object({ url: mediaUrl, type: mediaType, caption: optionalText(200) })

const base = {
    id: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/),
    visible: z.boolean().default(true),
    /** Título da seção exibido ao cliente (cada tipo tem um padrão no frontend). */
    title: optionalText(120)
}

export const blockSchema = z.discriminatedUnion('type', [
    z.object({
        ...base,
        type: z.literal('cover'),
        data: z.object({
            headline: text(160),
            subheadline: optionalText(300),
            mediaUrl: mediaUrl.optional(),
            mediaType: mediaType.optional(),
            showClientName: z.boolean().default(true)
        })
    }),
    z.object({
        ...base,
        type: z.literal('about'),
        data: z.object({ body: richText(20_000), mediaUrl: mediaUrl.optional(), mediaType: mediaType.optional() })
    }),
    z.object({
        ...base,
        type: z.literal('scope'),
        data: z.object({
            intro: optionalText(2000),
            items: z.array(z.object({ title: text(160), description: optionalText(600) })).max(50)
        })
    }),
    z.object({
        ...base,
        type: z.literal('pricing'),
        data: z.object({ intro: optionalText(2000) })
    }),
    z.object({
        ...base,
        type: z.literal('gallery'),
        data: z.object({ items: z.array(mediaItem).max(60) })
    }),
    z.object({
        ...base,
        type: z.literal('timeline'),
        data: z.object({
            steps: z.array(z.object({ title: text(160), description: optionalText(600), duration: optionalText(60) })).max(30)
        })
    }),
    z.object({
        ...base,
        type: z.literal('testimonials'),
        data: z.object({
            items: z
                .array(z.object({ quote: text(1000), author: optionalText(120), role: optionalText(120), photoUrl: mediaUrl.optional() }))
                .max(30)
        })
    }),
    z.object({
        ...base,
        type: z.literal('faq'),
        data: z.object({ items: z.array(z.object({ question: text(300), answer: text(3000) })).max(50) })
    }),
    z.object({
        ...base,
        type: z.literal('team'),
        data: z.object({
            members: z
                .array(z.object({ name: text(120), role: optionalText(120), bio: optionalText(600), photoUrl: mediaUrl.optional() }))
                .max(30)
        })
    }),
    z.object({
        ...base,
        type: z.literal('terms'),
        data: z.object({ body: richText(20_000) })
    }),
    z.object({
        ...base,
        type: z.literal('contact'),
        data: z.object({
            message: optionalText(600),
            showWhatsapp: z.boolean().default(true),
            showEmail: z.boolean().default(true),
            showInstagram: z.boolean().default(true)
        })
    }),
    z.object({
        ...base,
        type: z.literal('acceptance'),
        /** Aceite online (spec proposal-online-acceptance): o cliente aceita, pede ajuste ou recusa. */
        data: z.object({
            intro: optionalText(1000),
            allowDecline: z.boolean().default(true),
            allowChangeRequest: z.boolean().default(true),
            requireDocument: z.boolean().default(false)
        })
    }),
    z.object({
        ...base,
        type: z.literal('cta'),
        data: z.object({ headline: text(160), buttonLabel: optionalText(40) })
    })
])

export type ProposalBlock = z.infer<typeof blockSchema>
export type BlockType = ProposalBlock['type']

export const blocksSchema = z
    .array(blockSchema)
    .max(MAX_BLOCKS, `Uma proposta pode ter no máximo ${MAX_BLOCKS} blocos`)
    .refine((blocks) => new Set(blocks.map((b) => b.id)).size === blocks.length, { message: 'IDs de bloco repetidos' })
    .refine((blocks) => Buffer.byteLength(JSON.stringify(blocks), 'utf8') <= MAX_BLOCKS_BYTES, {
        message: 'Conteúdo da proposta grande demais (máx. 512 KB)'
    })

/** Todas as URLs de mídia dos blocos (para validar que vieram do upload da própria API). */
export function collectMediaUrls(blocks: ProposalBlock[]): string[] {
    const urls: string[] = []
    for (const block of blocks) {
        switch (block.type) {
            case 'cover':
            case 'about':
                if (block.data.mediaUrl) urls.push(block.data.mediaUrl)
                break
            case 'gallery':
                urls.push(...block.data.items.map((item) => item.url))
                break
            case 'testimonials':
                block.data.items.forEach((item) => item.photoUrl && urls.push(item.photoUrl))
                break
            case 'team':
                block.data.members.forEach((member) => member.photoUrl && urls.push(member.photoUrl))
                break
            default:
                break
        }
    }
    return urls
}
