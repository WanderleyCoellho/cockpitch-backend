import type { NextFunction, Request, Response } from 'express'
import { verifyAccessToken, type JwtPayload } from '../lib/jwt.js'

export type AuthenticatedRequest = Request & {
    auth?: JwtPayload
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const header = req.headers.authorization

    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Missing bearer token' })
    }

    const token = header.replace('Bearer ', '').trim()

    try {
        req.auth = verifyAccessToken(token)
        return next()
    } catch {
        return res.status(401).json({ message: 'Invalid token' })
    }
}
