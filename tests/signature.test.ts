import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { isValidCpf } from '../src/lib/cpf.js'
import { prisma } from '../src/lib/prisma.js'
import { createUser, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)

const CPF = '529.982.247-25'
/** PNG 1×1 transparente. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const client = { signerName: 'Maria da Silva', signerEmail: 'maria@cliente.com' }
let counter = 0

async function setup() {
    const a = await createUser('Ana Empresa')
    counter += 1
    const created = await request(app)
        .post('/api/proposals')
        .set('Authorization', a.auth)
        .send({
            providerId: a.provider.id,
            clientName: 'Cliente Teste',
            slug: `assinatura-${counter}`,
            blocks: [
                { id: 'capa', type: 'cover', data: { headline: 'Oi' } },
                { id: 'aceite', type: 'acceptance', data: { intro: '', allowDecline: true, allowChangeRequest: true, requireDocument: false } }
            ]
        })
    expect(created.status).toBe(201)
    return { a, slug: created.body.proposal.slug as string, proposalId: created.body.proposal.id as string }
}

async function lastCode(to: string) {
    const row = await prisma.emailOutbox.findFirstOrThrow({ where: { template: 'signature_code', to: to.toLowerCase() }, orderBy: { createdAt: 'desc' } })
    return (row.payload as { code: string }).code
}

const clientCode = (slug: string) => request(app).post(`/api/public/proposals/${slug}/signature-code`).send(client)
const acceptBody = (code: string, signature: unknown = { method: 'TYPED', typedText: 'Maria da Silva' }) => ({
    type: 'ACCEPTED',
    ...client,
    signerDocument: CPF,
    signature,
    code,
    agreeTerms: true
})
const respond = (slug: string, body: unknown) => request(app).post(`/api/public/proposals/${slug}/responses`).set('User-Agent', 'vitest-browser').send(body)

describe('CPF', () => {
    it('confere os dígitos verificadores', () => {
        expect(isValidCpf(CPF)).toBe(true)
        expect(isValidCpf('52998224725')).toBe(true)
        expect(isValidCpf('529.982.247-24')).toBe(false)
        expect(isValidCpf('111.111.111-11')).toBe(false)
        expect(isValidCpf('123')).toBe(false)
    })
})

describe('assinatura do cliente no aceite', () => {
    it('código por e-mail + CPF + assinatura: grava a assinatura junto com o aceite', async () => {
        const { slug, proposalId } = await setup()
        const sent = await clientCode(slug)
        expect(sent.status).toBe(201)
        expect(sent.body.sentTo).toBe('maria@cliente.com')
        const code = await lastCode(client.signerEmail)
        expect(code).toMatch(/^\d{6}$/)
        // Só o hash fica guardado.
        const stored = await prisma.signatureCode.findFirstOrThrow({ where: { proposalId } })
        expect(stored.codeHash).not.toContain(code)

        const res = await respond(slug, acceptBody(code, { method: 'DRAWN', image: PNG }))
        expect(res.status).toBe(201)
        const signature = await prisma.proposalSignature.findFirstOrThrow({ where: { proposalId, role: 'CLIENT' } })
        expect(signature).toMatchObject({ responseId: res.body.response.id, signerDocument: '52998224725', method: 'DRAWN', image: PNG, contentHash: res.body.response.contentHash, userAgent: 'vitest-browser' })
        expect(signature.emailVerifiedAt).toBeInstanceOf(Date)

        const pub = await request(app).get(`/api/public/proposals/${slug}`)
        expect(pub.body.signatures.client).toMatchObject({ role: 'CLIENT', signerName: 'Maria da Silva', document: '***.982.247-**', method: 'DRAWN' })
        expect(JSON.stringify(pub.body.signatures)).not.toContain('maria@cliente.com')
        expect(pub.body.signatures.client.ip).toBeUndefined()
    })

    it('código errado conta tentativas; depois de 5 trava; código usado não vale de novo', async () => {
        const { slug } = await setup()
        await clientCode(slug)
        const code = await lastCode(client.signerEmail)
        const wrong = code === '000000' ? '111111' : '000000'
        const first = await respond(slug, acceptBody(wrong))
        expect(first.status).toBe(400)
        expect(first.body).toMatchObject({ code: 'CODE_INVALID', message: 'Código incorreto. Restam 4 tentativas.' })
        for (let i = 0; i < 4; i++) await respond(slug, acceptBody(wrong))
        const locked = await respond(slug, acceptBody(code))
        expect(locked.body.code).toBe('CODE_LOCKED')
    })

    it('sem código pedido, código vencido, CPF inválido ou assinatura inválida → 400', async () => {
        const { slug, proposalId } = await setup()
        expect((await respond(slug, acceptBody('123456'))).body.code).toBe('CODE_EXPIRED')
        await clientCode(slug)
        const code = await lastCode(client.signerEmail)
        expect((await respond(slug, { ...acceptBody(code), signerDocument: '529.982.247-24' })).status).toBe(400)
        expect((await respond(slug, acceptBody(code, { method: 'DRAWN', image: 'data:image/svg+xml;base64,PHN2Zz4=' }))).status).toBe(400)
        expect((await respond(slug, { ...acceptBody(code), signature: undefined })).status).toBe(400)
        await prisma.signatureCode.updateMany({ where: { proposalId }, data: { expiresAt: new Date(Date.now() - 1000) } })
        expect((await respond(slug, acceptBody(code))).body.code).toBe('CODE_EXPIRED')
    })

    it('um código por minuto para o mesmo e-mail; proposta fechada não envia código', async () => {
        const { slug, proposalId } = await setup()
        expect((await clientCode(slug)).status).toBe(201)
        const again = await clientCode(slug)
        expect(again.status).toBe(429)
        expect(again.body.code).toBe('CODE_COOLDOWN')
        await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'FECHADA' } })
        await prisma.signatureCode.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 60_000) } })
        expect((await clientCode(slug)).body.code).toBe('CLOSED')
    })
})

describe('assinatura da empresa', () => {
    it('código vai para o e-mail da conta; assina, fica salva no perfil e aparece na página pública', async () => {
        const { a, slug, proposalId } = await setup()
        const sent = await request(app).post(`/api/proposals/${proposalId}/signature/code`).set('Authorization', a.auth)
        expect(sent.status).toBe(201)
        expect(sent.body.sentTo).toBe(a.email.toLowerCase())
        const code = await lastCode(a.email)

        const signed = await request(app)
            .post(`/api/proposals/${proposalId}/signature`)
            .set('Authorization', a.auth)
            .send({ code, cpf: CPF, signerTitle: 'Diretora', signature: { method: 'DRAWN', image: PNG } })
        expect(signed.status).toBe(201)
        expect(signed.body.provider).toMatchObject({ role: 'PROVIDER', signerName: 'Ana Empresa', signerTitle: 'Diretora', document: '529.982.247-25', current: true })
        expect(signed.body.provider.signerEmail).toBe(a.email.toLowerCase())
        expect(signed.body.provider.ip).toBeTruthy()

        const profile = await request(app).get('/api/me/signature').set('Authorization', a.auth)
        expect(profile.body).toMatchObject({ cpf: '529.982.247-25', signature: { method: 'DRAWN', image: PNG, signerTitle: 'Diretora' } })

        const pub = await request(app).get(`/api/public/proposals/${slug}`)
        expect(pub.body.signatures.provider).toMatchObject({ signerName: 'Ana Empresa', document: '***.982.247-**', current: true })
        expect(pub.body.signatures.provider.signerEmail).toBeUndefined()
        expect(pub.body.signatures.client).toBeNull()
    })

    it('editar a proposta depois de assinar pede nova assinatura; a mesma versão não assina duas vezes', async () => {
        const { a, proposalId } = await setup()
        const sign = async () => {
            await prisma.signatureCode.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 60_000) } })
            await request(app).post(`/api/proposals/${proposalId}/signature/code`).set('Authorization', a.auth)
            return request(app)
                .post(`/api/proposals/${proposalId}/signature`)
                .set('Authorization', a.auth)
                .send({ code: await lastCode(a.email), cpf: CPF, signature: { method: 'TYPED', typedText: 'Ana Empresa' } })
        }
        expect((await sign()).status).toBe(201)
        expect((await sign()).body.code).toBe('ALREADY_SIGNED')

        await request(app)
            .patch(`/api/proposals/${proposalId}`)
            .set('Authorization', a.auth)
            .send({ blocks: [{ id: 'capa', type: 'cover', data: { headline: 'Mudou o texto' } }] })
        const after = await request(app).get(`/api/proposals/${proposalId}/signatures`).set('Authorization', a.auth)
        expect(after.body.provider.current).toBe(false)

        const resigned = await sign()
        expect(resigned.status).toBe(201)
        expect(resigned.body.provider.current).toBe(true)
        expect(await prisma.proposalSignature.count({ where: { proposalId, role: 'PROVIDER' } })).toBe(2)
    })

    it('outra empresa não vê nem assina; perfil aceita salvar e apagar a assinatura', async () => {
        const { proposalId } = await setup()
        const b = await createUser('Outra')
        expect((await request(app).post(`/api/proposals/${proposalId}/signature/code`).set('Authorization', b.auth)).status).toBe(404)
        expect((await request(app).get(`/api/proposals/${proposalId}/signatures`).set('Authorization', b.auth)).status).toBe(404)

        const bad = await request(app).put('/api/me/signature').set('Authorization', b.auth).send({ cpf: '000.000.000-00', signature: { method: 'TYPED', typedText: 'B' } })
        expect(bad.status).toBe(400)
        const ok = await request(app).put('/api/me/signature').set('Authorization', b.auth).send({ cpf: CPF, signature: { method: 'TYPED', typedText: 'Bruno Lima' } })
        expect(ok.status).toBe(200)
        expect((await request(app).delete('/api/me/signature').set('Authorization', b.auth)).status).toBe(204)
        expect((await request(app).get('/api/me/signature').set('Authorization', b.auth)).body).toMatchObject({ cpf: null, signature: null })
    })
})
