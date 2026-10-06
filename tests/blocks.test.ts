import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { blocksSchema } from '../src/services/blocks.js'
import { SYSTEM_TEMPLATES } from '../src/services/templates/systemTemplates.js'
import { addMember, createUser, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)

const coverBlock = { id: 'capa', type: 'cover', data: { headline: 'Proposta para {cliente}' } }

function createProposal(auth: string, body: Record<string, unknown>) {
    return request(app)
        .post('/api/proposals')
        .set('Authorization', auth)
        .send({ clientName: 'Cliente Teste', slug: `p-${Math.random().toString(36).slice(2, 10)}`, ...body })
}

describe('modelos do sistema', () => {
    it('todos os modelos do sistema são válidos contra o contrato de blocos', () => {
        expect(SYSTEM_TEMPLATES.length).toBeGreaterThanOrEqual(9)
        for (const template of SYSTEM_TEMPLATES) {
            const parsed = blocksSchema.safeParse(template.blocks)
            expect(parsed.success, `${template.id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true)
            expect(template.blocks.some((b) => b.type === 'pricing'), `${template.id} sem bloco de preços`).toBe(true)
            expect(template.blocks.some((b) => b.type === 'acceptance'), `${template.id} sem bloco de aceite`).toBe(true)
        }
        expect(new Set(SYSTEM_TEMPLATES.map((t) => t.id)).size).toBe(SYSTEM_TEMPLATES.length)
    })
})

describe('proposta em blocos', () => {
    it('criar a partir de um modelo do sistema copia blocos e tema', async () => {
        const a = await createUser()
        const res = await createProposal(a.auth, { providerId: a.provider.id, templateId: 'sys-agency' })
        expect(res.status).toBe(201)
        const template = SYSTEM_TEMPLATES.find((t) => t.id === 'sys-agency')!
        expect(res.body.proposal.templateId).toBe('sys-agency')
        expect(res.body.proposal.blocks).toHaveLength(template.blocks.length)
        expect(res.body.proposal.blocks[0].type).toBe(template.blocks[0].type)
        expect(res.body.proposal.theme).toBe(template.theme)
    })

    it('modelo inexistente → 404 TEMPLATE_NOT_FOUND', async () => {
        const a = await createUser()
        const res = await createProposal(a.auth, { providerId: a.provider.id, templateId: 'sys-nao-existe' })
        expect(res.status).toBe(404)
        expect(res.body.code).toBe('TEMPLATE_NOT_FOUND')
    })

    it('escrita é estrita: tipo de bloco desconhecido, ids repetidos e excesso de blocos → 400', async () => {
        const a = await createUser()
        const unknown = await createProposal(a.auth, { providerId: a.provider.id, blocks: [{ id: 'x', type: 'carrossel', data: {} }] })
        expect(unknown.status).toBe(400)

        const duplicated = await createProposal(a.auth, { providerId: a.provider.id, blocks: [coverBlock, coverBlock] })
        expect(duplicated.status).toBe(400)

        const tooMany = Array.from({ length: 61 }, (_, i) => ({ ...coverBlock, id: `b${i}` }))
        expect((await createProposal(a.auth, { providerId: a.provider.id, blocks: tooMany })).status).toBe(400)
    })

    it('mídia externa nos blocos → 400 UNTRUSTED_MEDIA (criação e edição)', async () => {
        const a = await createUser()
        const gallery = { id: 'g', type: 'gallery', data: { items: [{ url: 'https://evil.example/x.png', type: 'image' }] } }
        const res = await createProposal(a.auth, { providerId: a.provider.id, blocks: [gallery] })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('UNTRUSTED_MEDIA')

        const ok = await createProposal(a.auth, { providerId: a.provider.id, blocks: [coverBlock] })
        const patch = await request(app)
            .patch(`/api/proposals/${ok.body.proposal.id}`)
            .set('Authorization', a.auth)
            .send({ blocks: [{ ...coverBlock, data: { headline: 'x', mediaUrl: 'https://evil.example/v.mp4', mediaType: 'video' } }] })
        expect(patch.status).toBe(400)
        expect(patch.body.code).toBe('UNTRUSTED_MEDIA')
    })

    it('aceita mídia enviada pela própria API', async () => {
        const a = await createUser()
        const gallery = { id: 'g', type: 'gallery', data: { items: [{ url: '/media/public/media/2026/10/foto.png', type: 'image' }] } }
        expect((await createProposal(a.auth, { providerId: a.provider.id, blocks: [gallery] })).status).toBe(201)
    })

    it('texto rico é sanitizado (sem <script> nem handlers)', async () => {
        const a = await createUser()
        const about = {
            id: 'sobre',
            type: 'about',
            data: { body: '<p onclick="alert(1)">Olá <strong>mundo</strong></p><script>alert(1)</script>' }
        }
        const res = await createProposal(a.auth, { providerId: a.provider.id, blocks: [about] })
        expect(res.status).toBe(201)
        const body = res.body.proposal.blocks[0].data.body as string
        expect(body).toContain('<strong>mundo</strong>')
        expect(body).not.toContain('<script')
        expect(body).not.toContain('onclick')
    })

    it('editar blocos persiste; página pública devolve os blocos', async () => {
        const a = await createUser()
        const created = await createProposal(a.auth, { providerId: a.provider.id, slug: 'em-blocos', templateId: 'sys-general' })
        const blocks = [coverBlock, { id: 'faq', type: 'faq', visible: false, data: { items: [{ question: 'Prazo?', answer: '30 dias' }] } }]
        const patch = await request(app).patch(`/api/proposals/${created.body.proposal.id}`).set('Authorization', a.auth).send({ blocks })
        expect(patch.status).toBe(200)

        const pub = await request(app).get('/api/public/proposals/em-blocos')
        expect(pub.status).toBe(200)
        expect(pub.body.proposal.blocks.map((b: { id: string }) => b.id)).toEqual(['capa', 'faq'])
        expect(pub.body.proposal.blocks[1].visible).toBe(false)
    })

    it('proposta legada (sem blocos) continua com blocks null', async () => {
        const a = await createUser()
        const res = await createProposal(a.auth, { providerId: a.provider.id })
        expect(res.status).toBe(201)
        expect(res.body.proposal.blocks).toBeNull()
    })
})

describe('modelos da empresa', () => {
    it('salvar proposta como modelo, listar, usar e excluir', async () => {
        const a = await createUser()
        const proposal = await createProposal(a.auth, { providerId: a.provider.id, templateId: 'sys-consulting' })

        const saved = await request(app)
            .post('/api/templates')
            .set('Authorization', a.auth)
            .send({ name: 'Meu modelo', fromProposalId: proposal.body.proposal.id })
        expect(saved.status).toBe(201)
        expect(saved.body.template.blocks).toHaveLength(proposal.body.proposal.blocks.length)

        const list = await request(app).get('/api/templates').set('Authorization', a.auth)
        expect(list.status).toBe(200)
        expect(list.body.system.length).toBeGreaterThanOrEqual(9)
        expect(list.body.workspace.map((t: { id: string }) => t.id)).toEqual([saved.body.template.id])

        const fromOwn = await createProposal(a.auth, { providerId: a.provider.id, templateId: saved.body.template.id })
        expect(fromOwn.status).toBe(201)
        expect(fromOwn.body.proposal.blocks).toEqual(proposal.body.proposal.blocks)

        expect((await request(app).delete(`/api/templates/${saved.body.template.id}`).set('Authorization', a.auth)).status).toBe(204)
        expect(await prisma.proposalTemplate.count()).toBe(0)
    })

    it('plano Grátis/Essencial não salva modelos próprios → 402 PLAN_LIMIT', async () => {
        const free = await createUser('Grátis', { planTier: 'FREE', billingStatus: 'ACTIVE' })
        const res = await request(app).post('/api/templates').set('Authorization', free.auth).send({ name: 'Modelo', blocks: [coverBlock] })
        expect(res.status).toBe(402)
        expect(res.body.code).toBe('PLAN_LIMIT')

        const starter = await createUser('Essencial', { planTier: 'STARTER', billingStatus: 'ACTIVE' })
        expect((await request(app).post('/api/templates').set('Authorization', starter.auth).send({ name: 'Modelo', blocks: [coverBlock] })).status).toBe(402)
    })

    it('MEMBER não cria modelos (403)', async () => {
        const a = await createUser()
        const m = await addMember(a.workspace.id, 'MEMBER')
        const res = await request(app).post('/api/templates').set('Authorization', m.auth).send({ name: 'Modelo', blocks: [coverBlock] })
        expect(res.status).toBe(403)
    })

    it('proposta sem blocos não vira modelo (400 NOT_BLOCKS)', async () => {
        const a = await createUser()
        const legacy = await createProposal(a.auth, { providerId: a.provider.id })
        const res = await request(app).post('/api/templates').set('Authorization', a.auth).send({ name: 'Modelo', fromProposalId: legacy.body.proposal.id })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('NOT_BLOCKS')
    })

    it('isolamento: modelo de outra empresa não aparece, não é usado nem excluído', async () => {
        const a = await createUser('Empresa A')
        const b = await createUser('Empresa B')
        const saved = await request(app).post('/api/templates').set('Authorization', a.auth).send({ name: 'Segredo', blocks: [coverBlock] })
        expect(saved.status).toBe(201)
        const id = saved.body.template.id

        expect((await request(app).get('/api/templates').set('Authorization', b.auth)).body.workspace).toEqual([])
        const use = await createProposal(b.auth, { providerId: b.provider.id, templateId: id })
        expect(use.status).toBe(404)
        expect((await request(app).delete(`/api/templates/${id}`).set('Authorization', b.auth)).status).toBe(404)
        const fromForeignProposal = await createProposal(a.auth, { providerId: a.provider.id, blocks: [coverBlock] })
        expect(
            (await request(app).post('/api/templates').set('Authorization', b.auth).send({ name: 'Copia', fromProposalId: fromForeignProposal.body.proposal.id })).status
        ).toBe(404)
    })
})

describe('formulário do painel', () => {
    it('campos opcionais vazios ("") não impedem criar a proposta', async () => {
        const a = await createUser()
        const res = await createProposal(a.auth, { providerId: a.provider.id, heroVideoUrl: '', weddingPhotoUrl: '', serviceDate: '', templateId: 'sys-general' })
        expect(res.status).toBe(201)
        expect(res.body.proposal.heroVideoUrl).toBeNull()
    })
})
