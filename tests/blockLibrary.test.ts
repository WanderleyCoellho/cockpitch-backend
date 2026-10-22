import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { systemLibrary } from '../src/services/block-library.service.js'
import { addMember, createUser, resetDatabase } from './helpers.js'

const contactBlock = {
    id: 'contact', type: 'contact', visible: true, title: 'Fale com a gente',
    data: { message: 'Chame no WhatsApp', showWhatsapp: true, showEmail: false, showInstagram: false }
}

beforeEach(resetDatabase)
afterAll(() => prisma.$disconnect())

describe('biblioteca de blocos', () => {
    it('lista do sistema não repete blocos iguais e não traz preços nem aceite', () => {
        const items = systemLibrary()
        const keys = items.map((i) => `${i.type}:${JSON.stringify(i.block.data)}`)
        expect(new Set(keys).size).toBe(keys.length)
        expect(items.some((i) => i.type === 'pricing' || i.type === 'acceptance')).toBe(false)
        expect(items.filter((i) => i.type === 'terms').length).toBeLessThan(5)
    })

    it('Grátis vê a biblioteca só com nomes (bloqueada) e não salva blocos', async () => {
        const a = await createUser('Free', { planTier: 'FREE', billingStatus: 'INACTIVE' })
        const res = await request(app).get('/api/block-library').set('Authorization', a.auth)
        expect(res.status).toBe(200)
        expect(res.body.access).toEqual({ blockLibrary: false, savedBlocks: false })
        expect(res.body.system.length).toBeGreaterThan(10)
        expect(res.body.system[0].block).toBeUndefined()
        const save = await request(app).post('/api/block-library').set('Authorization', a.auth).send({ name: 'Contato', block: contactBlock })
        expect(save.status).toBe(402)
        expect(save.body.code).toBe('PLAN_LIMIT')
    })

    it('Essencial usa a biblioteca completa, mas não salva blocos próprios', async () => {
        const a = await createUser('Starter', { planTier: 'STARTER', billingStatus: 'ACTIVE' })
        const res = await request(app).get('/api/block-library').set('Authorization', a.auth)
        expect(res.body.access).toEqual({ blockLibrary: true, savedBlocks: false })
        expect(res.body.system[0].block.type).toBe(res.body.system[0].type)
        const save = await request(app).post('/api/block-library').set('Authorization', a.auth).send({ name: 'Contato', block: contactBlock })
        expect(save.status).toBe(402)
    })

    it('Profissional salva um bloco e a equipe toda vê; só quem salvou ou um admin exclui', async () => {
        const a = await createUser('Pro')
        const member = await addMember(a.workspace.id, 'MEMBER')
        const other = await addMember(a.workspace.id, 'MEMBER', 'Outro')

        const save = await request(app).post('/api/block-library').set('Authorization', member.auth).send({ name: 'Contato do site', block: contactBlock })
        expect(save.status).toBe(201)
        const id = save.body.saved.id

        const list = await request(app).get('/api/block-library').set('Authorization', a.auth)
        expect(list.body.access.savedBlocks).toBe(true)
        expect(list.body.saved.map((s: { id: string }) => s.id)).toEqual([id])
        expect(list.body.saved[0].block.data.message).toBe('Chame no WhatsApp')

        expect((await request(app).delete(`/api/block-library/${id}`).set('Authorization', other.auth)).status).toBe(403)
        expect((await request(app).delete(`/api/block-library/${id}`).set('Authorization', a.auth)).status).toBe(204)
    })

    it('recusa bloco inválido, mídia de fora e bloco de outra empresa', async () => {
        const a = await createUser('Pro A')
        const b = await createUser('Pro B')
        const bad = await request(app).post('/api/block-library').set('Authorization', a.auth).send({ name: 'X', block: { ...contactBlock, type: 'nada' } })
        expect(bad.status).toBe(400)
        const external = await request(app)
            .post('/api/block-library')
            .set('Authorization', a.auth)
            .send({ name: 'Capa', block: { id: 'cover', type: 'cover', visible: true, title: '', data: { headline: 'Oi', mediaUrl: 'https://evil.example/x.jpg', mediaType: 'image', showClientName: true } } })
        expect(external.status).toBe(400)
        expect(external.body.code).toBe('UNTRUSTED_MEDIA')

        const saved = await request(app).post('/api/block-library').set('Authorization', a.auth).send({ name: 'Contato', block: contactBlock })
        expect((await request(app).delete(`/api/block-library/${saved.body.saved.id}`).set('Authorization', b.auth)).status).toBe(404)
        const listB = await request(app).get('/api/block-library').set('Authorization', b.auth)
        expect(listB.body.saved).toEqual([])
    })
})
