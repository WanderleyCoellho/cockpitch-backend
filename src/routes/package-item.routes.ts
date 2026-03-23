import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'

const createPackageItemSchema = z.object({
    packageId: z.string().cuid(),
    name: z.string().min(1),
    isCourtesy: z.boolean().default(false)
})

const updatePackageItemSchema = createPackageItemSchema.partial().refine(
    (payload) => Object.keys(payload).length > 0,
    { message: 'At least one field is required' }
)

export const packageItemRouter = Router()

packageItemRouter.use(requireAuth)

// Helper para validar propriedade do package (indiretamente, do provider)
async function verifyPackageOwnership(auth: any, packageId: string) {
    const pkg = await prisma.package.findFirst({
        where: {
            id: packageId,
            provider: {
                userId: auth.userId
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

    return res.json({ items })
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
                    userId: auth.userId
                }
            }
        }
    })

    if (!item) {
        return res.status(404).json({ message: 'Package item not found' })
    }

    return res.json({ item })
})

packageItemRouter.post('/', async (req: AuthenticatedRequest, res) => {
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

    const item = await prisma.packageItem.create({
        data: parsed.data
    })

    return res.status(201).json({ item })
})

packageItemRouter.patch('/:id', async (req: AuthenticatedRequest, res) => {
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
                    userId: auth.userId
                }
            }
        }
    })

    if (!item) {
        return res.status(404).json({ message: 'Package item not found' })
    }

    const updated = await prisma.packageItem.update({
        where: { id },
        data: parsed.data
    })

    return res.json({ item: updated })
})

packageItemRouter.delete('/:id', async (req: AuthenticatedRequest, res) => {
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
                    userId: auth.userId
                }
            }
        }
    })

    if (!item) {
        return res.status(404).json({ message: 'Package item not found' })
    }

    await prisma.packageItem.delete({ where: { id } })

    return res.status(204).send()
})
