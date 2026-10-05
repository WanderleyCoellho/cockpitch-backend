import { Router } from 'express'
import { prisma } from '../lib/prisma.js'

export const healthRouter = Router()

// Liveness: o processo está de pé.
healthRouter.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'cockpitch-backend', timestamp: new Date().toISOString() })
})

// Readiness: o banco responde (usar como healthcheck de deploy no Railway).
healthRouter.get('/health/ready', async (_req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`
        res.json({ ok: true, database: 'up' })
    } catch {
        res.status(503).json({ ok: false, database: 'down' })
    }
})
