import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { ensureCatalogPrices, setStripe } from '../src/lib/stripe.js'
import { accountActionRateLimit } from '../src/middlewares/rateLimit.js'
import { enforcePaymentGrace } from '../src/services/payment-grace.service.js'
import { addMember, createUser, resetDatabase } from './helpers.js'
import { createStripeFake } from './stripeFake.js'

let fake: ReturnType<typeof createStripeFake>

beforeEach(async () => {
    await resetDatabase()
    fake = createStripeFake()
    setStripe(fake.stripe)
    for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) await accountActionRateLimit.resetKey(ip)
})

afterAll(() => setStripe(null))

const DAY = 24 * 60 * 60 * 1000
let slugSeq = 0

async function deletionCode(auth: string) {
    const res = await request(app).post('/api/me/deletion/code').set('Authorization', auth)
    expect(res.status).toBe(200)
    const mail = await prisma.emailOutbox.findFirstOrThrow({ where: { template: 'account_deletion_code' }, orderBy: { createdAt: 'desc' } })
    return (mail.payload as { code: string }).code
}

const deleteMe = (auth: string, body: Record<string, unknown>) => request(app).delete('/api/me').set('Authorization', auth).send({ confirm: 'EXCLUIR', ...body })

/** Proposta direto no banco; `accepted` cria o aceite do cliente com as duas assinaturas (o comprovante). */
async function proposal(providerId: string, opts: { accepted?: boolean; declined?: boolean } = {}) {
    slugSeq += 1
    const p = await prisma.proposal.create({
        data: { providerId, clientName: `Cliente ${slugSeq}`, slug: `del-${slugSeq}`, status: opts.accepted ? 'FECHADA' : 'ABERTA' }
    })
    const signer = { signerName: 'Maria Cliente', signerEmail: 'maria@cliente.com', contentHash: 'hash' }
    if (opts.declined) await prisma.proposalResponse.create({ data: { proposalId: p.id, type: 'DECLINED', ...signer } })
    if (opts.accepted) {
        const response = await prisma.proposalResponse.create({ data: { proposalId: p.id, type: 'ACCEPTED', signerDocument: '52998224725', ...signer } })
        await prisma.proposalSignature.create({
            data: { proposalId: p.id, role: 'CLIENT', responseId: response.id, signerDocument: '52998224725', method: 'TYPED', typedText: 'Maria', emailVerifiedAt: new Date(), ...signer }
        })
    }
    await prisma.proposalView.create({ data: { proposalId: p.id, proposalSlug: p.slug, sessionId: 's', viewedAt: new Date() } })
    return p
}

/** Empresa assinante no Stripe (cliente, cartão e assinatura). */
async function subscribe(workspaceId: string, status: 'active' | 'past_due' = 'active') {
    const prices = await ensureCatalogPrices()
    const customer = await fake.stripe.customers.create({ email: 'dono@antigo.com' })
    const card = fake.addPaymentMethod(customer.id)
    const periodEnd = Math.floor((Date.now() + 20 * DAY) / 1000)
    const sub = fake.addSubscription(customer.id, prices.PRO.priceId, status, { current_period_end: periodEnd })
    await prisma.workspace.update({
        where: { id: workspaceId },
        data: { stripeCustomerId: customer.id, stripeSubscriptionId: sub.id, planTier: 'PRO', billingStatus: status === 'active' ? 'ACTIVE' : 'PAST_DUE' }
    })
    return { customer, card, sub, periodEnd }
}

describe('baixar meus dados', () => {
    it('entrega os dados pessoais da conta em JSON, como anexo', async () => {
        const a = await createUser('Ana Dona')
        await prisma.user.update({ where: { id: a.user.id }, data: { cpf: '52998224725' } })

        const res = await request(app).get('/api/me/export').set('Authorization', a.auth)

        expect(res.status).toBe(200)
        expect(res.headers['content-disposition']).toMatch(/^attachment; filename="lumen-deal-meus-dados-\d{4}-\d{2}-\d{2}\.json"$/)
        expect(res.headers['cache-control']).toBe('no-store')
        expect(res.body.account).toMatchObject({ name: 'Ana Dona', email: a.email, cpf: '529.982.247-25', loginMethods: ['PASSWORD'] })
        expect(res.body.account.passwordHash).toBeUndefined()
        expect(res.body.workspaces).toEqual([expect.objectContaining({ name: 'Ana Dona Ltda', role: 'OWNER', planTier: 'PRO' })])
        expect((await request(app).get('/api/me/export')).status).toBe(401)
    })
})

