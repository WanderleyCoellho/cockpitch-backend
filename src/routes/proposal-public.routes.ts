import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { serializePackage } from '../services/package.service.js'

export const proposalPublicRouter = Router()

proposalPublicRouter.get('/proposals/:slug', async (req, res) => {
    const { slug } = req.params

    const proposal = await prisma.proposal.findUnique({
        where: { slug },
        include: {
            // Perfil público: sem userId nem timestamps internos.
            provider: {
                omit: { userId: true, createdAt: true, updatedAt: true }
            },
            packageIds: {
                include: { items: { orderBy: { order: 'asc' } } },
                orderBy: { order: 'asc' }
            }
        }
    })

    if (!proposal) {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    // Propostas arquivadas não ficam acessíveis pelo link público.
    if (proposal.status === 'ARQUIVADA') {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    return res.json({ proposal: { ...proposal, packageIds: proposal.packageIds.map(serializePackage) } })
})
