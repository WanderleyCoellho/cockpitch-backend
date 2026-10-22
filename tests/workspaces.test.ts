import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { resolveEntitlements } from '../src/services/entitlements.js'
import { addMember, createPackage, createUser, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)

describe('cadastro', () => {
    it('cria workspace com dono, segmento e perfil público', async () => {
        const res = await request(app).post('/api/auth/register').send({
            name: 'Ana Souza',
            email: 'ana@empresa.com',
            password: 'senha-forte-1',
            workspaceName: 'Clínica Bem Estar',
            segment: 'HEALTH_BEAUTY'
        })

        expect(res.status).toBe(201)
        expect(res.body.user.workspaces).toHaveLength(1)
        const ws = res.body.user.workspaces[0]
        expect(ws).toMatchObject({ name: 'Clínica Bem Estar', segment: 'HEALTH_BEAUTY', role: 'OWNER', planTier: 'FREE' })
        expect(ws.slug).toMatch(/^clinica-bem-estar-[a-f0-9]{6}$/)
        expect(res.body.user.providerId).toBe(ws.providerId)
        expect(res.body.user.activeWorkspaceId).toBe(ws.id)
        expect(ws.entitlements.proposalsPerMonth).toBe(3)
    })
})

describe('isolamento entre workspaces', () => {
    it('não lista, lê nem altera recursos de outro workspace', async () => {
        const a = await createUser('Ana')
        const b = await createUser('Bia')
        const pkg = await createPackage(a.provider.id)

        expect((await request(app).get(`/api/providers/${a.provider.id}`).set('Authorization', b.auth)).status).toBe(404)
        expect((await request(app).get(`/api/packages/${pkg.id}`).set('Authorization', b.auth)).status).toBe(404)
        expect((await request(app).get(`/api/packages/provider/${a.provider.id}`).set('Authorization', b.auth)).status).toBe(403)

        const providers = await request(app).get('/api/providers/me').set('Authorization', b.auth)
        expect(providers.body.providers.map((p: { id: string }) => p.id)).toEqual([b.provider.id])
    })

    it('header X-Workspace-Id de outro workspace responde 404', async () => {
        const a = await createUser('Ana')
        const b = await createUser('Bia')
        const res = await request(app).get('/api/workspaces/current').set('Authorization', b.auth).set('X-Workspace-Id', a.workspace.id)
        expect(res.status).toBe(404)
    })

    it('membro enxerga e usa os dados do workspace em que entrou', async () => {
        const a = await createUser('Ana')
        const pkg = await createPackage(a.provider.id)
        const m = await addMember(a.workspace.id, 'MEMBER')

        const pkgs = await request(app).get(`/api/packages/provider/${a.provider.id}`).set('Authorization', m.auth)
        expect(pkgs.status).toBe(200)
        expect(pkgs.body.packages[0].id).toBe(pkg.id)

        const created = await request(app)
            .post('/api/proposals')
            .set('Authorization', m.auth)
            .send({ providerId: a.provider.id, packageIds: [pkg.id], clientName: 'Cliente', slug: 'proposta-do-membro' })
        expect(created.status).toBe(201)
    })
})

describe('papéis', () => {
    it('MEMBER não altera pacotes, perfil nem workspace', async () => {
        const a = await createUser('Ana')
        const pkg = await createPackage(a.provider.id)
        const m = await addMember(a.workspace.id, 'MEMBER')

        expect((await request(app).patch(`/api/packages/${pkg.id}`).set('Authorization', m.auth).send({ name: 'Novo nome' })).status).toBe(403)
        expect((await request(app).patch(`/api/providers/${a.provider.id}`).set('Authorization', m.auth).send({ city: 'X' })).status).toBe(403)
        expect((await request(app).patch('/api/workspaces/current').set('Authorization', m.auth).send({ name: 'Hack' })).status).toBe(403)
        expect((await request(app).post('/api/workspaces/current/invites').set('Authorization', m.auth).send({ email: 'x@y.com' })).status).toBe(403)
    })

    it('ADMIN edita o workspace, mas só o dono assina plano', async () => {
        const a = await createUser('Ana')
        const admin = await addMember(a.workspace.id, 'ADMIN')

        const patched = await request(app)
            .patch('/api/workspaces/current')
            .set('Authorization', admin.auth)
            .send({ name: 'Ana & Cia', brandColor: '#C9A84C', segment: 'EVENTS' })
        expect(patched.status).toBe(200)
        expect(patched.body.workspace).toMatchObject({ name: 'Ana & Cia', brandColor: '#C9A84C', segment: 'EVENTS' })

        const checkout = await request(app).post('/api/stripe/create-checkout').set('Authorization', admin.auth).send({ planTier: 'PRO' })
        expect(checkout.status).toBe(403)
    })

    it('dono não pode ser removido; admin não remove admin; qualquer um pode sair', async () => {
        const a = await createUser('Ana')
        const owner = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: a.user.id } })
        const admin1 = await addMember(a.workspace.id, 'ADMIN')
        const admin2 = await addMember(a.workspace.id, 'ADMIN')
        const member = await addMember(a.workspace.id, 'MEMBER')

        expect((await request(app).delete(`/api/workspaces/current/members/${owner.id}`).set('Authorization', admin1.auth)).status).toBe(400)
        expect((await request(app).delete(`/api/workspaces/current/members/${admin2.member.id}`).set('Authorization', admin1.auth)).status).toBe(403)
        expect((await request(app).delete(`/api/workspaces/current/members/${member.member.id}`).set('Authorization', admin1.auth)).status).toBe(204)
        expect((await request(app).delete(`/api/workspaces/current/members/${admin2.member.id}`).set('Authorization', admin2.auth)).status).toBe(204)
    })
})