describe('excluir minha conta', () => {
    it('exige código do e-mail, a palavra EXCLUIR e a decisão sobre empresa com membros', async () => {
        const a = await createUser('Ana')
        await addMember(a.workspace.id, 'ADMIN', 'Bruno')

        expect((await deleteMe(a.auth, { code: '123456' })).body.code).toBe('DECISION_REQUIRED')
        const code = await deletionCode(a.auth)
        expect((await deleteMe(a.auth, { code, confirm: 'sim' })).status).toBe(400)
        const wrong = await deleteMe(a.auth, { code: code === '000000' ? '111111' : '000000', workspaces: [{ workspaceId: a.workspace.id, action: 'CLOSE' }] })
        expect(wrong.body.code).toBe('CODE_INVALID')

        expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(1)
        expect(await prisma.workspaceMember.count({ where: { workspaceId: a.workspace.id } })).toBe(2)
    })

    it('dono sozinho: encerra a empresa e guarda só as propostas aceitas (comprovante)', async () => {
        const a = await createUser('Ana')
        const open = await proposal(a.provider.id)
        const signed = await proposal(a.provider.id, { accepted: true, declined: true })
        await prisma.proposalTemplate.create({ data: { workspaceId: a.workspace.id, name: 'Modelo', blocks: [] } })

        const res = await deleteMe(a.auth, { code: await deletionCode(a.auth) })

        expect(res.status).toBe(204)
        expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(0)
        expect((await request(app).get('/api/auth/me').set('Authorization', a.auth)).status).toBe(401)
        expect(await prisma.proposal.findUnique({ where: { id: open.id } })).toBeNull()
        const kept = await prisma.proposal.findUniqueOrThrow({ where: { id: signed.id }, include: { responses: true, signatures: true, views: true, provider: true } })
        expect(kept.responses.map((r) => r.type)).toEqual(['ACCEPTED'])
        expect(kept.signatures).toHaveLength(1)
        expect(kept.views).toHaveLength(0)
        expect(kept.provider.userId).toBeNull()
        const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })
        expect(workspace.closedAt).not.toBeNull()
        expect(workspace).toMatchObject({ planTier: 'FREE', stripeCustomerId: null })
        expect(await prisma.proposalTemplate.count()).toBe(0)
        // O cliente continua abrindo o comprovante pelo link.
        expect((await request(app).get(`/api/public/proposals/${signed.slug}`)).status).toBe(200)
    })

    it('dono sozinho sem proposta aceita: a empresa sai inteira', async () => {
        const a = await createUser('Ana')
        await proposal(a.provider.id)
        expect((await deleteMe(a.auth, { code: await deletionCode(a.auth) })).status).toBe(204)
        expect(await prisma.workspace.count({ where: { id: a.workspace.id } })).toBe(0)
        expect(await prisma.provider.count()).toBe(0)
    })

    it('encerrar com membros: cancela no Stripe, avisa a equipe e ela fica sem empresa', async () => {
        const a = await createUser('Ana')
        const b = await addMember(a.workspace.id, 'MEMBER', 'Bruno')
        const { customer, sub } = await subscribe(a.workspace.id)

        const res = await deleteMe(a.auth, { code: await deletionCode(a.auth), workspaces: [{ workspaceId: a.workspace.id, action: 'CLOSE' }] })

        expect(res.status).toBe(204)
        expect(fake.customers.has(customer.id)).toBe(false)
        expect(fake.subscriptions.get(sub.id).status).toBe('canceled')
        const me = await request(app).get('/api/auth/me').set('Authorization', b.auth)
        expect(me.status).toBe(200)
        expect(me.body.user.workspaces).toEqual([])
        const mail = await prisma.emailOutbox.findFirstOrThrow({ where: { template: 'workspace_closed' } })
        expect(mail.to).toBe(b.email.toLowerCase())
    })

    it('indicar novo dono: assinatura continua, cartão do dono antigo sai e o novo dono tem prazo', async () => {
        const a = await createUser('Ana')
        const b = await addMember(a.workspace.id, 'MEMBER', 'Bruno')
        const p = await proposal(a.provider.id)
        const { customer, card, sub, periodEnd } = await subscribe(a.workspace.id)

        const res = await deleteMe(a.auth, {
            code: await deletionCode(a.auth),
            workspaces: [{ workspaceId: a.workspace.id, action: 'TRANSFER', newOwnerUserId: b.user.id }]
        })

        expect(res.status).toBe(204)
        expect((await prisma.workspaceMember.findFirstOrThrow({ where: { userId: b.user.id } })).role).toBe('OWNER')
        expect((await prisma.provider.findUniqueOrThrow({ where: { id: a.provider.id } })).userId).toBe(b.user.id)
        expect(await prisma.proposal.count({ where: { id: p.id } })).toBe(1)
        expect(fake.subscriptions.get(sub.id).status).toBe('active')
        expect(fake.paymentMethods.get(card.id).customer).toBeNull()
        expect(fake.customers.get(customer.id).email).toBe(b.email)
        const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })
        expect(workspace.planTier).toBe('PRO')
        expect(workspace.paymentGraceUntil?.getTime()).toBe(periodEnd * 1000 + 7 * DAY)
        const mail = await prisma.emailOutbox.findFirstOrThrow({ where: { template: 'ownership_transferred' } })
        expect(mail.to).toBe(b.email.toLowerCase())
        expect(mail.payload).toMatchObject({ previousOwnerName: 'Ana', paidUntil: new Date(periodEnd * 1000).toISOString() })
    })

    it('cobrança já atrasada na troca: 7 dias a partir de agora', async () => {
        const a = await createUser('Ana')
        const b = await addMember(a.workspace.id, 'ADMIN', 'Bruno')
        await subscribe(a.workspace.id, 'past_due')
        const before = Date.now()

        await deleteMe(a.auth, { code: await deletionCode(a.auth), workspaces: [{ workspaceId: a.workspace.id, action: 'TRANSFER', newOwnerUserId: b.user.id }] })

        const grace = (await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })).paymentGraceUntil!.getTime()
        expect(grace).toBeGreaterThanOrEqual(before + 7 * DAY)
        expect(grace).toBeLessThanOrEqual(Date.now() + 7 * DAY)
    })

    it('recusa novo dono de fora da empresa', async () => {
        const a = await createUser('Ana')
        await addMember(a.workspace.id)
        const outsider = await createUser('Fora')
        const res = await deleteMe(a.auth, {
            code: await deletionCode(a.auth),
            workspaces: [{ workspaceId: a.workspace.id, action: 'TRANSFER', newOwnerUserId: outsider.user.id }]
        })
        expect(res.body.code).toBe('INVALID_NEW_OWNER')
        expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(1)
    })

    it('membro que sai: a empresa continua e o perfil que ele criou passa para o dono', async () => {
        const a = await createUser('Ana')
        const b = await addMember(a.workspace.id, 'ADMIN', 'Bruno')
        const created = await prisma.provider.create({ data: { userId: b.user.id, workspaceId: a.workspace.id, name: 'Perfil do Bruno', email: 'p@x.com' } })

        expect((await deleteMe(b.auth, { code: await deletionCode(b.auth) })).status).toBe(204)

        expect((await prisma.provider.findUniqueOrThrow({ where: { id: created.id } })).userId).toBe(a.user.id)
        expect(await prisma.workspaceMember.count({ where: { workspaceId: a.workspace.id } })).toBe(1)
        expect((await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })).closedAt).toBeNull()
    })

    it('Stripe fora do ar: nada é excluído', async () => {
        const a = await createUser('Ana')
        await subscribe(a.workspace.id)
        ;(fake.stripe.customers as any).del = async () => {
            throw Object.assign(new Error('permission denied'), { code: 'permission_error' })
        }

        const res = await deleteMe(a.auth, { code: await deletionCode(a.auth) })

        expect(res.status).toBe(502)
        expect(res.body.code).toBe('BILLING_UNAVAILABLE')
        expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(1)
        expect(await prisma.workspaceMember.count({ where: { workspaceId: a.workspace.id } })).toBe(1)
    })

    it('código vale uma vez só', async () => {
        const a = await createUser('Ana')
        const code = await deletionCode(a.auth)
        await prisma.accountDeletionCode.updateMany({ data: { usedAt: new Date() } })
        expect((await deleteMe(a.auth, { code })).body.code).toBe('CODE_EXPIRED')
    })
})

