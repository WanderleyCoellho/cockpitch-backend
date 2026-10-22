import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { signOpsAccessToken } from '../src/lib/opsJwt.js'
import { buildObjectKey, isValidObjectKey } from '../src/lib/storage/index.js'
import { createUser, resetDatabase } from './helpers.js'

// PNG 1x1 real (assinatura válida para o file-type).
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
)
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')

beforeEach(resetDatabase)

function pathOf(url: string) {
    return new URL(url).pathname
}

describe('upload de mídia', () => {
    it('salva no storage e serve por /media com link estável', async () => {
        const a = await createUser()
        const res = await request(app)
            .post('/api/upload')
            .set('Authorization', a.auth)
            .attach('file', PNG, { filename: 'Foto da Capa.png', contentType: 'image/png' })

        expect(res.status).toBe(201)
        expect(res.body.file_url).toMatch(/\/media\/public\/media\/\d{4}\/\d{2}\/[a-f0-9]{24}-foto-da-capa\.png$/)

        const media = await request(app).get(pathOf(res.body.file_url))
        expect(media.status).toBe(200)
        expect(media.headers['content-type']).toBe('image/png')
        expect(Buffer.compare(media.body, PNG)).toBe(0)
    })

    it('rejeita arquivo que não é mídia (assinatura real)', async () => {
        const a = await createUser()
        const res = await request(app)
            .post('/api/upload')
            .set('Authorization', a.auth)
            .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' })

        expect(res.status).toBe(400)
    })

    it('aceita logo em SVG simples e recusa SVG com script ou link externo', async () => {
        const a = await createUser()
        const send = (svg: string, contentType = 'image/svg+xml', filename = 'logo.svg') =>
            request(app).post('/api/upload').set('Authorization', a.auth).attach('file', Buffer.from(svg), { filename, contentType })

        const ok = await send('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect width="10" height="10" fill="url(#g)"/></svg>')
        expect(ok.status).toBe(201)
        expect(ok.body.file_url).toMatch(/\.svg$/)
        const media = await request(app).get(pathOf(ok.body.file_url))
        expect(media.headers['content-type']).toContain('image/svg+xml')
        expect(media.headers['content-security-policy']).toContain('sandbox')

        expect((await send('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).status).toBe(400)
        expect((await send('<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)"/></svg>')).status).toBe(400)
        expect((await send('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>')).status).toBe(400)
        expect((await send('<html><body>oi</body></html>')).status).toBe(400)
        // SVG disfarçado de PNG continua recusado.
        expect((await send('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/png', 'logo.png')).status).toBe(400)
    })

    it('exige autenticação', async () => {
        const res = await request(app).post('/api/upload').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
        expect(res.status).toBe(401)
    })
})

describe('/media', () => {
    it('nunca serve objetos privados nem caminhos inválidos', async () => {
        expect((await request(app).get('/media/private/receipts/2026/10/abc-comprovante.pdf')).status).toBe(404)
        expect((await request(app).get('/media/public/../private/x.pdf')).status).toBe(404)
        expect((await request(app).get('/media/public/media/2026/10/nao-existe.png')).status).toBe(404)
    })

    it('valida chaves de objeto', () => {
        expect(isValidObjectKey('public/media/2026/10/abc-foto.png')).toBe(true)
        expect(isValidObjectKey('public/../private/x')).toBe(false)
        expect(isValidObjectKey('/etc/passwd')).toBe(false)
        expect(isValidObjectKey('other/x.png')).toBe(false)
        const key = buildObjectKey({ visibility: 'private', folder: 'receipts', originalName: 'Comprovante Pix (1).pdf', extension: '.pdf' })
        expect(key).toMatch(/^private\/receipts\/\d{4}\/\d{2}\/[a-f0-9]{24}-comprovante-pix-1\.pdf$/)
    })
})

describe('URLs de mídia aceitas no perfil/proposta', () => {
    it('aceita só mídia pública da própria API', async () => {
        const a = await createUser()
        const up = await request(app)
            .post('/api/upload')
            .set('Authorization', a.auth)
            .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })

        const ok = await request(app)
            .patch(`/api/providers/${a.provider.id}`)
            .set('Authorization', a.auth)
            .set('Host', new URL(up.body.file_url).host)
            .send({ logoUrl: up.body.file_url })
        expect(ok.status).toBe(200)

        const external = await request(app)
            .patch(`/api/providers/${a.provider.id}`)
            .set('Authorization', a.auth)
            .send({ logoUrl: 'https://malicioso.example/logo.png' })
        expect(external.status).toBe(400)

        const privateUrl = up.body.file_url.replace('/media/public/', '/media/private/')
        const priv = await request(app)
            .patch(`/api/providers/${a.provider.id}`)
            .set('Authorization', a.auth)
            .set('Host', new URL(up.body.file_url).host)
            .send({ logoUrl: privateUrl })
        expect(priv.status).toBe(400)
    })
})

describe('comprovantes', () => {
    it('ficam no espaço privado e só o Ops abre', async () => {
        const a = await createUser()
        const res = await request(app)
            .post('/api/payment-receipts')
            .set('Authorization', a.auth)
            .attach('receipt', PDF, { filename: 'Comprovante Pix.pdf', contentType: 'application/pdf' })

        expect(res.status).toBe(201)
        const stored = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: res.body.receipt.id } })
        expect(stored.storedFilename).toMatch(/^private\/receipts\//)

        const filePath = `/api/internal/licensing/receipts/${stored.id}/file`
        expect((await request(app).get(filePath)).status).toBe(401)

        const opsToken = signOpsAccessToken({ role: 'OPS_ADMIN', email: 'ops@test.local' })
        const opened = await request(app).get(filePath).set('Authorization', `Bearer ${opsToken}`)
        expect(opened.status).toBe(200)
        expect(opened.headers['content-type']).toContain('application/pdf')
        expect(opened.headers['cache-control']).toBe('private, no-store')
    })
})
