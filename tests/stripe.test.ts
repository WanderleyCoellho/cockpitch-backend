import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { ensureCatalogPrices, PLAN_CATALOG, resetStripeCatalogCache, setStripe } from '../src/lib/stripe.js'
import { runBillingReconciliationOnce } from '../src/jobs/billingReconciliation.job.js'
import { addMember, createUser, resetDatabase } from './helpers.js'
import { createStripeFake, signedEvent } from './stripeFake.js'

let fake: ReturnType<typeof createStripeFake>

beforeEach(async () => {
    await resetDatabase()
    fake = createStripeFake()
    setStripe(fake.stripe)
})

afterAll(() => setStripe(null))

const free = { planTier: 'FREE' as const, billingStatus: 'INACTIVE' as const }

async function sendWebhook(type: string, object: Record<string, unknown>) {
    const { payload, header } = signedEvent(type, object)
    return request(app).post('/webhooks/stripe').set('stripe-signature', header).set('Content-Type', 'application/json').send(payload)
}

describe('catálogo de planos no Stripe', () => {
    it('cria produtos e preços mensais em BRL uma única vez (por lookup_key)', async () => {
        const prices = await ensureCatalogPrices()
        expect(fake.products.size).toBe(3)
        expect(fake.prices.size).toBe(3)
        const pro = fake.prices.get(prices.PRO.priceId)
        expect(pro).toMatchObject({ currency: 'brl', unit_amount: 9900, recurring: { interval: 'month' }, lookup_key: PLAN_CATALOG.PRO.lookupKey })

        // Novo processo (deploy): encontra os preços existentes, não duplica.
        resetStripeCatalogCache()
        const again = await ensureCatalogPrices()
        expect(again.PRO.priceId).toBe(prices.PRO.priceId)
        expect(fake.prices.size).toBe(3)
    })

    it('valor diferente no catálogo cria preço novo e transfere a lookup_key', async () => {
        const first = await ensureCatalogPrices()
        fake.prices.get(first.STARTER.priceId).unit_amount = 3900
        resetStripeCatalogCache()
        const next = await ensureCatalogPrices()
        expect(next.STARTER.priceId).not.toBe(first.STARTER.priceId)
        expect(fake.prices.get(next.STARTER.priceId).lookup_key).toBe(PLAN_CATALOG.STARTER.lookupKey)
        expect(fake.prices.get(first.STARTER.priceId).lookup_key).toBeNull()
        expect(fake.products.size).toBe(3)
    })
})

describe('checkout e portal', () => {
    it('dono abre o checkout do plano; o cliente Stripe é criado uma vez', async () => {
        const a = await createUser('Ana', free)
        const res = await request(app).post('/api/stripe/create-checkout').set('Authorization', a.auth).send({ planTier: 'PRO' })
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({ mode: 'checkout', url: 'https://checkout.stripe.com/fake' })

        const prices = await ensureCatalogPrices()
        const session = fake.sessions.get(res.body.sessionId)
        expect(session.line_items).toEqual([{ price: prices.PRO.priceId, quantity: 1 }])
        expect(session.client_reference_id).toBe(a.workspace.id)
        expect(session.tax_id_collection).toEqual({ enabled: true })
        expect(session.success_url).toContain('session_id={CHECKOUT_SESSION_ID}')

        await request(app).post('/api/stripe/create-checkout').set('Authorization', a.auth).send({ planTier: 'STARTER' })
        expect(fake.customers.size).toBe(1)
        const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })
        expect(ws.stripeCustomerId).toBe(session.customer)
    })

    it('quem já assina vai para o portal confirmar a troca de plano (sem segunda assinatura)', async () => {
        const a = await createUser('Ana', free)
        await request(app).post('/api/stripe/create-checkout').set('Authorization', a.auth).send({ planTier: 'STARTER' })
        const prices = await ensureCatalogPrices()
        const { stripeCustomerId } = await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })
        const sub = fake.addSubscription(stripeCustomerId!, prices.STARTER.priceId)

        const res = await request(app).post('/api/stripe/create-checkout').set('Authorization', a.auth).send({ planTier: 'PRO' })
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({ mode: 'portal', url: 'https://billing.stripe.com/fake' })
        expect(fake.sessions.size).toBe(1)
        const portal = fake.portalSessions.at(-1)
        expect(portal.flow_data.subscription_update_confirm).toEqual({
            subscription: sub.id,
            items: [{ id: sub.items.data[0].id, price: prices.PRO.priceId, quantity: 1 }]
        })
        // Configuração do portal permite trocar entre os três planos.
        expect(fake.portalConfigs[0].features.subscription_update.products).toHaveLength(3)
    })

    it('portal exige cliente Stripe e é só do dono; cortesia não abre checkout', async () => {
        const a = await createUser('Ana', free)
        expect((await request(app).post('/api/stripe/portal').set('Authorization', a.auth)).status).toBe(409)
        await request(app).post('/api/stripe/create-checkout').set('Authorization', a.auth).send({ planTier: 'PRO' })
        expect((await request(app).post('/api/stripe/portal').set('Authorization', a.auth)).body.url).toBe('https://billing.stripe.com/fake')

        const admin = await addMember(a.workspace.id, 'ADMIN')
        expect((await request(app).post('/api/stripe/portal').set('Authorization', admin.auth)).status).toBe(403)

        const c = await createUser('Cora', { planTier: 'PRO', billingStatus: 'ACTIVE', licensePolicy: 'COURTESY' })
        const res = await request(app).post('/api/stripe/create-checkout').set('Authorization', c.auth).send({ planTier: 'AGENCY' })
        expect(res.status).toBe(409)
    })

    it('volta do checkout sincroniza na hora; sessão de outro workspace é recusada', async () => {
        const a = await createUser('Ana', free)
        const b = await createUser('Bia', free)
        const started = await request(app).post('/api/stripe/create-checkout').set('Authorization', a.auth).send({ planTier: 'PRO' })
        const prices = await ensureCatalogPrices()
        fake.addSubscription(fake.sessions.get(started.body.sessionId).customer, prices.PRO.priceId)

        const other = await request(app).post('/api/stripe/sync').set('Authorization', b.auth).send({ sessionId: started.body.sessionId })
        expect(other.status).toBe(404)

        const synced = await request(app).post('/api/stripe/sync').set('Authorization', a.auth).send({ sessionId: started.body.sessionId })
        expect(synced.status).toBe(200)
        expect(synced.body).toEqual({ planTier: 'PRO', billingStatus: 'ACTIVE' })
    })
})

