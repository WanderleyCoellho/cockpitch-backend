import { prisma } from '../lib/prisma.js'
import { blockSchema, type ProposalBlock } from './blocks.js'
import type { Entitlements } from './entitlements.js'
import { SYSTEM_TEMPLATES } from './templates/systemTemplates.js'

export const MAX_SAVED_BLOCKS = 200

/** Blocos sem conteúdo próprio (o renderer monta tudo): não fazem sentido na biblioteca. */
const SKIP_TYPES = new Set<ProposalBlock['type']>(['pricing', 'acceptance'])

export type LibraryItem = {
    id: string
    type: ProposalBlock['type']
    title: string
    templateId: string
    templateName: string
    theme: string
    segment: string
}

/**
 * Biblioteca do sistema: os blocos de todos os modelos prontos, sem repetidos
 * (as condições, por exemplo, são iguais em vários modelos).
 */
export function systemLibrary(): Array<LibraryItem & { block: ProposalBlock }> {
    const seen = new Set<string>()
    const items: Array<LibraryItem & { block: ProposalBlock }> = []
    for (const template of SYSTEM_TEMPLATES) {
        for (const block of template.blocks) {
            if (SKIP_TYPES.has(block.type)) continue
            const key = `${block.type}:${JSON.stringify(block.data)}`
            if (seen.has(key)) continue
            seen.add(key)
            items.push({
                id: `${template.id}/${block.id}`,
                type: block.type,
                title: block.title,
                templateId: template.id,
                templateName: template.name,
                theme: template.theme,
                segment: template.segment,
                block
            })
        }
    }
    return items
}

/**
 * O que a empresa vê na biblioteca. Sem o plano, a lista do sistema vem só com nomes
 * (o editor mostra bloqueado, como convite ao upgrade) e os blocos salvos não vêm.
 */
export async function listBlockLibrary(workspaceId: string, entitlements: Entitlements) {
    const system = systemLibrary().map(({ block, ...item }) => (entitlements.blockLibrary ? { ...item, block } : item))
    const saved = entitlements.savedBlocks
        ? await prisma.savedBlock.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, type: true, block: true, createdById: true, createdAt: true }
        })
        : []
    return {
        access: { blockLibrary: entitlements.blockLibrary, savedBlocks: entitlements.savedBlocks },
        system,
        // Revalida na leitura: um bloco salvo antes de uma mudança de contrato é deixado de fora.
        saved: saved.flatMap((row) => {
            const parsed = blockSchema.safeParse(row.block)
            return parsed.success ? [{ ...row, block: parsed.data }] : []
        })
    }
}
