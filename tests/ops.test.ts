import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { signOpsAccessToken } from '../src/lib/opsJwt.js'
import { ensureCatalogPrices, setStripe } from '../src/lib/stripe.js'
import { billingEventsFor } from '../src/services/workspace-events.service.js'
import { addMember, createUser, resetDatabase } from './helpers.js'
import { createStripeFake, signedEvent } from './stripeFake.js'

const ops = `Bearer ${signOpsAccessToken({ role: 'OPS_ADMIN', email: 'ops@test.local' })}`
let fake: ReturnType<typeof createStripeFake>

beforeEach(async () => {
    await resetDatabase()
    fake = createStripeFake()
    setStripe(fake.stripe)
})

afterAll(() => setStripe(null))

const get = (path: string) => request(app).get(`/api/internal/ops${path}`).set('Authorization', ops)

async function proposalFor(providerId: string, slug: string, opts: { viewed?: boolean; accepted?: boolean } = {}) {
    const proposal = await prisma.proposal.create({
        data: { providerId, clientName: 'Cliente', slug, commercialStatus: opts.accepted ? 'ACEITA' : 'SEM_RESPOSTA' }
    })
    if (opts.viewed) {
        await prisma.proposalView.create({ data: { proposalId: proposal.id, proposalSlug: slug, sessionId: `s-${slug}`, viewedAt: new Date() } })
    }
    return proposal
}

describe('acesso', () => {
    it('exige sessão do Ops (token de cliente não serve)', async () => {
        const a = await createUser('Ana')
        expect((await request(app).get('/api/internal/ops/overview')).status).toBe(401)
        expect((await request(app).get('/api/internal/ops/overview').set('Authorization', a.auth)).status).toBe(401)
    })
})

describe('visão geral', () => {
    it('receita, assinantes, cortesia, atrasados e funil a partir dos dados reais', async () => {
        const pro = await createUser('Pro', { planTier: 'PRO', billingStatus: 'ACTIVE' })
        await createUser('Starter', { planTier: 'STARTER', billingStatus: 'PAST_DUE' })
        await createUser('Cortesia', { planTier: 'PRO', billingStatus: 'ACTIVE', licensePolicy: 'COURTESY' })
        const free = await createUser('Livre', { planTier: 'FREE', billingStatus: 'INACTIVE' })
        await proposalFor(pro.provider.id, 'p1', { viewed: true, accepted: true })
        await proposalFor(free.provider.id, 'f1', { viewed: true })
        await prisma.emailOutbox.create({ data: { to: 'x@y.z', template: 'proposal_opened', payload: {}, status: 'FAILED', attempts: 5, dedupeKey: 'k1' } })

        const res = await get('/overview?days=30')
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({
            mrrCents: 9900 + 4900,
            subscribers: 2,
            courtesy: 1,
            free: 1,
            totalWorkspaces: 4,
            pastDue: { count: 1 },
            funnel: { created: 4, firstProposal: 2, opened: 2, accepted: 1, paying: 2 },
            attention: { failedEmails: { count: 1 } }
        })
        expect(res.body.byTier.PRO).toEqual({ count: 1, priceCents: 9900, mrrCents: 9900 })
        expect(res.body.recentWorkspaces).toHaveLength(4)
        expect((await get('/overview?days=12')).status).toBe(400)
    })
})

