import type { NextFunction, Response } from 'express'
import type { WorkspaceRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { HttpError } from '../lib/httpError.js'
import { hasRole } from '../services/workspace.service.js'
import type { AuthenticatedRequest } from './authMiddleware.js'

export const WORKSPACE_HEADER = 'x-workspace-id'

/**
 * Resolve o workspace ativo: header X-Workspace-Id (validado contra a associação do usuário)
 * ou, se ausente, o workspace mais antigo do usuário. Deve vir depois de requireAuth.
 */
export async function requireWorkspace(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const requested = req.get(WORKSPACE_HEADER)?.trim()
    if (requested && (requested.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(requested))) {
        return res.status(400).json({ message: 'Invalid workspace id' })
    }

    const membership = await prisma.workspaceMember.findFirst({
        where: { userId: req.auth.userId, ...(requested ? { workspaceId: requested } : {}) },
        orderBy: { createdAt: 'asc' },
        select: { workspaceId: true, role: true }
    })

    if (!membership) {
        // Workspace de outra pessoa: 404 (não revela que existe).
        return res.status(requested ? 404 : 403).json({
            message: requested ? 'Workspace not found' : 'Você ainda não faz parte de nenhum workspace.'
        })
    }

    req.auth = { ...req.auth, workspaceId: membership.workspaceId, workspaceRole: membership.role }
    return next()
}

export function requireRole(role: WorkspaceRole) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.auth?.workspaceRole || !hasRole(req.auth.workspaceRole, role)) {
            return res.status(403).json({ message: 'Você não tem permissão para esta ação.', code: 'FORBIDDEN_ROLE' })
        }
        return next()
    }
}

/** Workspace ativo da requisição. Lança erro se o middleware não rodou (nunca filtra com undefined). */
export function workspaceIdOf(auth: AuthenticatedRequest['auth']): string {
    if (!auth?.workspaceId) {
        throw new HttpError(500, 'Workspace context missing')
    }
    return auth.workspaceId
}
