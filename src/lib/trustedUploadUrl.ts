export function isTrustedUploadUrl(url: string, origin: string): boolean {
    try {
        const parsed = new URL(url, origin)
        const allowedOrigin = new URL(origin)
        const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:'

        return isHttp && parsed.origin === allowedOrigin.origin && parsed.pathname.startsWith('/uploads/')
    } catch {
        return false
    }
}