describe('empresas', () => {
    it('lista com filtros, contagens e busca pelo e-mail do dono', async () => {
        const pro = await createUser('Clínica Bem Estar', { planTier: 'PRO', billingStatus: 'ACTIVE' })
        await createUser('Atrasada', { planTier: 'STARTER', billingStatus: 'PAST_DUE' })
        await createUser('Cortesia', { planTier: 'PRO', billingStatus: 'ACTIVE', licensePolicy: 'COURTESY' })
        await createUser('Livre', { planTier: 'FREE', billingStatus: 'INACTIVE' })
        await proposalFor(pro.provider.id, 'cbe-1')

        const all = await get('/workspaces')
        expect(all.body.counts).toEqual({ all: 4, paying: 2, free: 1, courtesy: 1, past_due: 1 })
        expect(all.body.items).toHaveLength(4)

        const paying = await get('/workspaces?filter=paying')
        expect(paying.body.items.map((w: { name: string }) => w.name).sort()).toEqual(['Atrasada Ltda', 'Clínica Bem Estar Ltda'])

        const byEmail = await get(`/workspaces?q=${encodeURIComponent(pro.email)}`)
        expect(byEmail.body.items).toHaveLength(1)
        expect(byEmail.body.items[0]).toMatchObject({
            owner: { email: pro.email },
            effectiveTier: 'PRO',
            members: 1,
            memberLimit: 3,
            proposalsThisMonth: 1,
            proposalLimit: -1
        })
        expect((await get('/workspaces?filter=nope')).status).toBe(400)
    })

    it('ficha: pessoas com forma de entrar, uso e link do Stripe', async () => {
        const a = await createUser('Ana', { planTier: 'PRO', billingStatus: 'ACTIVE' })
        await addMember(a.workspace.id, 'ADMIN', 'Bruno')
        await prisma.user.update({ where: { id: a.user.id }, data: { googleSub: 'g-ana' } })
        await prisma.workspace.update({ where: { id: a.workspace.id }, data: { stripeCustomerId: 'cus_ana' } })
        await proposalFor(a.provider.id, 'ana-1', { viewed: true, accepted: true })

        const res = await get(`/workspaces/${a.workspace.id}`)
        expect(res.status).toBe(200)
        expect(res.body.members.map((m: { role: string; user: { loginMethods: string[] } }) => [m.role, m.user.loginMethods])).toEqual([
            ['OWNER', ['PASSWORD', 'GOOGLE']],
            ['ADMIN', ['PASSWORD']]
        ])
        expect(res.body.usage).toMatchObject({ proposalsThisMonth: 1, proposalsTotal: 1, accepted: 1, opens: 1, members: 2 })
        expect(res.body.stripe).toEqual({
            mode: 'test',
            customerId: 'cus_ana',
            subscriptionId: null,
            dashboardUrl: 'https://dashboard.stripe.com/test/customers/cus_ana'
        })
        expect(JSON.stringify(res.body)).not.toContain('passwordHash')
        expect((await get('/workspaces/nao-existe')).status).toBe(404)
    })

    it('conceder e retirar cortesia: histórico e espelho no dono', async () => {
        const a = await createUser('Ana', { planTier: 'FREE', billingStatus: 'INACTIVE' })
        const patch = (body: object) =>
            request(app).patch(`/api/internal/ops/workspaces/${a.workspace.id}/license`).set('Authorization', ops).send(body)

        const granted = await patch({ licensePolicy: 'COURTESY', planTier: 'AGENCY', note: 'Parceiro de lançamento' })
        expect(granted.status).toBe(200)
        expect(granted.body).toMatchObject({ licensePolicy: 'COURTESY', planTier: 'AGENCY', entitlements: { effectiveTier: 'AGENCY', isCourtesy: true } })
        expect(granted.body.events[0]).toMatchObject({ type: 'COURTESY_GRANTED', detail: { note: 'Parceiro de lançamento', planTier: 'AGENCY' } })
        expect(await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).toMatchObject({ licensePolicy: 'COURTESY', planTier: 'AGENCY' })

        const revoked = await patch({ licensePolicy: 'STANDARD' })
        expect(revoked.body).toMatchObject({ licensePolicy: 'STANDARD', planTier: 'FREE', entitlements: { effectiveTier: 'FREE' } })
        expect(revoked.body.events.map((e: { type: string }) => e.type)).toEqual(['COURTESY_REVOKED', 'COURTESY_GRANTED'])
        expect((await patch({ licensePolicy: 'COURTESY', planTier: 'FREE' })).status).toBe(400)
    })

    it('retirar cortesia de quem assina no Stripe devolve o plano pago', async () => {
        const a = await createUser('Ana', { planTier: 'PRO', billingStatus: 'ACTIVE', licensePolicy: 'COURTESY' })
        await prisma.workspace.update({ where: { id: a.workspace.id }, data: { stripeCustomerId: 'cus_ana' } })
        const prices = await ensureCatalogPrices()
        fake.addSubscription('cus_ana', prices.STARTER.priceId)

        const res = await request(app)
            .patch(`/api/internal/ops/workspaces/${a.workspace.id}/license`)
            .set('Authorization', ops)
            .send({ licensePolicy: 'STANDARD' })
        expect(res.body).toMatchObject({ licensePolicy: 'STANDARD', planTier: 'STARTER', billingStatus: 'ACTIVE' })
    })

    it('sincronizar com o Stripe registra assinatura e cancelamento agendado', async () => {
        const a = await createUser('Ana', { planTier: 'FREE', billingStatus: 'INACTIVE' })
        const sync = () => request(app).post(`/api/internal/ops/workspaces/${a.workspace.id}/sync`).set('Authorization', ops)
        expect((await sync()).status).toBe(409)

        await prisma.workspace.update({ where: { id: a.workspace.id }, data: { stripeCustomerId: 'cus_ana' } })
        const prices = await ensureCatalogPrices()
        const sub = fake.addSubscription('cus_ana', prices.PRO.priceId)
        const first = await sync()
        expect(first.body.changed).toBe(true)
        expect(first.body.detail.events[0]).toMatchObject({ type: 'SUBSCRIBED', detail: { planTier: 'PRO' } })

        const cancelAt = Math.floor(Date.UTC(2026, 10, 12) / 1000)
        Object.assign(sub, { cancel_at: cancelAt, cancel_at_period_end: true })
        const second = await sync()
        expect(second.body.detail.subscriptionCancelAt).toBe(new Date(cancelAt * 1000).toISOString())
        expect(second.body.detail.events[0].type).toBe('CANCEL_SCHEDULED')
        expect((await sync()).body.changed).toBe(false)
    })
})

