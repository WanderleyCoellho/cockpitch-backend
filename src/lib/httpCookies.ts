import type { Request } from 'express'

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
    if (!cookieHeader) return {}

    return cookieHeader
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce<Record<string, string>>((acc, part) => {
            const separator = part.indexOf('=')
            if (separator <= 0) return acc

            const key = part.slice(0, separator).trim()
            const value = part.slice(separator + 1).trim()
            if (!key) return acc

            acc[key] = decodeURIComponent(value)
            return acc
        }, {})
}

export function getCookieValue(req: Request, name: string): string | null {
    const cookies = parseCookieHeader(req.headers.cookie)
    return cookies[name] ?? null
}
