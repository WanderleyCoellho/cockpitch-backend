import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { isTrustedUploadUrl } from '../lib/trustedUploadUrl.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { requireWorkspace, workspaceIdOf } from '../middlewares/workspaceMiddleware.js'
import { listBlockLibrary, MAX_SAVED_BLOCKS } from '../services/block-library.service.js'
import { blockSchema, collectMediaUrls } from '../services/blocks.js'
import { planLimitError, resolveEntitlements } from '../services/entitlements.js'
import { hasRole } from '../services/workspace.service.js'

const saveSchema = z.object({
    name: z.string().trim().min(2).max(80),
    block: blockSchema
})

async function entitlementsOf(workspaceId: string) {
    return resolveEntitlements(await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
}

/** Biblioteca de blocos do editor: prontos do sistema (Essencial+) e salvos pela empresa (Profissional+). */
export const blockLibraryRouter = Router()

blockLibraryRouter.use(requireAuth, requireWorkspace)

blockLibraryRouter.get('/', async (req: AuthenticatedRequest, res) => {
    const workspaceId = workspaceIdOf(req.auth)
    return res.json(await listBlockLibrary(workspaceId, await entitlementsOf(workspaceId)))
})

// Qualquer pessoa da equipe pode salvar: a biblioteca é compartilhada.
blockLibraryRouter.post('/', async (req: AuthenticatedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }
    const workspaceId = workspaceIdOf(req.auth)
    if (!(await entitlementsOf(workspaceId)).savedBlocks) {
        throw planLimitError('Salvar blocos na biblioteca está disponível a partir do plano Profissional.')
    }
    if ((await prisma.savedBlock.count({ where: { workspaceId } })) >= MAX_SAVED_BLOCKS) {
        return res.status(400).json({ message: `Limite de ${MAX_SAVED_BLOCKS} blocos salvos por empresa.`, code: 'TOO_MANY_BLOCKS' })
    }
    const block = parsed.data.block
    if (collectMediaUrls([block]).some((url) => !isTrustedUploadUrl(url, req))) {
        return res.status(400).json({ message: 'Use apenas mídias enviadas pelo Lumen Deal.', code: 'UNTRUSTED_MEDIA' })
    }
    const saved = await prisma.savedBlock.create({
        data: {
            workspaceId,
            name: parsed.data.name,
            type: block.type,
            block: block as Prisma.InputJsonValue,
            createdById: req.auth!.userId
        },
        select: { id: true, name: true, type: true, block: true, createdById: true, createdAt: true }
    })
    return res.status(201).json({ saved })
})

// Apaga quem salvou ou um administrador.
blockLibraryRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
    const workspaceId = workspaceIdOf(req.auth)
    const row = await prisma.savedBlock.findFirst({ where: { id: req.params.id, workspaceId }, select: { id: true, createdById: true } })
    if (!row) return res.status(404).json({ message: 'Block not found' })
    const isAdmin = !!req.auth?.workspaceRole && hasRole(req.auth.workspaceRole, 'ADMIN')
    if (!isAdmin && row.createdById !== req.auth!.userId) {
        return res.status(403).json({ message: 'Só quem salvou ou um administrador pode excluir.', code: 'FORBIDDEN_ROLE' })
    }
    await prisma.savedBlock.delete({ where: { id: row.id } })
    return res.status(204).send()
})