describe('histórico de cobrança', () => {
    const snap = (planTier: 'FREE' | 'STARTER' | 'PRO', billingStatus: 'INACTIVE' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED', subscriptionCancelAt: Date | null = null) => ({
        planTier,
        billingStatus,
        subscriptionCancelAt
    })

    it('traduz cada mudança no evento certo', () => {
        expect(billingEventsFor(snap('FREE', 'INACTIVE'), snap('PRO', 'ACTIVE')).map((e) => e.type)).toEqual(['SUBSCRIBED'])
        expect(billingEventsFor(snap('STARTER', 'ACTIVE'), snap('PRO', 'ACTIVE'))[0]).toEqual({ type: 'PLAN_CHANGED', detail: { from: 'STARTER', to: 'PRO' } })
        expect(billingEventsFor(snap('PRO', 'ACTIVE'), snap('PRO', 'PAST_DUE')).map((e) => e.type)).toEqual(['PAYMENT_FAILED'])
        expect(billingEventsFor(snap('PRO', 'PAST_DUE'), snap('PRO', 'ACTIVE')).map((e) => e.type)).toEqual(['PAYMENT_RECOVERED'])
        expect(billingEventsFor(snap('PRO', 'ACTIVE'), snap('FREE', 'CANCELED'))[0]).toEqual({ type: 'CANCELED', detail: { planTier: 'PRO', priceCents: 9900 } })
        expect(billingEventsFor(snap('PRO', 'ACTIVE', new Date()), snap('PRO', 'ACTIVE')).map((e) => e.type)).toEqual(['CANCEL_REVERTED'])
        expect(billingEventsFor(snap('PRO', 'ACTIVE'), snap('PRO', 'ACTIVE'))).toEqual([])
    })
})

describe('pessoas', () => {
    it('filtra donos, convidados e forma de entrar', async () => {
        const a = await createUser('Ana')
        await prisma.user.update({ where: { id: a.user.id }, data: { googleSub: 'g-ana' } })
        await addMember(a.workspace.id, 'MEMBER', 'Bruno')

        const all = await get('/people')
        expect(all.body.counts).toEqual({ all: 2, owners: 1, members: 1, google: 1, password: 1 })
        const members = await get('/people?filter=members')
        expect(members.body.items).toHaveLength(1)
        expect(members.body.items[0]).toMatchObject({
            name: 'Bruno',
            loginMethods: ['PASSWORD'],
            memberships: [{ role: 'MEMBER', workspaceName: 'Ana Ltda', effectiveTier: 'PRO' }]
        })
        expect((await get('/people?q=ana')).body.items[0].loginMethods).toEqual(['PASSWORD', 'GOOGLE'])
    })
})

describe('sistema', () => {
    it('mostra banco, e-mails, catálogo e avisos do Stripe; reenvia e-mail que falhou', async () => {
        const a = await createUser('Ana')
        await prisma.workspace.update({ where: { id: a.workspace.id }, data: { stripeCustomerId: 'cus_ana' } })
        const failed = await prisma.emailOutbox.create({
            data: { to: 'x@y.z', template: 'proposal_opened', payload: {}, status: 'FAILED', attempts: 5, dedupeKey: 'k1', lastError: 'boom' }
        })
        await prisma.emailOutbox.create({ data: { to: 'y@y.z', template: 'team_invite', payload: {}, status: 'SENT', dedupeKey: 'k2', sentAt: new Date() } })

        const { payload, header } = signedEvent('invoice.paid', { id: 'in_1', customer: 'cus_ana' })
        await request(app).post('/webhooks/stripe').set('stripe-signature', header).set('Content-Type', 'application/json').send(payload)

        const res = await get('/system')
        expect(res.status).toBe(200)
        expect(res.body.database).toMatchObject({ ok: true })
        expect(res.body.database.migrations).toBeGreaterThan(10)
        expect(res.body.email).toMatchObject({ provider: 'console', sent24h: 1, failed: 1, pending: 0 })
        expect(res.body.stripe.mode).toBe('test')
        expect(res.body.stripe.catalog).toMatchObject({ ok: true })
        expect(res.body.stripe.catalog.items).toHaveLength(3)
        expect(res.body.stripe.webhook.recent[0]).toMatchObject({ type: 'invoice.paid', customerId: 'cus_ana', outcome: 'synced' })

        const retry = await request(app).post(`/api/internal/ops/emails/${failed.id}/retry`).set('Authorization', ops)
        expect(retry.status).toBe(200)
        expect(await prisma.emailOutbox.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null })
        expect((await request(app).post(`/api/internal/ops/emails/${failed.id}/retry`).set('Authorization', ops)).status).toBe(409)
    })
})
