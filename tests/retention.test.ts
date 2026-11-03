import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { runDataRetention } from '../src/services/data-retention.service.js'
import { notifyProposalOpened } from '../src/services/notifications.service.js'
import { createUser, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)

const DAY = 24 * 60 * 60 * 1000
const now = new Date()
const ago = (days: number) => new Date(now.getTime() - days * DAY)

describe('retenção de dados', () => {
    it('apaga códigos de assinatura com mais de 2 dias e mantém os recentes', async () => {
        const base = { proposalId: 'p1', role: 'CLIENT' as const, email: 'c@x.com', codeHash: 'h', ip: '1.2.3.4' }
        await prisma.signatureCode.create({ data: { ...base, createdAt: ago(3), expiresAt: ago(3) } })
        const recent = await prisma.signatureCode.create({ data: { ...base, createdAt: ago(1), expiresAt: ago(1) } })

        const result = await runDataRetention(now)

        expect(result.signatureCodes).toBe(1)
        expect((await prisma.signatureCode.findMany()).map((c) => c.id)).toEqual([recent.id])
    })

    it('apaga confirmações do Google vencidas há mais de 7 dias', async () => {
        const base = { email: 'g@x.com', googleSub: 'sub', name: 'G' }
        await prisma.googleSignupConfirmation.create({ data: { ...base, tokenHash: 'old', expiresAt: ago(8), usedAt: ago(9) } })
        await prisma.googleSignupConfirmation.create({ data: { ...base, tokenHash: 'recent', expiresAt: ago(2) } })

        await runDataRetention(now)

        expect((await prisma.googleSignupConfirmation.findMany()).map((c) => c.tokenHash)).toEqual(['recent'])
    })

    it('apaga convites não aceitos vencidos há mais de 30 dias; aceitos ficam', async () => {
        const a = await createUser()
        const base = { workspaceId: a.workspace.id, email: 'convidado@x.com' }
        await prisma.workspaceInvite.create({ data: { ...base, tokenHash: 'expired', expiresAt: ago(31) } })
        await prisma.workspaceInvite.create({ data: { ...base, tokenHash: 'accepted', expiresAt: ago(60), acceptedAt: ago(62) } })
        await prisma.workspaceInvite.create({ data: { ...base, tokenHash: 'recent', expiresAt: ago(10) } })

        await runDataRetention(now)

        const left = (await prisma.workspaceInvite.findMany({ orderBy: { tokenHash: 'asc' } })).map((i) => i.tokenHash)
        expect(left).toEqual(['accepted', 'recent'])
    })

    it('tira da fila e-mails com código ou link vencido, inclusive os que nunca saíram', async () => {
        const mail = (dedupeKey: string, template: string, createdAt: Date, status: 'SENT' | 'PENDING' = 'SENT') =>
            prisma.emailOutbox.create({ data: { to: 'c@x.com', template, payload: { code: '123456' }, dedupeKey, createdAt, status } })
        await mail('code-old', 'signature_code', ago(3))
        await mail('code-stuck', 'signature_code', ago(3), 'PENDING')
        await mail('google-old', 'google_confirm', ago(3))
        await mail('invite-old', 'team_invite', ago(9))
        await mail('code-recent', 'signature_code', ago(1))
        await mail('invite-recent', 'team_invite', ago(6))

        const result = await runDataRetention(now)

        expect(result.secretEmails).toBe(4)
        const left = (await prisma.emailOutbox.findMany({ orderBy: { dedupeKey: 'asc' } })).map((e) => e.dedupeKey)
        expect(left).toEqual(['code-recent', 'invite-recent'])
    })

    it('esvazia e-mails comuns com mais de 90 dias, sem mexer nos pendentes nem nos recentes', async () => {
        const mail = (dedupeKey: string, createdAt: Date, status: 'SENT' | 'FAILED' | 'PENDING') =>
            prisma.emailOutbox.create({
                data: { to: 'dono@x.com', template: 'proposal_response', payload: { clientName: 'Maria' }, dedupeKey, createdAt, status, lastError: 'erro com dono@x.com' }
            })
        await mail('old-sent', ago(91), 'SENT')
        await mail('old-failed', ago(91), 'FAILED')
        await mail('old-pending', ago(91), 'PENDING')
        await mail('recent', ago(10), 'SENT')

        expect((await runDataRetention(now)).scrubbedEmails).toBe(2)
        // Rodar de novo não reescreve o que já foi esvaziado.
        expect((await runDataRetention(now)).scrubbedEmails).toBe(0)

        const rows = Object.fromEntries((await prisma.emailOutbox.findMany()).map((e) => [e.dedupeKey, e]))
        for (const key of ['old-sent', 'old-failed']) {
            expect(rows[key]).toMatchObject({ to: '', payload: {}, lastError: null })
        }
        for (const key of ['old-pending', 'recent']) {
            expect(rows[key]).toMatchObject({ to: 'dono@x.com', payload: { clientName: 'Maria' }, lastError: 'erro com dono@x.com' })
        }
    })

    it('o aviso "cliente abriu a proposta" continua saindo uma vez só depois da limpeza', async () => {
        const a = await createUser('Ana')
        const proposal = await prisma.proposal.create({ data: { providerId: a.provider.id, clientName: 'Cliente', slug: 'cliente-retencao' } })

        expect(await notifyProposalOpened(prisma, proposal.id)).toBe(1)
        await prisma.emailOutbox.updateMany({ data: { status: 'SENT', sentAt: ago(100), createdAt: ago(100) } })
        await runDataRetention(now)

        // Cliente volta meses depois: nenhum aviso novo.
        expect(await notifyProposalOpened(prisma, proposal.id)).toBe(0)
        const rows = await prisma.emailOutbox.findMany()
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ template: 'proposal_opened', to: '', payload: {} })
    })

    it('apaga avisos do Stripe com mais de 90 dias', async () => {
        await prisma.stripeEventLog.create({ data: { id: 'evt_old', type: 't', outcome: 'synced', receivedAt: ago(91) } })
        await prisma.stripeEventLog.create({ data: { id: 'evt_new', type: 't', outcome: 'synced', receivedAt: ago(5) } })

        await runDataRetention(now)

        expect((await prisma.stripeEventLog.findMany()).map((e) => e.id)).toEqual(['evt_new'])
    })
})
