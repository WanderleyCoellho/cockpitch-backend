import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export type OpsJwtPayload = {
    role: 'OPS_ADMIN'
    email: string
}

function getOpsJwtSecret() {
    return env.OPS_JWT_SECRET || env.JWT_SECRET
}

export function signOpsAccessToken(payload: OpsJwtPayload) {
    return jwt.sign(payload, getOpsJwtSecret(), { expiresIn: env.OPS_ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] })
}

export function verifyOpsAccessToken(token: string): OpsJwtPayload {
    return jwt.verify(token, getOpsJwtSecret()) as OpsJwtPayload
}
