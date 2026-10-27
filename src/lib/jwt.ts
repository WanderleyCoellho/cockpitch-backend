import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export type JwtPayload = {
    userId: string
    role: 'PROVIDER' | 'CUSTOMER' | 'ADMIN'
}

export function signAccessToken(payload: JwtPayload) {
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' })
}

export function verifyAccessToken(token: string): JwtPayload & { iat?: number } {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload & { iat?: number }
}
