import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { createUser, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)

describe('segurança', () => {
    it('comprovantes nunca são servidos pelo diretório público', async () => {
        const res = await request(app).get('/uploads/receipts/receipt-123-comprovante.pdf')
        expect(res.status).toBe(404)
    })

    it('arquivo de comprovante exige sessão do Ops', async () => {
        const res = await request(app).get('/api/internal/licensing/receipts/abc/file')
        expect(res.status).toBe(401)
    })

    it('remove scripts do texto "sobre" do provider (XSS armazenado)', async () => {
        const a = await createUser()
        const res = await request(app)
            .patch(`/api/providers/${a.provider.id}`)
            .set('Authorization', a.auth)
            .send({ aboutText: '<p>Olá <strong>mundo</strong></p><script>alert(1)</script><img src=x onerror=alert(1)>' })

        expect(res.status).toBe(200)
        expect(res.body.provider.aboutText).toBe('<p>Olá <strong>mundo</strong></p>')
    })

    it('erros 500 não vazam detalhes internos', async () => {
        const res = await request(app).get('/api/proposals/provider/x').set('Authorization', 'Bearer invalido')
        expect(res.status).toBe(401)
    })

    it('limita tentativas de login por IP (429 + Retry-After)', async () => {
        let last: request.Response | undefined
        for (let i = 0; i < 11; i += 1) {
            last = await request(app).post('/api/auth/login').send({ email: 'x@test.local', password: 'errada123' })
        }
        expect(last?.status).toBe(429)
        expect(last?.headers['retry-after']).toBeDefined()
    })

    it('origem não autorizada não recebe cabeçalhos CORS (e não gera 500)', async () => {
        const res = await request(app).get('/api/health').set('Origin', 'https://malicioso.example')
        expect(res.status).toBe(200)
        expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })
})
