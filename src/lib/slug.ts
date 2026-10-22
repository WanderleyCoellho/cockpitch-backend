import crypto from 'crypto'

export function slugify(value: string, max = 60) {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, max)
        .replace(/-+$/g, '')
}

/** Link público de proposta: minúsculas, números e hífen (3–80). */
export const PUBLIC_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,78})[a-z0-9]$/

/** Link gerado pelo sistema (planos sem link personalizado): nome do cliente + sufixo aleatório. */
export function generatedProposalSlug(clientName: string) {
    const base = slugify(clientName, 40) || 'proposta'
    return `${base}-${crypto.randomBytes(3).toString('hex')}`
}
