import { Router } from 'express'
import { prisma } from '../lib/prisma.js'

export const proposalPublicRouter = Router()

proposalPublicRouter.get('/proposals/:slug', async (req, res) => {
    const { slug } = req.params

    const proposal = await prisma.proposal.findUnique({
        where: { slug },
        include: {
            provider: true,
            packageIds: {
                include: { items: true }
            },
            views: true
        }
    })

    if (!proposal) {
        return res.status(404).json({ message: 'Proposal not found' })
    }

    return res.json({ proposal })
})
