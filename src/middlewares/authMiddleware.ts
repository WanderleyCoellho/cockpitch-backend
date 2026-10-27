import type { NextFunction, Request, Response } from 'express'
import type { WorkspaceRole } from '@prisma/client'
import { verifyAccessToken, type JwtPayload } from '../lib/jwt.js'
import { prisma } from '../lib/prisma.js'

export type AuthenticatedRequest = Request<Record<string, string>> & {
    auth?: JwtPayload & {
        /** Preenchidos por requireWorkspace. */
        workspaceId?: string
        workspaceRole?: WorkspaceRole
    }
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const header = req.headers.authorization

    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Missing bearer token' })
    }

    const token = header.replace('Bearer ', '').trim()

    let payload: ReturnType<typeof verifyAccessToken>
    try {
        payload = verifyAccessToken(token)
    } catch {
        return res.status(401).json({ message: 'Invalid token' })
    }

    // Token sem usuário (ex.: sessão do painel Ops assinada com o mesmo segredo) não é sessão de usuário.
    if (typeof payload.userId !== 'string' || !payload.userId) {
        return res.status(401).json({ message: 'Invalid token' })
    }

    // Sessões emitidas antes da última troca de senha por vínculo com Google deixam de valer.
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { sessionsValidAfter: true } })
    if (!user || isRevoked(payload.iat, user.sessionsValidAfter)) {
        return res.status(401).json({ message: 'Invalid token' })
    }

    req.auth = payload
    return next()
}

/** `iat` é em segundos: compara no mesmo segundo para o token emitido logo após a troca continuar válido. */
function isRevoked(issuedAt: number | undefined, validAfter: Date | null) {
    if (!validAfter) return false
    return (issuedAt ?? 0) < Math.floor(validAfter.getTime() / 1000)
}
