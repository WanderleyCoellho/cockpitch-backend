import type { Request } from 'express'
import { env } from '../config/env.js'

/** Origem pública da API (ex.: https://api.deal.lumendevstudios.com). */
export function publicApiOrigin(req: Request): string {
    if (env.PUBLIC_API_URL) return new URL(env.PUBLIC_API_URL).origin
    return `${req.protocol}://${req.get('host')}`
}

/** Origens aceitas para URLs de arquivos já enviados (a configurada e a da própria requisição). */
export function trustedApiOrigins(req: Request): string[] {
    const origins = new Set<string>([`${req.protocol}://${req.get('host')}`])
    if (env.PUBLIC_API_URL) origins.add(new URL(env.PUBLIC_API_URL).origin)
    return [...origins]
}