describe('webhook', () => {
    async function subscribedWorkspace() {
        const a = await createUser('Ana', free)
        await request(app).post('/api/stripe/create-checkout').set('Authorization', a.auth).send({ planTier: 'PRO' })
        const { stripeCustomerId } = await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })
        return { ...a, customerId: stripeCustomerId! }
    }

    it('recusa assinatura inválida', async () => {
        const res = await request(app)
            .post('/webhooks/stripe')
            .set('stripe-signature', 't=1,v1=bad')
            .set('Content-Type', 'application/json')
            .send('{}')
        expect(res.status).toBe(400)
    })

    it('aplica o estado atual do Stripe, mesmo com eventos fora de ordem', async () => {
        const a = await subscribedWorkspace()
        const prices = await ensureCatalogPrices()
        const sub = fake.addSubscription(a.customerId, prices.PRO.priceId)

        expect((await sendWebhook('customer.subscription.created', { ...sub })).status).toBe(200)
        let ws = await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })
        expect(ws).toMatchObject({ planTier: 'PRO', billingStatus: 'ACTIVE', stripeSubscriptionId: sub.id })
        const owner = await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })
        expect(owner.planTier).toBe('PRO')

        // Cancelada no Stripe; o "created" antigo chega depois e não reativa.
        sub.status = 'canceled'
        await sendWebhook('customer.subscription.deleted', { ...sub })
        await sendWebhook('customer.subscription.created', { ...sub, status: 'active' })
        ws = await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })
        expect(ws).toMatchObject({ planTier: 'FREE', billingStatus: 'CANCELED' })
    })

    it('pagamento atrasado mantém o plano; assinatura incompleta não libera plano', async () => {
        const a = await subscribedWorkspace()
        const prices = await ensureCatalogPrices()
        const sub = fake.addSubscription(a.customerId, prices.AGENCY.priceId, 'incomplete')
        await sendWebhook('checkout.session.completed', { id: 'cs_x', customer: a.customerId, client_reference_id: a.workspace.id })
        expect(await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })).toMatchObject({ planTier: 'FREE', billingStatus: 'INACTIVE' })

        sub.status = 'active'
        await sendWebhook('invoice.paid', { id: 'in_1', customer: a.customerId })
        expect(await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })).toMatchObject({ planTier: 'AGENCY', billingStatus: 'ACTIVE' })

        sub.status = 'past_due'
        await sendWebhook('invoice.payment_failed', { id: 'in_2', customer: a.customerId })
        expect(await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })).toMatchObject({ planTier: 'AGENCY', billingStatus: 'PAST_DUE' })
    })

    it('ignora clientes de fora do Lumen Deal e preserva cortesia', async () => {
        const res = await sendWebhook('invoice.paid', { id: 'in_9', customer: 'cus_outro_negocio' })
        expect(res.status).toBe(200)

        const c = await createUser('Cora', { planTier: 'PRO', billingStatus: 'ACTIVE', licensePolicy: 'COURTESY' })
        await prisma.workspace.update({ where: { id: c.workspace.id }, data: { stripeCustomerId: 'cus_cortesia' } })
        await sendWebhook('customer.subscription.deleted', { id: 'sub_c', customer: 'cus_cortesia' })
        expect(await prisma.workspace.findUniqueOrThrow({ where: { id: c.workspace.id } })).toMatchObject({ planTier: 'PRO', billingStatus: 'ACTIVE' })
    })

    it('reconciliação usa a mesma sincronização', async () => {
        const a = await subscribedWorkspace()
        const prices = await ensureCatalogPrices()
        fake.addSubscription(a.customerId, prices.STARTER.priceId)
        const result = await runBillingReconciliationOnce()
        expect(result).toMatchObject({ total: 1, updated: 1, failed: 0 })
        expect(await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })).toMatchObject({ planTier: 'STARTER' })
        expect((await runBillingReconciliationOnce()).unchanged).toBe(1)
    })
})