describe('convites', () => {
    it('fluxo completo: convidar, ver, cadastrar pelo convite e entrar na equipe', async () => {
        const a = await createUser('Ana')
        const invite = await request(app)
            .post('/api/workspaces/current/invites')
            .set('Authorization', a.auth)
            .send({ email: 'Novo@Empresa.com', role: 'MEMBER' })
        expect(invite.status).toBe(201)
        const token = invite.body.inviteUrl.split('/convite/')[1]
        expect(token.length).toBeGreaterThan(30)

        const preview = await request(app).get(`/api/invites/${token}`)
        expect(preview.status).toBe(200)
        expect(preview.body.invite).toMatchObject({ email: 'novo@empresa.com', workspace: { name: 'Ana Ltda' } })

        const wrongEmail = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Outro', email: 'outro@empresa.com', password: 'senha-forte-1', inviteToken: token })
        expect(wrongEmail.status).toBe(403)

        const reg = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Novo', email: 'novo@empresa.com', password: 'senha-forte-1', inviteToken: token })
        expect(reg.status).toBe(201)
        expect(reg.body.user.workspaces).toHaveLength(1)
        expect(reg.body.user.workspaces[0]).toMatchObject({ id: a.workspace.id, role: 'MEMBER' })

        // Convite de uso único.
        expect((await request(app).get(`/api/invites/${token}`)).status).toBe(404)
    })

    it('usuário existente aceita convite e passa a ter dois workspaces', async () => {
        const a = await createUser('Ana')
        const b = await createUser('Bia')
        const invite = await request(app).post('/api/workspaces/current/invites').set('Authorization', a.auth).send({ email: b.email, role: 'ADMIN' })
        const token = invite.body.inviteUrl.split('/convite/')[1]

        const accepted = await request(app).post(`/api/invites/${token}/accept`).set('Authorization', b.auth)
        expect(accepted.status).toBe(200)

        const list = await request(app).get('/api/workspaces').set('Authorization', b.auth)
        expect(list.body.workspaces.map((w: { role: string }) => w.role).sort()).toEqual(['ADMIN', 'OWNER'])

        const asAdmin = await request(app).get('/api/workspaces/current').set('Authorization', b.auth).set('X-Workspace-Id', a.workspace.id)
        expect(asAdmin.status).toBe(200)
        expect(asAdmin.body.workspace.role).toBe('ADMIN')
    })

    it('respeita o limite de pessoas do plano (convites pendentes contam)', async () => {
        const a = await createUser('Ana', { planTier: 'STARTER', billingStatus: 'ACTIVE' })
        const res = await request(app).post('/api/workspaces/current/invites').set('Authorization', a.auth).send({ email: 'x@y.com' })
        expect(res.status).toBe(402)
        expect(res.body.code).toBe('PLAN_LIMIT')

        const pro = await createUser('Pro', { planTier: 'PRO', billingStatus: 'ACTIVE' }) // 3 pessoas
        expect((await request(app).post('/api/workspaces/current/invites').set('Authorization', pro.auth).send({ email: 'a@y.com' })).status).toBe(201)
        expect((await request(app).post('/api/workspaces/current/invites').set('Authorization', pro.auth).send({ email: 'b@y.com' })).status).toBe(201)
        expect((await request(app).post('/api/workspaces/current/invites').set('Authorization', pro.auth).send({ email: 'c@y.com' })).status).toBe(402)
        // Reenviar para o mesmo e-mail substitui o convite pendente.
        expect((await request(app).post('/api/workspaces/current/invites').set('Authorization', pro.auth).send({ email: 'a@y.com' })).status).toBe(201)
    })
})

