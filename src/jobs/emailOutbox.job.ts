import cron from 'node-cron'
import { env } from '../config/env.js'
import { getMailer } from '../lib/mailer/index.js'
import { dispatchEmailOutbox } from '../services/email/outbox.js'

let running = false

/** Envia a fila de e-mails a cada minuto (spec email-notifications). */
export function startEmailOutboxJob() {
    if (!env.EMAIL_JOB_ENABLED) return
    console.log(`[email] fila ativa (envio: ${getMailer().name})`)
    cron.schedule('* * * * *', async () => {
        if (running) return
        running = true
        try {
            const result = await dispatchEmailOutbox()
            if (result.sent || result.retried || result.failed) console.log('[email] lote', result)
        } catch (error) {
            console.error('[email] erro no job', error)
        } finally {
            running = false
        }
    })
}
