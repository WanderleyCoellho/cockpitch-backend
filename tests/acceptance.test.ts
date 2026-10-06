import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { createUser, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)

const acceptanceBlock = (data: Record<string, unknown> = {}) => ({
    id: 'aceite',
    type: 'acceptance',
    data: { intro: '', allowDecline: true, allowChangeRequest: true, requireDocument: false, ...data }
})

let slugCounter = 0

async function setup(opts: { blocks?: unknown[] | null; validityDays?: number; packages?: number } = {}) {
    const a = await createUser()
    const packages = []
    for (let i = 0; i < (opts.packages ?? 1); i++) {
        const pkg = await prisma.package.create({
            data: {
                providerId: a.provider.id,
                name: `Pacote ${i + 1}`,
                price: '1350.00',
                priceMode: 'SUM_OF_ITEMS',
                discountType: 'PERCENT',
                discountValue: 1000,
                items: {
                    create: [
                        { name: 'Horas', kind: 'INCLUDED', quantity: 10, unitPriceCents: 10000, order: 0 },
                        { name: 'Relatório extra', kind: 'OPTIONAL', quantity: 1, unitPriceCents: 50000, order: 1 }
                    ]
                }
            },
            include: { items: true }
        })
        packages.push(pkg)
    }
    slugCounter += 1
    const slug = `aceite-${slugCounter}`
    const created = await request(app)
        .post('/api/proposals')
        .set('Authorization', a.auth)
        .send({
            providerId: a.provider.id,
            clientName: 'Cliente Teste',
            slug,
            validityDays: opts.validityDays ?? 30,
            packageIds: packages.map((p) => p.id),
            blocks: opts.blocks === undefined ? [{ id: 'capa', type: 'cover', data: { headline: 'Oi' } }, acceptanceBlock()] : opts.blocks
        })
    expect(created.status).toBe(201)
    return { a, slug, proposalId: created.body.proposal.id as string, packages }
}

const signer = { signerName: 'Maria da Silva', signerEmail: 'Maria@Example.com' }

function respond(slug: string, body: Record<string, unknown>) {
    return request(app).post(`/api/public/proposals/${slug}/responses`).set('User-Agent', 'vitest-browser').send(body)
}

describe('marca na página pública', () => {
    it('Grátis mostra "Feito com Lumen Deal"; planos pagos removem; o plano não é exposto', async () => {
        const free = await createUser('Grátis', { planTier: 'FREE', billingStatus: 'ACTIVE' })
        const pro = await createUser('Pro', { planTier: 'PRO', billingStatus: 'ACTIVE' })
        for (const [u, slug] of [[free, 'marca-gratis'], [pro, 'marca-pro']] as const) {
            await request(app).post('/api/proposals').set('Authorization', u.auth).send({ providerId: u.provider.id, clientName: 'Cliente', slug })
        }
        const a = await request(app).get('/api/public/proposals/marca-gratis')
        const b = await request(app).get('/api/public/proposals/marca-pro')
        expect(a.body.branding).toEqual({ removeBranding: false })
        expect(b.body.branding).toEqual({ removeBranding: true })
        expect(JSON.stringify(b.body)).not.toContain('planTier')
        expect(b.body.proposal.provider.workspace).toBeUndefined()
    })
})

