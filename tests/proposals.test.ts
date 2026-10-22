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
        expect(dup.body.code).toBe('SLUG_TAKEN')
        expect(dup.body.suggestion).toBe('mesmo-slug-2')
        expect(dup.body.message).toContain('/p/mesmo-slug-2')

        // Link de outra empresa também conta (o link é público); trocar para um link em uso idem.
        const b = await createUser('Outra')
        const other = await request(app).post('/api/proposals').set('Authorization', b.auth).send({ providerId: b.provider.id, clientName: 'Cliente', slug: 'link-b' })
        const change = await request(app).patch(`/api/proposals/${other.body.proposal.id}`).set('Authorization', b.auth).send({ slug: 'mesmo-slug' })
        expect(change.status).toBe(409)
        expect(change.body.code).toBe('SLUG_TAKEN')

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

describe('link da proposta e envio', () => {
    it('Profissional escolhe o link; Grátis e Essencial recebem link gerado e não podem trocar', async () => {
        const pro = await createUser('Pro', { planTier: 'PRO', billingStatus: 'ACTIVE' })
        const free = await createUser('Livre', { planTier: 'FREE', billingStatus: 'INACTIVE' })
        const make = (u: Awaited<ReturnType<typeof createUser>>, slug?: string) =>
            request(app).post('/api/proposals').set('Authorization', u.auth).send({ providerId: u.provider.id, clientName: 'Maria & João', slug })

        const custom = await make(pro, 'maria-e-joao')
        expect(custom.body.proposal.slug).toBe('maria-e-joao')
        expect((await make(pro, 'Com Espaço!')).status).toBe(400)

        const generated = await make(free, 'quero-esse')
        expect(generated.status).toBe(201)
        expect(generated.body.proposal.slug).toMatch(/^maria-joao-[a-f0-9]{6}$/)

        const id = generated.body.proposal.id
        const change = await request(app).patch(`/api/proposals/${id}`).set('Authorization', free.auth).send({ slug: 'outro-link' })
        expect(change.status).toBe(402)
        // Reenviar o mesmo link (formulário salvo de novo) não é troca.
        const same = await request(app).patch(`/api/proposals/${id}`).set('Authorization', free.auth).send({ slug: generated.body.proposal.slug, clientName: 'Maria e João' })
        expect(same.status).toBe(200)
    })

    it('marca a proposta como enviada ao copiar o link (uma vez só)', async () => {
        const a = await createUser('Ana')
        const created = await request(app).post('/api/proposals').set('Authorization', a.auth).send({ providerId: a.provider.id, clientName: 'Cliente X' })
        const id = created.body.proposal.id
        expect(created.body.proposal.sharedAt).toBeNull()
        const first = await request(app).post(`/api/proposals/${id}/shared`).set('Authorization', a.auth)
        const second = await request(app).post(`/api/proposals/${id}/shared`).set('Authorization', a.auth)
        expect(first.status).toBe(200)
        expect(second.body.sharedAt).toBe(first.body.sharedAt)
        const other = await createUser('Outra')
        expect((await request(app).post(`/api/proposals/${id}/shared`).set('Authorization', other.auth)).status).toBe(404)
    })

    it('editar com campos vazios vindos do banco (null) salva normalmente', async () => {
        const a = await createUser('Ana')
        const created = await request(app).post('/api/proposals').set('Authorization', a.auth).send({ providerId: a.provider.id, clientName: 'Cliente Y' })
        const res = await request(app)
            .patch(`/api/proposals/${created.body.proposal.id}`)
            .set('Authorization', a.auth)
            .send({ clientName: 'Cliente Y2', heroVideoUrl: null, weddingPhotoUrl: '', serviceDate: null })
        expect(res.status).toBe(200)
        expect(res.body.proposal).toMatchObject({ clientName: 'Cliente Y2', heroVideoUrl: null, weddingPhotoUrl: null, serviceDate: null })
    })
})