describe('limites do plano', () => {
    it('Grátis: 3 propostas por mês, depois 402 PLAN_LIMIT', async () => {
        const a = await createUser('Ana', { planTier: 'FREE', billingStatus: 'INACTIVE' })
        for (let i = 0; i < 3; i += 1) {
            const ok = await request(app).post('/api/proposals').set('Authorization', a.auth).send({ providerId: a.provider.id, clientName: 'Cliente', slug: `p-${i}` })
            expect(ok.status).toBe(201)
        }
        const blocked = await request(app).post('/api/proposals').set('Authorization', a.auth).send({ providerId: a.provider.id, clientName: 'Cliente', slug: 'p-4' })
        expect(blocked.status).toBe(402)
        expect(blocked.body.code).toBe('PLAN_LIMIT')
    })

    it('resolve o plano efetivo (cobrança inativa → Grátis; cortesia → Profissional)', () => {
        expect(resolveEntitlements({ planTier: 'PRO', billingStatus: 'CANCELED', licensePolicy: 'STANDARD' }).effectiveTier).toBe('FREE')
        expect(resolveEntitlements({ planTier: 'PRO', billingStatus: 'PAST_DUE', licensePolicy: 'STANDARD' }).effectiveTier).toBe('PRO')
        expect(resolveEntitlements({ planTier: 'FREE', billingStatus: 'INACTIVE', licensePolicy: 'COURTESY' }).effectiveTier).toBe('PRO')
        expect(resolveEntitlements({ planTier: 'AGENCY', billingStatus: 'ACTIVE', licensePolicy: 'STANDARD' }).members).toBe(10)
    })
})

describe('Ops', () => {
    it('alterar a licença de uma pessoa altera o workspace dela', async () => {
        const { signOpsAccessToken } = await import('../src/lib/opsJwt.js')
        const a = await createUser('Ana', { planTier: 'FREE', billingStatus: 'INACTIVE' })
        const ops = `Bearer ${signOpsAccessToken({ role: 'OPS_ADMIN', email: 'ops@test.local' })}`

        const res = await request(app)
            .patch(`/api/internal/licensing/users/${a.user.id}`)
            .set('Authorization', ops)
            .send({ planTier: 'PRO', billingStatus: 'ACTIVE' })
        expect(res.status).toBe(200)

        const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })
        expect(ws).toMatchObject({ planTier: 'PRO', billingStatus: 'ACTIVE' })

        const me = await request(app).get('/api/auth/me').set('Authorization', a.auth)
        expect(me.body.user.planTier).toBe('PRO')
    })
})

describe('Stripe → workspace', () => {
    it('webhook/reconciliação atualizam o workspace do cliente e espelham no dono; cortesia é preservada', async () => {
        const { applyStripeBilling } = await import('../src/services/license.service.js')
        const a = await createUser('Ana', { planTier: 'FREE', billingStatus: 'INACTIVE' })
        const c = await createUser('Cortesia', { planTier: 'PRO', billingStatus: 'INACTIVE', licensePolicy: 'COURTESY' })
        await prisma.workspace.update({ where: { id: a.workspace.id }, data: { stripeCustomerId: 'cus_ana' } })
        await prisma.workspace.update({ where: { id: c.workspace.id }, data: { stripeCustomerId: 'cus_cortesia' } })

        expect(await applyStripeBilling('cus_ana', { planTier: 'STARTER', billingStatus: 'ACTIVE', stripeSubscriptionId: 'sub_1' })).toBe(1)
        expect(await applyStripeBilling('cus_cortesia', { planTier: 'FREE', billingStatus: 'CANCELED' })).toBe(0)

        expect(await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })).toMatchObject({ planTier: 'STARTER', billingStatus: 'ACTIVE', stripeSubscriptionId: 'sub_1' })
        expect(await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).toMatchObject({ planTier: 'STARTER', billingStatus: 'ACTIVE' })
        expect(await prisma.workspace.findUniqueOrThrow({ where: { id: c.workspace.id } })).toMatchObject({ planTier: 'PRO', licensePolicy: 'COURTESY' })
    })
})

describe('Ops: membros de equipe', () => {
    it('lista as empresas da pessoa com papel e plano efetivo; membro sem empresa própria não tem licença editável', async () => {
        const { signOpsAccessToken } = await import('../src/lib/opsJwt.js')
        const ops = `Bearer ${signOpsAccessToken({ role: 'OPS_ADMIN', email: 'ops@test.local' })}`
        const owner = await createUser('Dona', { planTier: 'AGENCY', billingStatus: 'ACTIVE', licensePolicy: 'COURTESY' })
        const member = await addMember(owner.workspace.id, 'MEMBER', 'Membro Convidado')

        const list = await request(app).get('/api/internal/licensing/users?limit=50').set('Authorization', ops)
        expect(list.status).toBe(200)
        const row = list.body.users.find((u: { id: string }) => u.id === member.user.id)
        expect(row.ownsWorkspace).toBe(false)
        expect(row.loginMethods).toEqual(['PASSWORD'])
        expect(row.passwordHash).toBeUndefined()
        expect(row.googleSub).toBeUndefined()
        expect(row.workspaces).toEqual([
            expect.objectContaining({ name: 'Dona Ltda', role: 'MEMBER', licensePolicy: 'COURTESY', effectiveTier: 'AGENCY', members: 10 })
        ])

        const patch = await request(app).patch(`/api/internal/licensing/users/${member.user.id}`).set('Authorization', ops).send({ planTier: 'PRO' })
        expect(patch.status).toBe(409)
        expect(patch.body.code).toBe('NO_OWNED_WORKSPACE')
    })
})
