import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { requireRole, requireWorkspace, workspaceIdOf } from '../middlewares/workspaceMiddleware.js'
import { LIMITS } from '../services/pricing.js'
import { isTrustedUploadUrl } from '../lib/trustedUploadUrl.js'
import { legacyPriceToFields, refreshPackagePrice, serializePackage } from '../services/package.service.js'

const createPackageSchema = z.object({
    providerId: z.string().cuid(),
    name: z.string().trim().min(2).max(120),
    // null limpa o campo (o painel reenvia o que veio do banco ao editar).
    description: z.string().max(2000).nullable().optional(),
    /** Legado: preço em texto. Preferir priceMode + fixedPriceCents. */
    price: z.string().max(60).optional(),
    priceMode: z.enum(['SUM_OF_ITEMS', 'FIXED', 'ON_REQUEST']).optional(),
    fixedPriceCents: z.number().int().min(0).max(LIMITS.maxUnitPriceCents).nullable().optional(),
    discountType: z.enum(['NONE', 'PERCENT', 'AMOUNT']).optional(),
    discountValue: z.number().int().min(0).max(LIMITS.maxUnitPriceCents).optional(),
    priceLabel: z.string().trim().max(60).nullable().optional(),
    order: z.number().int().min(0).max(10_000).optional(),
    isHighlighted: z.boolean().default(false),
    highlightLabel: z.string().max(60).nullable().optional(),
    highlightColor: z.string().max(30).nullable().optional(),
    mediaUrl: z.string().max(2000).nullable().optional(),
    mediaType: z.string().max(20).nullable().optional()
})

const percentWithinLimit = (body: { discountType?: string; discountValue?: number }) =>
    body.discountType !== 'PERCENT' || (body.discountValue ?? 0) <= LIMITS.maxPercentBps

const createPackageWithRules = createPackageSchema.refine(percentWithinLimit, {
    message: 'Desconto percentual máximo é 100%',
    path: ['discountValue']
})

const updatePackageSchema = createPackageSchema
    .partial()
    .refine((payload) => Object.keys(payload).length > 0, { message: 'At least one field is required' })
    .refine(percentWithinLimit, { message: 'Desconto percentual máximo é 100%', path: ['discountValue'] })

/** Separa o `price` legado dos campos novos e converte quando só ele veio. */
function toPackageData<T extends { price?: string; priceMode?: unknown; fixedPriceCents?: unknown }>(data: T) {
    const { price, ...rest } = data
    const usesNewFields = rest.priceMode !== undefined || rest.fixedPriceCents !== undefined
    return usesNewFields ? rest : { ...rest, ...legacyPriceToFields(price) }
}

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

    return res.json({ packages: packages.map(serializePackage) })
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

    return res.json({ package: serializePackage(pkg) })
})

packageRouter.post('/', requireRole('ADMIN'), async (req: AuthenticatedRequest, res) => {
    const auth = req.auth

    if (!auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const parsed = createPackageWithRules.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    if (parsed.data.mediaUrl && !isTrustedUploadUrl(parsed.data.mediaUrl, req)) {
        return res.status(400).json({ message: 'Use uma imagem ou vídeo enviado pelo Lumen Deal.', code: 'UNTRUSTED_MEDIA' })
    }

    const provider = await verifyProviderOwnership(auth, parsed.data.providerId)
    if (!provider) {
        return res.status(403).json({ message: 'Access denied' })
    }

    const created = await prisma.package.create({
        data: { ...toPackageData(parsed.data), price: '0.00' },
        select: { id: true }
    })
    await refreshPackagePrice(prisma, created.id)
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } })

    return res.status(201).json({ package: serializePackage(pkg) })
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
    // Mídia nova precisa ser enviada pelo Lumen Deal; a que já estava salva (legado) continua aceita.
    if (pkg && parsed.data.mediaUrl && parsed.data.mediaUrl !== pkg.mediaUrl && !isTrustedUploadUrl(parsed.data.mediaUrl, req)) {
        return res.status(400).json({ message: 'Use uma imagem ou vídeo enviado pelo Lumen Deal.', code: 'UNTRUSTED_MEDIA' })
    }

    if (!pkg) {
        return res.status(404).json({ message: 'Package not found' })
    }

    // O provider de um pacote não muda (evita mover pacote para outro workspace).
    const { providerId: _providerId, ...data } = parsed.data
    await prisma.package.update({ where: { id }, data: toPackageData(data) })
    await refreshPackagePrice(prisma, id)
    const updated = await prisma.package.findUniqueOrThrow({ where: { id }, include: { items: true } })

    return res.json({ package: serializePackage(updated) })
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
