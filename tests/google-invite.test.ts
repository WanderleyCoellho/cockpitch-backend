import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/googleIdToken.js', () => import('./googleMock.js'))

const { app } = await import('../src/app.js')
const { createUser, resetDatabase } = await import('./helpers.js')
const { cred } = await import('./googleMock.js')

beforeEach(resetDatabase)

const google = (body: Record<string, unknown>) => request(app).post('/api/auth/google').send(body)

describe('entrar com Google por convite', () => {
    it('convite: entra na equipe com Google (conta nova ou existente); e-mail diferente é recusado', async () => {
        const owner = await createUser('Dona')
        const inviteRes = await request(app).post('/api/workspaces/current/invites').set('Authorization', owner.auth).send({ email: 'ana@gmail.com', role: 'MEMBER' })
        const token = inviteRes.body.inviteUrl.split('/convite/')[1]

        const wrong = await google({ credential: cred('token-bia'), inviteToken: token })
        expect(wrong.status).toBe(403)
        expect(wrong.body.code).toBe('INVITE_EMAIL_MISMATCH')

        const joined = await google({ credential: cred('token-ana'), inviteToken: token })
        expect(joined.status).toBe(201)
        expect(joined.body.user.workspaces).toHaveLength(1)
        expect(joined.body.user.workspaces[0]).toMatchObject({ id: owner.workspace.id, role: 'MEMBER' })

        // segundo convite para quem já tem conta Google
        const owner2 = await createUser('Outra Dona')
        const invite2 = await request(app).post('/api/workspaces/current/invites').set('Authorization', owner2.auth).send({ email: 'ana@gmail.com', role: 'ADMIN' })
        const joined2 = await google({ credential: cred('token-ana'), inviteToken: invite2.body.inviteUrl.split('/convite/')[1] })
        expect(joined2.status).toBe(200)
        expect(joined2.body.user.workspaces.map((w: { role: string }) => w.role).sort()).toEqual(['ADMIN', 'MEMBER'])
    })
})
