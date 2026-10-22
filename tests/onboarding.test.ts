import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { addMember, createPackage, createUser, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)

const status = (auth: string) => request(app).get('/api/workspaces/current/onboarding').set('Authorization', auth)
const patch = (auth: string, body: Record<string, unknown>) => request(app).patch('/api/auth/me/onboarding').set('Authorization', auth).send(body)
const done = (body: { steps: Array<{ key: string; done: boolean }> }) => body.steps.filter((s) => s.done).map((s) => s.key)

describe('primeiros passos', () => {
    it('reflete o estado real da empresa', async () => {
        const a = await createUser()
        let res = await status(a.auth)
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({ completed: 0, total: 5, dismissed: false, toursSeen: [], toursDisabled: false })

        await prisma.provider.update({ where: { id: a.provider.id }, data: { whatsapp: '5581999990000', shortDescription: 'Estúdio de fotografia' } })
        const pkg = await createPackage(a.provider.id)
        const proposal = await prisma.proposal.create({ data: { providerId: a.provider.id, clientName: 'Cliente', slug: 'passos-1', packageIds: { connect: [{ id: pkg.id }] } } })
        res = await status(a.auth)
        expect(done(res.body)).toEqual(['profile', 'package', 'proposal'])

        // abrir o link (sem ser da equipe) conta como compartilhado e visualizado
        await request(app).post('/api/proposal-views').send({ proposalId: proposal.id, sessionId: 'cliente-1' })
        res = await status(a.auth)
        expect(done(res.body)).toEqual(['profile', 'package', 'proposal', 'shared', 'viewed'])
        expect(res.body.completed).toBe(5)
    })

    it('guarda link compartilhado, tours vistos e checklist oculto por pessoa', async () => {
        const a = await createUser()
        const m = await addMember(a.workspace.id, 'MEMBER')
        expect((await patch(a.auth, { linkShared: true, tourSeen: 'dashboard' })).status).toBe(200)
        await patch(a.auth, { tourSeen: 'proposals' })
        await patch(a.auth, { tourSeen: 'dashboard' }) // repetido não duplica
        await patch(a.auth, { dismissedChecklist: true, toursDisabled: true })

        const res = await status(a.auth)
        expect(done(res.body)).toContain('shared')
        expect(res.body).toMatchObject({ dismissed: true, toursDisabled: true, toursSeen: ['dashboard', 'proposals'] })

        // outra pessoa da equipe tem o próprio progresso
        expect((await status(m.auth)).body).toMatchObject({ dismissed: false, toursSeen: [] })

        expect((await patch(a.auth, { resetTours: true, toursDisabled: false })).body.onboarding.toursSeen).toEqual([])
    })

    it('valida o pedido', async () => {
        const a = await createUser()
        expect((await patch(a.auth, {})).status).toBe(400)
        expect((await patch(a.auth, { tourSeen: '<script>' })).status).toBe(400)
        expect((await request(app).patch('/api/auth/me/onboarding').send({ linkShared: true })).status).toBe(401)
    })
})
