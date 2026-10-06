import type { Prisma } from '@prisma/client'
import { env } from '../../config/env.js'
import { getMailer } from '../../lib/mailer/index.js'
import { prisma } from '../../lib/prisma.js'
import { renderEmail, type EmailTemplates, type TemplateName } from './templates.js'

type Db = typeof prisma | Prisma.TransactionClient

export type QueuedEmail<T extends TemplateName = TemplateName> = {
    to: string
    template: T
    payload: EmailTemplates[T]
    /** Um e-mail por evento e destinatário (ex.: `opened:<proposalId>:<userId>`). */
    dedupeKey: string
    replyTo?: string | null
}

/** Minutos de espera depois da 1ª, 2ª, 3ª e 4ª falha; a 5ª falha encerra (FAILED). */
const BACKOFF_MINUTES = [1, 5, 15, 60]
export const MAX_ATTEMPTS = 5
/** Enquanto um lote é enviado, as linhas ficam "reservadas" por este tempo (protege contra envio duplo). */
const LEASE_MINUTES = 5
const BATCH_SIZE = 50

/**
 * Grava na fila (use o mesmo `tx` do evento: se o evento não for salvo, o e-mail também não é).
 * Duplicatas pelo `dedupeKey` são ignoradas em silêncio.
 */
export async function enqueueEmails(db: Db, emails: QueuedEmail[]) {
    if (emails.length === 0) return 0
    const result = await db.emailOutbox.createMany({
        data: emails.map((email) => ({
            to: email.to.trim().toLowerCase(),
            template: email.template,
            payload: { ...email.payload, ...(email.replyTo ? { _replyTo: email.replyTo } : {}) } as Prisma.InputJsonValue,
            dedupeKey: email.dedupeKey
        })),
        skipDuplicates: true
    })
    return result.count
}

let kickTimer: NodeJS.Timeout | null = null

/** Depois de enfileirar, envia em ~1 s em vez de esperar o próximo minuto do job. */
export function kickEmailDispatch() {
    if (!env.EMAIL_JOB_ENABLED || kickTimer) return
    kickTimer = setTimeout(() => {
        kickTimer = null
        dispatchEmailOutbox().catch((error) => console.error('[email] falha ao despachar', error))
    }, 1000)
    kickTimer.unref()
}

type ClaimedRow = { id: string; to: string; template: string; payload: Record<string, unknown>; attempts: number }

export async function dispatchEmailOutbox(now = new Date()) {
    const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * 60_000)
    // Reserva atômica: duas instâncias da API nunca pegam o mesmo e-mail.
    const rows = await prisma.$queryRaw<ClaimedRow[]>`
        UPDATE "EmailOutbox" SET "nextAttemptAt" = ${leaseUntil}
        WHERE "id" IN (
            SELECT "id" FROM "EmailOutbox"
            WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
            ORDER BY "createdAt"
            LIMIT ${BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "to", "template", "payload", "attempts"`

    const result = { sent: 0, retried: 0, failed: 0 }
    const mailer = getMailer()
    for (const row of rows) {
        try {
            const { _replyTo, ...data } = row.payload as Record<string, unknown> & { _replyTo?: string }
            const rendered = renderEmail(row.template as TemplateName, data as never)
            await mailer.send({ to: row.to, ...rendered, replyTo: _replyTo })
            await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), attempts: row.attempts + 1, lastError: null } })
            result.sent += 1
        } catch (error) {
            const attempts = row.attempts + 1
            const exhausted = attempts >= MAX_ATTEMPTS
            await prisma.emailOutbox.update({
                where: { id: row.id },
                data: {
                    attempts,
                    status: exhausted ? 'FAILED' : 'PENDING',
                    nextAttemptAt: new Date(now.getTime() + (BACKOFF_MINUTES[attempts - 1] ?? 60) * 60_000),
                    lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1000)
                }
            })
            if (exhausted) result.failed += 1
            else result.retried += 1
            console.error(`[email] falha ao enviar ${row.template} (tentativa ${attempts})`, error instanceof Error ? error.message : error)
        }
    }
    return result
}
