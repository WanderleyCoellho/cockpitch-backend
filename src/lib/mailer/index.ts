import { env } from '../../config/env.js'

export type OutgoingEmail = {
    to: string
    subject: string
    html: string
    text: string
    /** Respostas do destinatário vão para este endereço (ex.: e-mail da empresa). */
    replyTo?: string
}

export interface Mailer {
    readonly name: string
    send(email: OutgoingEmail): Promise<void>
}

const SEND_TIMEOUT_MS = 10_000

/** Envio pela API HTTP do Resend (sem SDK: uma chamada só, com timeout). */
export class ResendMailer implements Mailer {
    readonly name = 'resend'
    constructor(
        private readonly apiKey: string,
        private readonly from: string
    ) {}

    async send(email: OutgoingEmail) {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: this.from,
                to: [email.to],
                subject: email.subject,
                html: email.html,
                text: email.text,
                ...(email.replyTo ? { reply_to: email.replyTo } : {})
            }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
        })
        if (!response.ok) {
            const body = await response.text().catch(() => '')
            throw new Error(`Resend ${response.status}: ${body.slice(0, 300)}`)
        }
    }
}

/** Desenvolvimento sem chave: só registra no log. */
export class ConsoleMailer implements Mailer {
    readonly name = 'console'
    async send(email: OutgoingEmail) {
        console.log(`[mailer:console] para=${email.to} assunto="${email.subject}"`)
    }
}

let current: Mailer = env.RESEND_API_KEY ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : new ConsoleMailer()

export function getMailer() {
    return current
}

/** Usado nos testes para trocar o envio real por um falso. */
export function setMailer(mailer: Mailer) {
    current = mailer
}
