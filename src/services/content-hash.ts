import { createHash } from 'node:crypto'
import type { Package, PackageItem, Proposal } from '@prisma/client'
import { toPricingInput } from './package.service.js'

type ProposalForHash = Proposal & { packageIds: Array<Package & { items: PackageItem[] }> }

/** Serialização com chaves ordenadas: o mesmo conteúdo sempre gera o mesmo hash. */
function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
            .join(',')}}`
    }
    return JSON.stringify(value instanceof Date ? value.toISOString() : value ?? null)
}

/** Evidência do que o cliente viu: blocos + pacotes (com itens e preços) + o que escolheu. */
export function contentHashFor(proposal: ProposalForHash, selection: unknown) {
    const packages = proposal.packageIds.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        pricing: toPricingInput(pkg),
        items: pkg.items.map((item) => ({ id: item.id, name: item.name, description: item.description, unit: item.unit }))
    }))
    const content = { proposalId: proposal.id, clientName: proposal.clientName, blocks: proposal.blocks, packages, selection }
    return createHash('sha256').update(stableStringify(content)).digest('hex')
}