describe('aceite online', () => {
    it('aceite válido: 201, total calculado no servidor, evidência e status atualizados', async () => {
        const { slug, proposalId, packages } = await setup()
        const optional = packages[0].items.find((i) => i.kind === 'OPTIONAL')!
        const res = await respond(slug, {
            type: 'ACCEPTED',
            ...signer,
            signerDocument: '123.456.789-00',
            packageId: packages[0].id,
            optionalItemIds: [optional.id],
            agreeTerms: true,
            // o navegador não manda o total; se mandasse, seria ignorado
            totalCents: 1
        })
        expect(res.status).toBe(201)
        // (10 × 100,00 + 500,00) − 10% = 1.350,00
        expect(res.body.response.totalCents).toBe(135000)
        expect(res.body.response.contentHash).toMatch(/^[a-f0-9]{64}$/)
        expect(res.body.response.selection).toMatchObject({ packageName: 'Pacote 1', optionals: [{ name: 'Relatório extra', cents: 50000 }] })

        const proposal = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })
        expect(proposal).toMatchObject({ status: 'FECHADA', commercialStatus: 'ACEITA' })
        const stored = await prisma.proposalResponse.findFirstOrThrow({ where: { proposalId } })
        expect(stored).toMatchObject({ signerEmail: 'maria@example.com', userAgent: 'vitest-browser' })
        expect(stored.ip).toBeTruthy()

        const pub = await request(app).get(`/api/public/proposals/${slug}`)
        expect(pub.body.acceptance).toMatchObject({ enabled: true, state: 'ACCEPTED', acceptedBy: 'Maria da Silva' })
        expect(JSON.stringify(pub.body.acceptance)).not.toContain('example.com')
        expect(pub.body.acceptance.accepted).toEqual({
            packageId: packages[0].id,
            optionalIds: [optional.id],
            packageName: 'Pacote 1',
            optionals: ['Relatório extra'],
            totalCents: 135000,
            contentHash: res.body.response.contentHash
        })
        expect(JSON.stringify(pub.body.acceptance)).not.toContain('123.456')
    })

    it('segundo aceite → 409; respostas simultâneas: só uma vence', async () => {
        const { slug, proposalId } = await setup()
        const body = { type: 'ACCEPTED', ...signer, agreeTerms: true }
        const results = await Promise.all([respond(slug, body), respond(slug, body), respond(slug, body)])
        expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
        expect(results.find((r) => r.status === 409)!.body.code).toBe('ALREADY_ACCEPTED')
        expect(await prisma.proposalResponse.count({ where: { proposalId } })).toBe(1)
    })

    it('proposta vencida → 409 EXPIRED', async () => {
        const { slug, proposalId } = await setup({ validityDays: 1 })
        await prisma.proposal.update({ where: { id: proposalId }, data: { createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) } })
        const res = await respond(slug, { type: 'ACCEPTED', ...signer, agreeTerms: true })
        expect(res.status).toBe(409)
        expect(res.body.code).toBe('EXPIRED')
        expect((await request(app).get(`/api/public/proposals/${slug}`)).body.acceptance.state).toBe('EXPIRED')
    })

    it('sem agreeTerms=true → 400; e-mail inválido → 400', async () => {
        const { slug } = await setup()
        expect((await respond(slug, { type: 'ACCEPTED', ...signer })).status).toBe(400)
        expect((await respond(slug, { type: 'ACCEPTED', ...signer, agreeTerms: false })).status).toBe(400)
        expect((await respond(slug, { type: 'ACCEPTED', signerName: 'Maria', signerEmail: 'nao-e-email', agreeTerms: true })).status).toBe(400)
    })

    it('recusa → NEGADA e pedido de ajuste → NEGOCIANDO; a proposta continua aberta', async () => {
        const { slug, proposalId } = await setup()
        expect((await respond(slug, { type: 'CHANGE_REQUESTED', ...signer, message: 'Dá para incluir mais 2 horas?' })).status).toBe(201)
        expect(await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).toMatchObject({ status: 'ABERTA', commercialStatus: 'NEGOCIANDO' })
        expect((await respond(slug, { type: 'DECLINED', ...signer })).status).toBe(201)
        expect(await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).toMatchObject({ status: 'ABERTA', commercialStatus: 'NEGADA' })
        // ainda pode aceitar depois
        expect((await respond(slug, { type: 'ACCEPTED', ...signer, agreeTerms: true })).status).toBe(201)
    })

    it('valida a seleção: pacote de fora, opcional de outro pacote, pacote obrigatório com mais de um', async () => {
        const { slug, packages } = await setup({ packages: 2 })
        const otherOptional = packages[1].items.find((i) => i.kind === 'OPTIONAL')!
        const included = packages[0].items.find((i) => i.kind === 'INCLUDED')!
        const base = { type: 'ACCEPTED', ...signer, agreeTerms: true }

        const missing = await respond(slug, base)
        expect(missing.status).toBe(400)
        expect(missing.body.code).toBe('PACKAGE_REQUIRED')
        expect((await respond(slug, { ...base, packageId: packages[0].id, optionalItemIds: [otherOptional.id] })).body.code).toBe('INVALID_SELECTION')
        expect((await respond(slug, { ...base, packageId: packages[0].id, optionalItemIds: [included.id] })).body.code).toBe('INVALID_SELECTION')

        const foreign = await setup()
        expect((await respond(slug, { ...base, packageId: foreign.packages[0].id })).body.code).toBe('INVALID_SELECTION')
    })

    it('só aceita respostas quando o bloco de aceite está visível; respeita opções do bloco', async () => {
        const legacy = await setup({ blocks: null })
        const res = await respond(legacy.slug, { type: 'ACCEPTED', ...signer, agreeTerms: true })
        expect(res.status).toBe(409)
        expect(res.body.code).toBe('NOT_ENABLED')
        expect((await request(app).get(`/api/public/proposals/${legacy.slug}`)).body.acceptance.enabled).toBe(false)

        const hidden = await setup({ blocks: [{ ...acceptanceBlock(), visible: false }] })
        expect((await respond(hidden.slug, { type: 'ACCEPTED', ...signer, agreeTerms: true })).body.code).toBe('NOT_ENABLED')

        const strict = await setup({ blocks: [acceptanceBlock({ allowDecline: false, requireDocument: true })] })
        expect((await respond(strict.slug, { type: 'DECLINED', ...signer })).body.code).toBe('NOT_ALLOWED')
        expect((await respond(strict.slug, { type: 'ACCEPTED', ...signer, agreeTerms: true })).body.code).toBe('DOCUMENT_REQUIRED')
        expect((await respond(strict.slug, { type: 'ACCEPTED', ...signer, agreeTerms: true, signerDocument: '12.345.678/0001-90' })).status).toBe(201)
    })

    it('painel: lista em ordem cronológica com IP e data; reabrir mantém o histórico; isolamento entre empresas', async () => {
        const { a, slug, proposalId } = await setup()
        await respond(slug, { type: 'CHANGE_REQUESTED', ...signer, message: 'Pode ajustar o prazo?' })
        await respond(slug, { type: 'ACCEPTED', ...signer, agreeTerms: true })

        const list = await request(app).get(`/api/proposals/${proposalId}/responses`).set('Authorization', a.auth)
        expect(list.status).toBe(200)
        expect(list.body.responses.map((r: { type: string }) => r.type)).toEqual(['CHANGE_REQUESTED', 'ACCEPTED'])
        expect(list.body.responses[0].ip).toBeTruthy()
        expect(list.body.responses[0].createdAt).toBeTruthy()

        const proposals = await request(app).get(`/api/proposals/provider/${a.provider.id}`).set('Authorization', a.auth)
        expect(proposals.body.proposals[0]).toMatchObject({ responsesCount: 2, lastResponse: { type: 'ACCEPTED', signerName: 'Maria da Silva' } })

        const b = await createUser('Outra Empresa')
        expect((await request(app).get(`/api/proposals/${proposalId}/responses`).set('Authorization', b.auth)).status).toBe(404)
        expect((await request(app).post(`/api/proposals/${proposalId}/reopen`).set('Authorization', b.auth)).status).toBe(404)

        const reopened = await request(app).post(`/api/proposals/${proposalId}/reopen`).set('Authorization', a.auth)
        expect(reopened.status).toBe(200)
        expect(reopened.body.proposal).toMatchObject({ status: 'ABERTA', commercialStatus: 'NEGOCIANDO' })
        expect((await request(app).post(`/api/proposals/${proposalId}/reopen`).set('Authorization', a.auth)).status).toBe(409)
        expect(await prisma.proposalResponse.count({ where: { proposalId } })).toBe(2)
        expect((await respond(slug, { type: 'ACCEPTED', ...signer, agreeTerms: true })).status).toBe(201)
    })

    it('rate limit: no máximo 5 respostas por hora por IP na mesma proposta', async () => {
        const { slug } = await setup()
        const statuses = []
        for (let i = 0; i < 6; i++) statuses.push((await respond(slug, { type: 'DECLINED', ...signer })).status)
        expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201])
        expect(statuses[5]).toBe(429)
    })

    it('o hash muda quando o conteúdo ou a seleção mudam', async () => {
        const { a, slug, proposalId, packages } = await setup()
        const optional = packages[0].items.find((i) => i.kind === 'OPTIONAL')!
        const first = await respond(slug, { type: 'CHANGE_REQUESTED', ...signer, message: 'Primeira versão', packageId: packages[0].id })
        const second = await respond(slug, { type: 'CHANGE_REQUESTED', ...signer, message: 'Com opcional', packageId: packages[0].id, optionalItemIds: [optional.id] })
        await request(app).patch(`/api/proposals/${proposalId}`).set('Authorization', a.auth).send({ blocks: [{ id: 'capa', type: 'cover', data: { headline: 'Mudou' } }, acceptanceBlock()] })
        const third = await respond(slug, { type: 'CHANGE_REQUESTED', ...signer, message: 'Primeira versão', packageId: packages[0].id })
        const hashes = [first, second, third].map((r) => r.body.response.contentHash)
        expect(new Set(hashes).size).toBe(3)
    })
})
