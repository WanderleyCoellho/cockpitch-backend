import sanitize from 'sanitize-html'

/**
 * Rich text permitido em campos de texto exibidos na página pública.
 * Tudo que não estiver na lista (scripts, iframes, handlers on*, estilos) é removido.
 */
export function sanitizeRichText(value: string): string {
    return sanitize(value, {
        allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'a', 'span'],
        allowedAttributes: { a: ['href', 'target', 'rel'] },
        allowedSchemes: ['http', 'https', 'mailto', 'tel'],
        transformTags: {
            a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' })
        }
    })
}

export function sanitizeOptionalRichText<T extends string | null | undefined>(value: T): T {
    if (typeof value !== 'string') return value
    return sanitizeRichText(value) as T
}
