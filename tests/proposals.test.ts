import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { createPackage, createUser, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)

describe('POST /api/proposals', () => {
    it('cria proposta com pacotes do próprio provider', async () => {
        const a = await createUser()
        const pkg = await createPackage(a.provider.id)

        const res = await request(app)
            .post('/api/proposals')
            .set('Authorization', a.auth)
            .send({ providerId: a.provider.id, packageIds: [pkg.id], clientName: 'Cliente', slug: 'cliente-1' })

        expect(res.status).toBe(201)
        expect(res.body.proposal.packageIds).toHaveLength(1)
    })

    it('rejeita pacotes de outro usuário (IDOR) com 403', async () => {
        const a = await createUser()
        const b = await createUser()
        const foreignPkg = await createPackage(a.provider.id)

        const res = await request(app)
            .post('/api/proposals')
            .set('Authorization', b.auth)
            .send({ providerId: b.provider.id, packageIds: [foreignPkg.id], clientName: 'Cliente', slug: 'cliente-2' })

        expect(res.status).toBe(403)
        expect(await prisma.proposal.count()).toBe(0)
    })

    it('slug duplicado responde 409 e a API continua de pé', async () => {
        const a = await createUser()
        const body = { providerId: a.provider.id, clientName: 'Cliente', slug: 'mesmo-slug' }

        expect((await request(app).post('/api/proposals').set('Authorization', a.auth).send(body)).status).toBe(201)
        const dup = await request(app).post('/api/proposals').set('Authorization', a.auth).send(body)
        expect(dup.status).toBe(409)
        expect(dup.body.code).toBe('CONFLICT')

        const health = await request(app).get('/api/health')
        expect(health.status).toBe(200)
    })
})

describe('PATCH /api/proposals/:id', () => {
    it('rejeita troca para pacotes de outro usuário', async () => {
        const a = await createUser()
        const b = await createUser()
        const foreignPkg = await createPackage(a.provider.id)
        const proposal = await prisma.proposal.create({
            data: { providerId: b.provider.id, clientName: 'Cliente', slug: 'cliente-b' }
        })

        const res = await request(app)
            .patch(`/api/proposals/${proposal.id}`)
            .set('Authorization', b.auth)
            .send({ packageIds: [foreignPkg.id] })

        expect(res.status).toBe(403)
    })

    it('não permite editar proposta de outro usuário', async () => {
        const a = await createUser()
        const b = await createUser()
        const proposal = await prisma.proposal.create({
            data: { providerId: a.provider.id, clientName: 'Cliente', slug: 'cliente-a' }
        })

        const res = await request(app)
            .patch(`/api/proposals/${proposal.id}`)
            .set('Authorization', b.auth)
            .send({ clientName: 'Invasor' })

        expect(res.status).toBe(404)
    })
})
