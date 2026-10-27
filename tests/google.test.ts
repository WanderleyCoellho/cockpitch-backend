import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// O token do Google é validado pela biblioteca oficial; aqui simulamos o resultado da validação.
vi.mock('../src/lib/googleIdToken.js', () => import('./googleMock.js'))

const { app } = await import('../src/app.js')
const { prisma } = await import('../src/lib/prisma.js')
const { createUser, resetDatabase } = await import('./helpers.js')
const { authRateLimit } = await import('../src/middlewares/rateLimit.js')

beforeEach(async () => {
    await resetDatabase()
    // O fluxo com link faz mais chamadas a /auth do que o limite por IP; cada teste começa do zero.
    for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) await authRateLimit.resetKey(ip)
})

// Credenciais têm tamanho mínimo; o sufixo "x" é removido pelo mock.
import { cred, confirmationToken } from './googleMock.js'
const google = (body: Record<string, unknown>) => request(app).post('/api/auth/google').send(body)
const confirm = (token: string, password: string) => request(app).post(`/api/auth/google/confirm/${token}`).send({ password })
const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password })

describe('entrar com Google', () => {
    it('expõe a configuração pública (Client ID)', async () => {
        const res = await request(app).get('/api/auth/google/config')
        expect(res.body).toEqual({ enabled: true, clientId: 'test-client-id.apps.googleusercontent.com' })
    })

    it('Gmail sem conta: pede a empresa, manda o link e só cria a conta depois de criar a senha', async () => {
        const first = await google({ credential: cred('token-ana') })
        expect(first.status).toBe(404)
        expect(first.body).toMatchObject({ code: 'GOOGLE_ACCOUNT_NOT_FOUND', google: { email: 'ana@gmail.com', name: 'Ana Souza' } })

        const sent = await google({ credential: cred('token-ana'), workspaceName: 'Estúdio Ana', segment: 'PHOTO_VIDEO' })
        expect(sent.status).toBe(202)
        expect(sent.body).toMatchObject({ code: 'GOOGLE_CONFIRMATION_SENT', confirmationSentTo: 'ana@gmail.com' })
        expect(sent.body.token).toBeUndefined()
        expect(await prisma.user.count()).toBe(0)

        const token = await confirmationToken('ana@gmail.com')
        const preview = await request(app).get(`/api/auth/google/confirm/${token}`)
        expect(preview.body.confirmation).toMatchObject({ email: 'ana@gmail.com', name: 'Ana Souza', newAccount: true })

        expect((await confirm(token, 'curta')).status).toBe(400)
        const done = await confirm(token, 'senha-da-ana-123')
        expect(done.status).toBe(200)
        expect(done.body.token).toBeTruthy()
        expect(done.body.user.workspaces[0]).toMatchObject({ name: 'Estúdio Ana', segment: 'PHOTO_VIDEO', role: 'OWNER' })
        const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@gmail.com' } })
        expect(user).toMatchObject({ googleSub: 'google-sub-ana', name: 'Ana Souza' })
        expect((await login('ana@gmail.com', 'senha-da-ana-123')).status).toBe(200)

        // o link vale uma vez só
        expect((await confirm(token, 'senha-da-ana-123')).status).toBe(404)

        // entrar de novo com Google: direto, sem e-mail e sem criar outra conta
        const again = await google({ credential: cred('token-ana') })
        expect(again.status).toBe(200)
        expect(again.body.user.id).toBe(user.id)
        expect(await prisma.user.count()).toBe(1)
    })

    it('conta com senha no mesmo e-mail: só vincula pelo link; a senha antiga e as sessões antigas caem', async () => {
        // Cenário do ataque: alguém cadastrou o e-mail da Bia com uma senha que só ele conhece.
        const intruder = await createUser('Bia')
        await prisma.user.update({ where: { id: intruder.user.id }, data: { email: 'bia@gmail.com' } })

        const sent = await google({ credential: cred('token-bia') })
        expect(sent.status).toBe(202)
        expect(sent.body.token).toBeUndefined()
        expect((await prisma.user.findUniqueOrThrow({ where: { id: intruder.user.id } })).googleSub).toBeNull()
        const outbox = await prisma.emailOutbox.findFirstOrThrow({ where: { to: 'bia@gmail.com', template: 'google_confirm' } })
        expect(outbox.payload).toMatchObject({ linking: true })

        // reenviar na hora é bloqueado (sem enxurrada de e-mails)
        expect((await google({ credential: cred('token-bia') })).body.code).toBe('CONFIRMATION_COOLDOWN')

        const token = await confirmationToken('bia@gmail.com')
        expect((await request(app).get(`/api/auth/google/confirm/${token}`)).body.confirmation.newAccount).toBe(false)
        // garante que o token antigo foi emitido num segundo anterior à troca
        await new Promise((resolve) => setTimeout(resolve, 1100))
        const done = await confirm(token, 'nova-senha-da-bia')
        expect(done.status).toBe(200)
        expect(done.body.user.id).toBe(intruder.user.id)
        expect((await prisma.user.findUniqueOrThrow({ where: { id: intruder.user.id } })).googleSub).toBe('google-sub-bia')

        expect((await login('bia@gmail.com', 'password123')).status).toBe(401)
        expect((await login('bia@gmail.com', 'nova-senha-da-bia')).status).toBe(200)
        expect((await request(app).get('/api/auth/me').set('Authorization', intruder.auth)).status).toBe(401)
        expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${done.body.token}`)).status).toBe(200)
    })

    it('outra conta Google no mesmo e-mail é recusada', async () => {
        await google({ credential: cred('token-ana'), workspaceName: 'Estúdio Ana' })
        await confirm(await confirmationToken('ana@gmail.com'), 'senha-da-ana-123')
        const conflict = await google({ credential: cred('token-ana-other-sub') })
        expect(conflict.status).toBe(409)
        expect(conflict.body.code).toBe('GOOGLE_ACCOUNT_CONFLICT')
    })

    it('link inválido ou expirado é recusado', async () => {
        expect((await request(app).get('/api/auth/google/confirm/nao-existe')).body.code).toBe('CONFIRMATION_INVALID')
        await google({ credential: cred('token-ana'), workspaceName: 'Estúdio Ana' })
        const token = await confirmationToken('ana@gmail.com')
        await prisma.googleSignupConfirmation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
        const expired = await confirm(token, 'senha-da-ana-123')
        expect(expired.status).toBe(404)
        expect(expired.body.code).toBe('CONFIRMATION_INVALID')
        expect(await prisma.user.count()).toBe(0)
    })

    it('token do painel Ops não vale como sessão de usuário', async () => {
        const ops = await request(app).post('/api/ops-auth/login').send({ email: 'ops@test.local', password: 'ops-password-test' })
        expect(ops.status).toBe(200)
        expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ops.body.token}`)).status).toBe(401)
    })

    it('e-mail não verificado e token inválido são recusados', async () => {
        expect((await google({ credential: cred('token-unverified'), workspaceName: 'X Ltda' })).body.code).toBe('GOOGLE_EMAIL_UNVERIFIED')
        const bad = await google({ credential: cred('token-falso') })
        expect(bad.status).toBe(401)
        expect(bad.body.code).toBe('GOOGLE_TOKEN_INVALID')
        expect(await prisma.user.count()).toBe(0)
    })
})
