import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// O token do Google é validado pela biblioteca oficial; aqui simulamos o resultado da validação.
vi.mock('../src/lib/googleIdToken.js', () => import('./googleMock.js'))

const { app } = await import('../src/app.js')
const { prisma } = await import('../src/lib/prisma.js')
const { createUser, resetDatabase } = await import('./helpers.js')

beforeEach(resetDatabase)

// Credenciais têm tamanho mínimo; o sufixo "x" é removido pelo mock.
import { cred } from './googleMock.js'
const google = (body: Record<string, unknown>) => request(app).post('/api/auth/google').send(body)

describe('entrar com Google', () => {
    it('expõe a configuração pública (Client ID)', async () => {
        const res = await request(app).get('/api/auth/google/config')
        expect(res.body).toEqual({ enabled: true, clientId: 'test-client-id.apps.googleusercontent.com' })
    })

    it('Gmail sem conta → 404 com os dados do Google; com nome da empresa → cria conta e empresa', async () => {
        const first = await google({ credential: cred('token-ana') })
        expect(first.status).toBe(404)
        expect(first.body).toMatchObject({ code: 'GOOGLE_ACCOUNT_NOT_FOUND', google: { email: 'ana@gmail.com', name: 'Ana Souza' } })
        expect(await prisma.user.count()).toBe(0)

        const created = await google({ credential: cred('token-ana'), workspaceName: 'Estúdio Ana', segment: 'PHOTO_VIDEO' })
        expect(created.status).toBe(201)
        expect(created.body.created).toBe(true)
        expect(created.body.token).toBeTruthy()
        expect(created.body.user.workspaces[0]).toMatchObject({ name: 'Estúdio Ana', segment: 'PHOTO_VIDEO', role: 'OWNER' })
        const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@gmail.com' } })
        expect(user).toMatchObject({ googleSub: 'google-sub-ana', passwordHash: null, name: 'Ana Souza' })

        // entrar de novo: mesma conta, sem criar outra
        const again = await google({ credential: cred('token-ana') })
        expect(again.status).toBe(200)
        expect(again.body.user.id).toBe(user.id)
        expect(await prisma.user.count()).toBe(1)
    })

    it('conta com senha e mesmo e-mail é vinculada; senha continua funcionando', async () => {
        const a = await createUser('Bia')
        await prisma.user.update({ where: { id: a.user.id }, data: { email: 'bia@gmail.com' } })
        const res = await google({ credential: cred('token-bia') })
        expect(res.status).toBe(200)
        expect(res.body.user.id).toBe(a.user.id)
        expect((await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).googleSub).toBe('google-sub-bia')
        expect((await request(app).post('/api/auth/login').send({ email: 'bia@gmail.com', password: 'password123' })).status).toBe(200)
    })

    it('conta só Google não entra com senha; outra conta Google no mesmo e-mail é recusada', async () => {
        await google({ credential: cred('token-ana'), workspaceName: 'Estúdio Ana' })
        expect((await request(app).post('/api/auth/login').send({ email: 'ana@gmail.com', password: 'qualquer-coisa' })).status).toBe(401)
        const conflict = await google({ credential: cred('token-ana-other-sub') })
        expect(conflict.status).toBe(409)
        expect(conflict.body.code).toBe('GOOGLE_ACCOUNT_CONFLICT')
    })

    it('e-mail não verificado e token inválido são recusados', async () => {
        expect((await google({ credential: cred('token-unverified'), workspaceName: 'X Ltda' })).body.code).toBe('GOOGLE_EMAIL_UNVERIFIED')
        const bad = await google({ credential: cred('token-falso') })
        expect(bad.status).toBe(401)
        expect(bad.body.code).toBe('GOOGLE_TOKEN_INVALID')
        expect(await prisma.user.count()).toBe(0)
    })
})
