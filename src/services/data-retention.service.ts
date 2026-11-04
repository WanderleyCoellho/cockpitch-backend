import { prisma } from '../lib/prisma.js'
import { INVITE_TTL_DAYS } from './workspace.service.js'

/**
 * Retenção de dados (LGPD, art. 15 e 16): apaga o que só serve por pouco tempo.
 * Os prazos aparecem na Política de Privacidade (seção "Por quanto tempo guardamos"); mudou aqui, muda lá.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export const RETENTION_DAYS = {
    /** Códigos de assinatura valem 10 minutos; o limite de pedidos olha a última hora. */
    signatureCodes: 2,
    /** Links de confirmação do Google valem 24 horas; depois disso só servem para dizer "link vencido". */
    googleConfirmations: 7,
    /** Convites não aceitos depois de vencidos. */
    expiredInvites: 30,
    /** Conteúdo dos e-mails comuns já enviados ou que falharam. */
    emails: 90,
    /** Registro de avisos do Stripe (painel Ops). */
    stripeEvents: 90,
    /** Códigos de exclusão de conta (valem 10 minutos). */
    deletionCodes: 2,
    /** Empresa encerrada: as propostas aceitas (comprovantes) ficam 5 anos (prazo de prescrição, CC art. 206, §5º, I). */
    closedWorkspaces: 5 * 365
} as const

/**
 * E-mails que levam código ou link de acesso: saem da fila inteiros assim que o segredo vence.
 * A chave anti-duplicidade deles é o id da linha de origem, que nunca se repete.
 */
const SECRET_EMAIL_DAYS: Record<string, number> = {
    signature_code: 2,
    google_confirm: 2,
    account_deletion_code: 2,
    team_invite: INVITE_TTL_DAYS + 1
}

export type RetentionResult = {
    signatureCodes: number
    googleConfirmations: number
    expiredInvites: number
    secretEmails: number
    scrubbedEmails: number
    stripeEvents: number
    deletionCodes: number
    closedWorkspaces: number
}

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS)

export async function runDataRetention(now = new Date()): Promise<RetentionResult> {
    const signatureCodes = await prisma.signatureCode.deleteMany({ where: { createdAt: { lt: daysAgo(now, RETENTION_DAYS.signatureCodes) } } })
    const googleConfirmations = await prisma.googleSignupConfirmation.deleteMany({
        where: { expiresAt: { lt: daysAgo(now, RETENTION_DAYS.googleConfirmations) } }
    })
    const expiredInvites = await prisma.workspaceInvite.deleteMany({
        where: { acceptedAt: null, expiresAt: { lt: daysAgo(now, RETENTION_DAYS.expiredInvites) } }
    })

    let secretEmails = 0
    for (const [template, days] of Object.entries(SECRET_EMAIL_DAYS)) {
        const removed = await prisma.emailOutbox.deleteMany({ where: { template, createdAt: { lt: daysAgo(now, days) } } })
        secretEmails += removed.count
    }

    // Os demais e-mails ficam como linha vazia: a chave anti-duplicidade continua valendo
    // (ex.: o aviso "cliente abriu a proposta" sai uma vez só, mesmo que ele volte meses depois).
    const scrubbedEmails = await prisma.$executeRaw`
        UPDATE "EmailOutbox"
        SET "to" = '', "payload" = '{}'::jsonb, "lastError" = NULL
        WHERE "status" <> 'PENDING'
          AND "createdAt" < ${daysAgo(now, RETENTION_DAYS.emails)}
          AND "template" <> ALL(${Object.keys(SECRET_EMAIL_DAYS)}::text[])
          AND ("to" <> '' OR "payload" <> '{}'::jsonb OR "lastError" IS NOT NULL)`

    const stripeEvents = await prisma.stripeEventLog.deleteMany({ where: { receivedAt: { lt: daysAgo(now, RETENTION_DAYS.stripeEvents) } } })

    const deletionCodes = await prisma.accountDeletionCode.deleteMany({ where: { createdAt: { lt: daysAgo(now, RETENTION_DAYS.deletionCodes) } } })
    // Apaga a empresa encerrada inteira (perfil, propostas, aceites e assinaturas vão junto).
    const closedWorkspaces = await prisma.workspace.deleteMany({ where: { closedAt: { lt: daysAgo(now, RETENTION_DAYS.closedWorkspaces) } } })

    return {
        signatureCodes: signatureCodes.count,
        googleConfirmations: googleConfirmations.count,
        expiredInvites: expiredInvites.count,
        secretEmails,
        scrubbedEmails,
        stripeEvents: stripeEvents.count,
        deletionCodes: deletionCodes.count,
        closedWorkspaces: closedWorkspaces.count
    }
}
