import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { blocksSchema, type ProposalBlock } from './blocks.js'
import { findSystemTemplate, SYSTEM_TEMPLATES } from './templates/systemTemplates.js'

export const MAX_WORKSPACE_TEMPLATES = 50

export type ResolvedTemplate = {
    id: string
    system: boolean
    name: string
    description: string | null
    segment: string
    theme: string | null
    themeCustom: Prisma.JsonValue | null
    blocks: ProposalBlock[]
}

/** Modelo do sistema (sys-*) ou da própria empresa. Modelo de outra empresa → null. */
export async function resolveTemplate(id: string, workspaceId: string): Promise<ResolvedTemplate | null> {
    const system = findSystemTemplate(id)
    if (system) {
        return { ...system, system: true, themeCustom: null, description: system.description }
    }
    const own = await prisma.proposalTemplate.findFirst({ where: { id, workspaceId } })
    if (!own) return null
    // Revalida na leitura: um modelo salvo antes de uma mudança de contrato não pode quebrar a criação.
    const parsed = blocksSchema.safeParse(own.blocks)
    return {
        id: own.id,
        system: false,
        name: own.name,
        description: own.description,
        segment: own.segment,
        theme: own.theme,
        themeCustom: own.themeCustom,
        blocks: parsed.success ? parsed.data : []
    }
}

export async function listTemplates(workspaceId: string) {
    const own = await prisma.proposalTemplate.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, description: true, segment: true, theme: true, themeCustom: true, blocks: true, createdAt: true }
    })
    return {
        system: SYSTEM_TEMPLATES.map((template) => ({ ...template, system: true })),
        workspace: own.map((template) => ({ ...template, system: false }))
    }
}
