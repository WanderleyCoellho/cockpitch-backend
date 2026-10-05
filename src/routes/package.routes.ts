import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { requireRole, requireWorkspace, workspaceIdOf } from '../middlewares/workspaceMiddleware.js'

const createPackageSchema = z.object({
    providerId: z.string().cuid(),
    name: z.string().min(3),
    description: z.string().optional(),
    price: z.string().regex(/^\d+(\.\d{2})?$/, 'Invalid price format'),
    isHighlighted: z.boolean().default(false),
    highlightLabel: z.string().optional(),
    highlightColor: z.string().optional(),
    mediaUrl: z.string().optional(),
    mediaType: z.string().optional()
})

const updatePackageSchema = createPackageSchema.partial().refine(
    (payload) => Object.keys(payload).length > 0,
    { message: 'At least one field is required' }
)

export const packageRouter = Router()

packageRouter.use(requireAuth, requireWorkspace)

// Helper para validar propriedade do provider
async function verifyProviderOwnership(auth: any, providerId: string) {
    const provider = await prisma.provider.findFirst({
        where: {
            id: providerId,
            workspaceId: workspaceIdOf(auth)
        }
    })
    return provider
}

packageRouter.get('/provider/:providerId', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { providerId } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const provider = await verifyProviderOwnership(auth, providerId)
    if (!provider) {
        return res.status(403).json({ message: 'Access denied' })
    }

    const packages = await prisma.package.findMany({
        where: { providerId },
        include: { items: true },
        orderBy: { order: 'asc' }
    })

    return res.json({ packages })
})

packageRouter.get('/:id', async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { id } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const pkg = await prisma.package.findFirst({
        where: {
            id,
            provider: {
                workspaceId: workspaceIdOf(auth)
            }
        },
        include: { items: true }
    })

    if (!pkg) {
        return res.status(404).json({ message: 'Package not found' })
    }

    return res.json({ package: pkg })
})

packageRouter.post('/', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const auth = req.auth

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const parsed = createPackageSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const provider = await verifyProviderOwnership(auth, parsed.data.providerId)
    if (!provider) {
        return res.status(403).json({ message: 'Access denied' })
    }

    const pkg = await prisma.package.create({
        data: parsed.data,
        include: { items: true }
    })

    return res.status(201).json({ package: pkg })
})

packageRouter.patch('/:id', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { id } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const parsed = updatePackageSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const pkg = await prisma.package.findFirst({
        where: {
            id,
            provider: {
                workspaceId: workspaceIdOf(auth)
            }
        }
    })

    if (!pkg) {
        return res.status(404).json({ message: 'Package not found' })
    }

    const updated = await prisma.package.update({
        where: { id },
        data: parsed.data,
        include: { items: true }
    })

    return res.json({ package: updated })
})

packageRouter.delete('/:id', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const auth = req.auth
    const { id } = req.params

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const pkg = await prisma.package.findFirst({
        where: {
            id,
            provider: {
                workspaceId: workspaceIdOf(auth)
            }
        }
    })

    if (!pkg) {
        return res.status(404).json({ message: 'Package not found' })
    }

    await prisma.package.delete({ where: { id } })

    return res.status(204).send()
})
