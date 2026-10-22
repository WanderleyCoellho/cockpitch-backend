import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { getStorage } from '../lib/storage/index.js'

export const healthRouter = Router()

// Liveness: o processo está de pé.
healthRouter.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'lumen-deal-api', timestamp: new Date().toISOString() })
})

// Readiness: o banco responde (healthcheck de deploy no Railway).
// O storage é reportado, mas não derruba o healthcheck: sem ele a API ainda atende o resto.
healthRouter.get('/health/ready', async (_req, res) => {
    let database: 'up' | 'down' = 'up'
    try {
        await prisma.$queryRaw`SELECT 1`
    } catch {
        database = 'down'
    }

    let storage: 'up' | 'down' = 'up'
    const driver = getStorage()
    try {
        await driver.exists('public/.healthcheck')
    } catch (error) {
        storage = 'down'
        console.error('[health] storage check failed', error)
    }

    const body = { ok: database === 'up', database, storage, storageDriver: driver.kind }
    res.status(database === 'up' ? 200 : 503).json(body)
})