describe('prazo do novo dono', () => {
    it('sem pagamento em dia no fim do prazo: cancela e volta para o Grátis', async () => {
        const a = await createUser('Ana')
        const { sub } = await subscribe(a.workspace.id, 'past_due')
        await prisma.workspace.update({ where: { id: a.workspace.id }, data: { paymentGraceUntil: new Date(Date.now() - 1000) } })

        expect(await enforcePaymentGrace()).toEqual({ checked: 1, canceled: 1 })

        expect(fake.subscriptions.get(sub.id).status).toBe('canceled')
        expect(await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })).toMatchObject({ planTier: 'FREE', paymentGraceUntil: null })
    })

    it('pagamento em dia: só apaga o prazo; prazo no futuro não é tocado', async () => {
        const a = await createUser('Ana')
        const b = await createUser('Bia')
        const { sub } = await subscribe(a.workspace.id, 'active')
        await subscribe(b.workspace.id, 'past_due')
        const future = new Date(Date.now() + DAY)
        await prisma.workspace.update({ where: { id: a.workspace.id }, data: { paymentGraceUntil: new Date(Date.now() - 1000) } })
        await prisma.workspace.update({ where: { id: b.workspace.id }, data: { paymentGraceUntil: future } })

        expect(await enforcePaymentGrace()).toEqual({ checked: 1, canceled: 0 })

        expect(fake.subscriptions.get(sub.id).status).toBe('active')
        expect(await prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } })).toMatchObject({ planTier: 'PRO', paymentGraceUntil: null })
        expect((await prisma.workspace.findUniqueOrThrow({ where: { id: b.workspace.id } })).paymentGraceUntil).toEqual(future)
    })
})
