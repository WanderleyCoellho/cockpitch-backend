import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { createUser, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)

describe('GET /api/public/proposals/:slug', () => {
    it('retorna a proposta sem dados internos (views, userId)', async () => {
        const a = await createUser()
        const proposal = await prisma.proposal.create({
            data: { providerId: a.provider.id, clientName: 'Cliente', slug: 'publica' }
        })
        await prisma.proposalView.create({
            data: { proposalId: proposal.id, proposalSlug: proposal.slug, sessionId: 's1', viewedAt: new Date() }
        })

        const res = await request(app).get('/api/public/proposals/publica')

        expect(res.status).toBe(200)
        expect(res.body.proposal.views).toBeUndefined()
        expect(res.body.proposal.provider.userId).toBeUndefined()
        expect(res.body.proposal.provider.name).toBe(a.provider.name)
    })

    it('proposta arquivada não é acessível publicamente', async () => {
        const a = await createUser()
        await prisma.proposal.create({
            data: { providerId: a.provider.id, clientName: 'Cliente', slug: 'arquivada', status: 'ARQUIVADA' }
        })

        expect((await request(app).get('/api/public/proposals/arquivada')).status).toBe(404)
    })
})

describe('POST /api/proposal-views', () => {
    it('usa o slug e o horário do servidor', async () => {
        const a = await createUser()
        const proposal = await prisma.proposal.create({
            data: { providerId: a.provider.id, clientName: 'Cliente', slug: 'real-slug' }
        })

        const res = await request(app)
            .post('/api/proposal-views')
            .send({ proposalId: proposal.id, proposalSlug: 'forjado', sessionId: 'abc', viewedAt: '2000-01-01T00:00:00Z' })

        expect(res.status).toBe(201)
        const view = await prisma.proposalView.findFirstOrThrow()
        expect(view.proposalSlug).toBe('real-slug')
        expect(view.viewedAt.getFullYear()).toBeGreaterThan(2020)
    })
})
