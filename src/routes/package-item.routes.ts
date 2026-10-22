import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { requireRole, requireWorkspace, workspaceIdOf } from '../middlewares/workspaceMiddleware.js'
import { LIMITS } from '../services/pricing.js'
import { assertItemCapacity, refreshPackagePrice, serializeItem } from '../services/package.service.js'

const itemFields = {
    name: z.string().trim().min(1).max(200),
    description: z.string().max(500).nullable().optional(),
    kind: z.enum(['INCLUDED', 'OPTIONAL', 'COURTESY']).optional(),
    /** Legado: equivale a kind = COURTESY. */
    isCourtesy: z.boolean().optional(),
    quantity: z.coerce.number().min(0.01).max(LIMITS.maxQuantity).optional(),
    unit: z.string().trim().max(20).nullable().optional(),
    unitPriceCents: z.number().int().min(0).max(LIMITS.maxUnitPriceCents).optional(),
    order: z.number().int().min(0).max(10_000).optional()
}

const createPackageItemSchema = z.object({ packageId: z.string().cuid(), ...itemFields })

const updatePackageItemSchema = z
    .object(itemFields)
    .partial()
    .refine((payload) => Object.keys(payload).length > 0, { message: 'At least one field is required' })

/** Mantém `kind` e o legado `isCourtesy` coerentes, aceitando qualquer um dos dois. */
function normalizeKind<T extends { kind?: 'INCLUDED' | 'OPTIONAL' | 'COURTESY'; isCourtesy?: boolean }>(data: T) {
    const { isCourtesy, ...rest } = data
    const kind = rest.kind ?? (isCourtesy === undefined ? undefined : isCourtesy ? 'COURTESY' : 'INCLUDED')
    return kind === undefined ? rest : { ...rest, kind, isCourtesy: kind === 'COURTESY' }
}

export const packageItemRouter = Router()

packageItemRouter.use(requireAuth, requireWorkspace)

// Helper para validar propriedade do package (indiretamente, do provider)
async function verifyPackageOwnership(auth: any, packageId: string) {
    const pkg = await prisma.package.findFirst({
        where: {
            id: packageId,
            provider: {
                workspaceId: workspaceIdOf(auth)
            }
        }
    })
    return pkg
}

packageItemRouter.get('/package/:packageId', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { packageId } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const pkg = await verifyPackageOwnership(auth, packageId)
    if (!pkg) {
        return res.status(403).json({ message: 'Access denied' })
    }

    const items = await prisma.packageItem.findMany({
        where: { packageId },
        orderBy: { order: 'asc' }
    })

    return res.json({ items: items.map(serializeItem) })
})

packageItemRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { id } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const item = await prisma.packageItem.findFirst({
        where: {
            id,
            package: {
                provider: {
                    workspaceId: workspaceIdOf(auth)
                }
            }
        }
    })

    if (!item) {
        return res.status(404).json({ message: 'Package item not found' })
    }

    return res.json({ item: serializeItem(item) })
})

packageItemRouter.post('/', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const auth = req.auth

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const parsed = createPackageItemSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const pkg = await verifyPackageOwnership(auth, parsed.data.packageId)
    if (!pkg) {
        return res.status(403).json({ message: 'Access denied' })
    }

    if (!(await assertItemCapacity(prisma, parsed.data.packageId))) {
        return res.status(400).json({ message: `Um pacote pode ter no máximo ${LIMITS.maxItems} itens.`, code: 'TOO_MANY_ITEMS' })
    }

    const item = await prisma.packageItem.create({
        data: normalizeKind(parsed.data)
    })
    await refreshPackagePrice(prisma, item.packageId)

    return res.status(201).json({ item: serializeItem(item) })
})

packageItemRouter.patch('/:id', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { id } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const parsed = updatePackageItemSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const item = await prisma.packageItem.findFirst({
        where: {
            id,
            package: {
                provider: {
                    workspaceId: workspaceIdOf(auth)
                }
            }
        }
    })

    if (!item) {
        return res.status(404).json({ message: 'Package item not found' })
    }

    const updated = await prisma.packageItem.update({
        where: { id },
        data: normalizeKind(parsed.data)
    })
    await refreshPackagePrice(prisma, updated.packageId)

    return res.json({ item: serializeItem(updated) })
})

packageItemRouter.delete('/:id', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { id } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const item = await prisma.packageItem.findFirst({
        where: {
            id,
            package: {
                provider: {
                    workspaceId: workspaceIdOf(auth)
                }
            }
        }
    })

    if (!item) {
        return res.status(404).json({ message: 'Package item not found' })
    }

    await prisma.packageItem.delete({ where: { id } })
    await refreshPackagePrice(prisma, item.packageId)

    return res.status(204).send()
})
