import type { Request } from 'express'
import { trustedApiOrigins } from './publicUrl.js'

/**
 * Só aceita URLs de mídia enviadas pela própria API: /media/public/* (storage atual)
 * ou /uploads/* (legado, disco local). Impede apontar propostas para conteúdo de terceiros.
 */
export function isTrustedUploadUrl(url: string, req: Request): boolean {
    try {
        const origins = trustedApiOrigins(req)
        const parsed = new URL(url, origins[0])
        const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:'
        const trustedPath =
            parsed.pathname.startsWith('/media/public/') ||
            (parsed.pathname.startsWith('/uploads/') && !parsed.pathname.startsWith('/uploads/receipts/'))

        return isHttp && origins.includes(parsed.origin) && trustedPath && !parsed.pathname.includes('..')
    } catch {
        return false
    }
}
