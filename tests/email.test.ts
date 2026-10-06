import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { setMailer, ConsoleMailer, type Mailer, type OutgoingEmail } from '../src/lib/mailer/index.js'
import { dispatchEmailOutbox, enqueueEmails, MAX_ATTEMPTS } from '../src/services/email/outbox.js'
import { renderEmail } from '../src/services/email/templates.js'
import { addMember, createUser, resetDatabase } from './helpers.js'

class FakeMailer implements Mailer {
    readonly name = 'fake'
    sent: OutgoingEmail[] = []
    failWith: string | null = null
    async send(email: OutgoingEmail) {
        if (this.failWith) throw new Error(this.failWith)
        this.sent.push(email)
    }
}

let mailer: FakeMailer
beforeEach(async () => {
    await resetDatabase()
    mailer = new FakeMailer()
    setMailer(mailer)
})
afterEach(() => setMailer(new ConsoleMailer()))

let n = 0
async function setupProposal() {
    const a = await createUser('Dona da Empresa')
    await prisma.provider.update({ where: { id: a.provider.id }, data: { email: 'contato@empresa.com', whatsapp: '5581999990000' } })
    n += 1
    const slug = `email-${n}`
    const created = await request(app)
        .post('/api/proposals')
        .set('Authorization', a.auth)
        .send({ providerId: a.provider.id, clientName: 'Cliente <b>VIP</b>', slug, templateId: 'sys-general' })
    expect(created.status).toBe(201)
    return { a, slug, proposalId: created.body.proposal.id as string }
}

const view = (proposalId: string, auth?: string) => {
    const req = request(app).post('/api/proposal-views')
    if (auth) req.set('Authorization', auth)
    return req.send({ proposalId, sessionId: `s-${Math.random()}` })
}

describe('notificações por e-mail', () => {
    it('aceite gera 2 e-mails na fila (equipe + cliente) e o envio usa reply-to correto', async () => {
        const { slug, a } = await setupProposal()
        const res = await request(app)
            .post(`/api/public/proposals/${slug}/responses`)
            .send({ type: 'ACCEPTED', signerName: 'Maria Cliente', signerEmail: 'maria@cliente.com', agreeTerms: true })
        expect(res.status).toBe(201)

        const queued = await prisma.emailOutbox.findMany({ orderBy: { template: 'asc' } })
        expect(queued.map((q) => [q.template, q.to])).toEqual([
            ['acceptance_confirmation', 'maria@cliente.com'],
            ['proposal_response', a.email.toLowerCase()]
        ])

        expect(await dispatchEmailOutbox()).toEqual({ sent: 2, retried: 0, failed: 0 })
        const toTeam = mailer.sent.find((m) => m.to === a.email.toLowerCase())!
        expect(toTeam.subject).toContain('aceitou a proposta')
        expect(toTeam.replyTo).toBe('maria@cliente.com')
        const toClient = mailer.sent.find((m) => m.to === 'maria@cliente.com')!
        expect(toClient.replyTo).toBe('contato@empresa.com')
        expect(toClient.html).toContain('Cliente &lt;b&gt;VIP&lt;/b&gt;')
        expect(toClient.html).not.toContain('<b>VIP</b>')
        expect((await prisma.emailOutbox.findMany()).every((q) => q.status === 'SENT' && q.sentAt)).toBe(true)
    })

    it('pedido de ajuste avisa só a equipe', async () => {
        const { slug } = await setupProposal()
        await request(app).post(`/api/public/proposals/${slug}/responses`).send({ type: 'CHANGE_REQUESTED', signerName: 'Maria Cliente', signerEmail: 'maria@cliente.com', message: 'Pode baixar o valor?' })
        const queued = await prisma.emailOutbox.findMany()
        expect(queued.map((q) => q.template)).toEqual(['proposal_response'])
    })

    it('primeira abertura avisa uma única vez; abertura da própria equipe não conta', async () => {
        const { a, proposalId } = await setupProposal()
        expect((await view(proposalId, a.auth)).status).toBe(204)
        expect(await prisma.proposalView.count()).toBe(0)
        expect(await prisma.emailOutbox.count()).toBe(0)

        expect((await view(proposalId)).status).toBe(201)
        expect((await view(proposalId)).status).toBe(201)
        expect(await prisma.proposalView.count()).toBe(2)
        const queued = await prisma.emailOutbox.findMany()
        expect(queued).toHaveLength(1)
        expect(queued[0]).toMatchObject({ template: 'proposal_opened', dedupeKey: `opened:${proposalId}:${a.user.id}` })
    })

    it('respeita as preferências de cada pessoa', async () => {
        const { a, proposalId } = await setupProposal()
        const m = await addMember(a.workspace.id, 'MEMBER', 'Vendedor')
        const prefs = await request(app).patch('/api/workspaces/current/notifications').set('Authorization', m.auth).send({ notifyOnOpen: false })
        expect(prefs.body.preferences).toEqual({ notifyOnOpen: false, notifyOnResponse: true })
        expect((await request(app).get('/api/workspaces/current/notifications').set('Authorization', a.auth)).body.preferences).toEqual({ notifyOnOpen: true, notifyOnResponse: true })

        await view(proposalId)
        expect((await prisma.emailOutbox.findMany()).map((q) => q.to)).toEqual([a.email.toLowerCase()])
    })

    it('convite de equipe sai por e-mail', async () => {
        const a = await createUser('Dona')
        const res = await request(app).post('/api/workspaces/current/invites').set('Authorization', a.auth).send({ email: 'Nova@Pessoa.com', role: 'MEMBER' })
        expect(res.status).toBe(201)
        expect(res.body.emailQueued).toBe(true)
        await dispatchEmailOutbox()
        expect(mailer.sent).toHaveLength(1)
        expect(mailer.sent[0].to).toBe('nova@pessoa.com')
        expect(mailer.sent[0].html).toContain(res.body.inviteUrl)
    })
})

