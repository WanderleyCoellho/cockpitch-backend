/**
 * SVG é texto e pode carregar script. Só aceitamos logos/ilustrações "puras": sem script, eventos,
 * links externos, <foreignObject>, entidades XML ou CSS que busque recurso de fora.
 * Recusamos em vez de "limpar", para não salvar um arquivo diferente do que a pessoa enviou.
 */
export const MAX_SVG_BYTES = 2 * 1024 * 1024

const FORBIDDEN: Array<[RegExp, string]> = [
    [/<script[\s>/]/i, 'script'],
    [/\son[a-z]+\s*=/i, 'evento (on...)'],
    [/javascript\s*:/i, 'javascript:'],
    [/<foreignObject[\s>/]/i, 'foreignObject'],
    [/<(iframe|embed|object|audio|video|link|meta|base|use)[\s>/]/i, 'elemento externo'],
    [/<!ENTITY/i, 'entidade XML'],
    [/@import/i, '@import'],
    // href/xlink:href só para âncoras internas (#id) ou imagem embutida (data:image/...).
    [/(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(?:png|jpe?g|gif|webp);base64,)/i, 'link externo'],
    [/url\(\s*["']?\s*(?!#|data:image\/(?:png|jpe?g|gif|webp);base64,)/i, 'url() externa']
]

export function looksLikeSvg(text: string) {
    const head = text.slice(0, 2048).replace(/^﻿/, '').trimStart()
    return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)
}

/** null = SVG aceito; texto = motivo da recusa. */
export function svgProblem(text: string): string | null {
    if (!looksLikeSvg(text)) return 'O arquivo não é um SVG válido.'
    for (const [pattern, label] of FORBIDDEN) {
        if (pattern.test(text)) return `SVG com conteúdo não permitido (${label}). Exporte o logo como SVG simples ou PNG.`
    }
    return null
}
