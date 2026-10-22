import { Router, type Request } from 'express'
import { createHash, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { env } from '../config/env.js'
import { signOpsAccessToken, verifyOpsAccessToken } from '../lib/opsJwt.js'
import { getCookieValue } from '../lib/httpCookies.js'
import { authRateLimit } from '../middlewares/rateLimit.js'

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
})

export const opsAuthRouter = Router()

const OPS_COOKIE_NAME = env.OPS_COOKIE_NAME

// Compara via hash para ter tamanho fixo e tempo constante (evita timing attack).
function safeEqual(a: string, b: string) {
    const ha = createHash('sha256').update(a).digest()
    const hb = createHash('sha256').update(b).digest()
    return timingSafeEqual(ha, hb)
}

function readOpsTokenFromRequest(req: Request): string | null {
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) {
        return header.replace('Bearer ', '').trim()
    }

    return getCookieValue(req, OPS_COOKIE_NAME)
}

opsAuthRouter.post('/login', authRateLimit, (req, res) => {
    if (!env.OPS_ADMIN_EMAIL || !env.OPS_ADMIN_PASSWORD) {
        return res.status(503).json({ message: 'Ops admin credentials are not configured' })
    }

    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const inputEmail = parsed.data.email.trim().toLowerCase()
    const expectedEmail = env.OPS_ADMIN_EMAIL.trim().toLowerCase()
    const emailOk = safeEqual(inputEmail, expectedEmail)
    const passwordOk = safeEqual(parsed.data.password, env.OPS_ADMIN_PASSWORD)
    if (!emailOk || !passwordOk) {
        return res.status(401).json({ message: 'Invalid credentials' })
    }

    const token = signOpsAccessToken({ role: 'OPS_ADMIN', email: expectedEmail })

    const isSecure = env.NODE_ENV === 'production'
    const cookieParts = [
        `${OPS_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${12 * 60 * 60}`
    ]
    if (isSecure) cookieParts.push('Secure')

    res.setHeader('Set-Cookie', cookieParts.join('; '))
    return res.json({ token, admin: { email: expectedEmail, role: 'OPS_ADMIN' } })
})

opsAuthRouter.get('/me', (req, res) => {
    const token = readOpsTokenFromRequest(req)
    if (!token) {
        return res.status(401).json({ message: 'Missing ops session token' })
    }

    try {
        const payload = verifyOpsAccessToken(token)
        return res.json({ admin: payload })
    } catch {
        return res.status(401).json({ message: 'Invalid token' })
    }
})

opsAuthRouter.post('/logout', (_req, res) => {
    const isSecure = env.NODE_ENV === 'production'
    const cookieParts = [
        `${OPS_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=0'
    ]
    if (isSecure) cookieParts.push('Secure')

    res.setHeader('Set-Cookie', cookieParts.join('; '))
    return res.status(204).send()
})