describe('fila de e-mails', () => {
    const base = { template: 'team_invite' as const, payload: { companyName: 'X', role: 'MEMBER' as const, inviteUrl: 'https://x.test/c/1', expiresAt: new Date().toISOString() } }

    it('dedupe impede o segundo e-mail com a mesma chave', async () => {
        expect(await enqueueEmails(prisma, [{ ...base, to: 'a@x.com', dedupeKey: 'k1' }])).toBe(1)
        expect(await enqueueEmails(prisma, [{ ...base, to: 'a@x.com', dedupeKey: 'k1' }])).toBe(0)
        expect(await prisma.emailOutbox.count()).toBe(1)
    })

    it('falha: tentativas aumentam com espera crescente e, na 5ª, vira FAILED', async () => {
        await enqueueEmails(prisma, [{ ...base, to: 'a@x.com', dedupeKey: 'k2' }])
        mailer.failWith = 'Resend 500'
        let now = new Date()
        const waits: number[] = []
        for (let i = 1; i <= MAX_ATTEMPTS; i++) {
            await dispatchEmailOutbox(now)
            const row = await prisma.emailOutbox.findFirstOrThrow()
            expect(row.attempts).toBe(i)
            expect(row.lastError).toContain('Resend 500')
            waits.push(Math.round((row.nextAttemptAt.getTime() - now.getTime()) / 60_000))
            // antes do horário marcado, nada é reenviado
            expect((await dispatchEmailOutbox(now)).retried).toBe(0)
            now = row.nextAttemptAt
        }
        expect(waits.slice(0, 4)).toEqual([1, 5, 15, 60])
        expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe('FAILED')
    })

    it('dois despachos ao mesmo tempo não enviam o mesmo e-mail duas vezes', async () => {
        await enqueueEmails(prisma, Array.from({ length: 8 }, (_, i) => ({ ...base, to: `p${i}@x.com`, dedupeKey: `c${i}` })))
        const [r1, r2] = await Promise.all([dispatchEmailOutbox(), dispatchEmailOutbox()])
        expect(r1.sent + r2.sent).toBe(8)
        expect(new Set(mailer.sent.map((m) => m.to)).size).toBe(8)
        expect(mailer.sent).toHaveLength(8)
    })

    it('modelos escapam conteúdo e recusam link perigoso no botão', () => {
        const out = renderEmail('proposal_opened', {
            companyName: '<img src=x onerror=alert(1)>',
            brandColor: 'red;background:url(x)',
            clientName: 'Ana',
            proposalUrl: 'https://deal.test/p/a',
            panelUrl: 'javascript:alert(1)',
            openedAt: new Date().toISOString()
        })
        expect(out.html).not.toContain('<img')
        expect(out.html).not.toContain('javascript:')
        expect(out.html).not.toContain('url(x)')
        expect(out.text).toContain('Ana abriu a proposta')
    })
})
