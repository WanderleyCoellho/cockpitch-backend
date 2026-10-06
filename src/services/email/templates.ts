/**
 * Modelos de e-mail (pt-BR). Tudo que vem de usuário é escapado; o payload é gravado na fila no momento
 * do evento, então o e-mail reflete o que aconteceu naquele instante.
 */

type Brand = { companyName: string; brandColor?: string | null }

export type EmailTemplates = {
    proposal_opened: Brand & { clientName: string; proposalUrl: string; panelUrl: string; openedAt: string }
    proposal_response: Brand & {
        type: 'ACCEPTED' | 'DECLINED' | 'CHANGE_REQUESTED'
        clientName: string
        signerName: string
        signerEmail: string
        signerDocument?: string | null
        message?: string | null
        packageName?: string | null
        optionals?: string[]
        totalCents?: number | null
        panelUrl: string
        proposalUrl: string
        at: string
    }
    acceptance_confirmation: Brand & {
        clientName: string
        signerName: string
        packageName?: string | null
        optionals?: string[]
        totalCents?: number | null
        proposalUrl: string
        at: string
        hash: string
        companyEmail?: string | null
        companyWhatsapp?: string | null
    }
    team_invite: Brand & { inviterName?: string | null; role: 'OWNER' | 'ADMIN' | 'MEMBER'; inviteUrl: string; expiresAt: string }
}

export type TemplateName = keyof EmailTemplates

export type RenderedEmail = { subject: string; html: string; text: string }

const DEFAULT_COLOR = '#B8943C'

function esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function safeColor(color?: string | null) {
    return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_COLOR
}

function safeUrl(url: string) {
    return /^https?:\/\//i.test(url) ? url : '#'
}

export function formatCents(cents: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDateTime(iso: string) {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long', timeStyle: 'short' })
}

function layout(brand: Brand, body: string, cta?: { label: string; url: string }) {
    const color = safeColor(brand.brandColor)
    const button = cta
        ? `<tr><td style="padding:8px 32px 28px"><a href="${esc(safeUrl(cta.url))}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px">${esc(cta.label)}</a></td></tr>`
        : ''
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e3dc">
<tr><td style="height:4px;background:${color}"></td></tr>
<tr><td style="padding:24px 32px 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${color};font-weight:700">${esc(brand.companyName)}</td></tr>
<tr><td style="padding:8px 32px 16px;font-size:15px;line-height:1.6">${body}</td></tr>
${button}
</table>
<p style="max-width:560px;margin:14px auto 0;text-align:center;font-size:11px;color:#8a857c">Enviado pelo Lumen Deal · Para mudar os avisos que você recebe, acesse Equipe no painel.</p>
</body></html>`
}

function summaryRows(p: { packageName?: string | null; optionals?: string[]; totalCents?: number | null }) {
    const rows: string[] = []
    if (p.packageName) rows.push(`<strong>Pacote:</strong> ${esc(p.packageName)}`)
    if (p.optionals?.length) rows.push(`<strong>Opcionais:</strong> ${esc(p.optionals.join(', '))}`)
    if (p.totalCents != null) rows.push(`<strong>Total:</strong> ${esc(formatCents(p.totalCents))}`)
    return rows
}

function summaryText(p: { packageName?: string | null; optionals?: string[]; totalCents?: number | null }) {
    return [
        p.packageName ? `Pacote: ${p.packageName}` : null,
        p.optionals?.length ? `Opcionais: ${p.optionals.join(', ')}` : null,
        p.totalCents != null ? `Total: ${formatCents(p.totalCents)}` : null
    ].filter(Boolean) as string[]
}

const RESPONSE_COPY = {
    ACCEPTED: { subject: (c: string) => `🎉 ${c} aceitou a proposta`, title: 'aceitou a proposta' },
    CHANGE_REQUESTED: { subject: (c: string) => `${c} pediu um ajuste na proposta`, title: 'pediu um ajuste na proposta' },
    DECLINED: { subject: (c: string) => `${c} recusou a proposta`, title: 'recusou a proposta' }
} as const

const ROLE_LABEL = { OWNER: 'dono', ADMIN: 'administrador', MEMBER: 'membro' } as const

export function renderEmail<T extends TemplateName>(template: T, payload: EmailTemplates[T]): RenderedEmail {
    switch (template) {
        case 'proposal_opened': {
            const p = payload as EmailTemplates['proposal_opened']
            const when = formatDateTime(p.openedAt)
            return {
                subject: `${p.clientName} abriu a proposta`,
                html: layout(
                    p,
                    `<p style="margin:0 0 12px"><strong>${esc(p.clientName)}</strong> abriu a proposta pela primeira vez em ${esc(when)}.</p>
                     <p style="margin:0;color:#5c5850">Bom momento para um contato: a proposta está fresca na cabeça do cliente.</p>`,
                    { label: 'Ver no painel', url: p.panelUrl }
                ),
                text: `${p.clientName} abriu a proposta pela primeira vez em ${when}.\n\nVer no painel: ${p.panelUrl}`
            }
        }
        case 'proposal_response': {
            const p = payload as EmailTemplates['proposal_response']
            const copy = RESPONSE_COPY[p.type]
            const who = `${p.signerName} (${p.signerEmail})`
            const rows = summaryRows(p)
            const html = layout(
                p,
                `<p style="margin:0 0 12px"><strong>${esc(p.signerName)}</strong> ${copy.title} <strong>${esc(p.clientName)}</strong>.</p>
                 ${p.message ? `<p style="margin:0 0 12px;padding:10px 14px;background:#f6f4f0;border-left:3px solid ${safeColor(p.brandColor)};white-space:pre-line">${esc(p.message)}</p>` : ''}
                 ${rows.length ? `<p style="margin:0 0 12px">${rows.join('<br>')}</p>` : ''}
                 <p style="margin:0;color:#5c5850;font-size:13px">Contato: ${esc(p.signerEmail)}${p.signerDocument ? ` · ${esc(p.signerDocument)}` : ''}<br>Em ${esc(formatDateTime(p.at))}</p>`,
                { label: 'Ver resposta no painel', url: p.panelUrl }
            )
            return {
                subject: copy.subject(p.clientName),
                html,
                text: [
                    `${who} ${copy.title} ${p.clientName}.`,
                    p.message ? `\nMensagem: ${p.message}` : '',
                    ...summaryText(p),
                    `\nVer no painel: ${p.panelUrl}`
                ]
                    .filter(Boolean)
                    .join('\n')
            }
        }
        case 'acceptance_confirmation': {
            const p = payload as EmailTemplates['acceptance_confirmation']
            const rows = summaryRows(p)
            const contact = [p.companyEmail, p.companyWhatsapp ? `WhatsApp ${p.companyWhatsapp}` : null].filter(Boolean).join(' · ')
            return {
                subject: `Proposta aceita — ${p.companyName}`,
                html: layout(
                    p,
                    `<p style="margin:0 0 12px">Olá, ${esc(p.signerName.split(' ')[0])}! Recebemos o seu aceite da proposta para <strong>${esc(p.clientName)}</strong>.</p>
                     ${rows.length ? `<p style="margin:0 0 12px">${rows.join('<br>')}</p>` : ''}
                     <p style="margin:0 0 12px">A ${esc(p.companyName)} vai entrar em contato com os próximos passos.${contact ? ` Se precisar, fale com a empresa: ${esc(contact)}.` : ''}</p>
                     <p style="margin:0;color:#8a857c;font-size:12px">Aceite registrado em ${esc(formatDateTime(p.at))}. Código de verificação: ${esc(p.hash.slice(0, 16))}</p>`,
                    { label: 'Ver a proposta', url: p.proposalUrl }
                ),
                text: [
                    `Olá, ${p.signerName}! Recebemos o seu aceite da proposta para ${p.clientName}.`,
                    ...summaryText(p),
                    `A ${p.companyName} vai entrar em contato com os próximos passos.${contact ? ` Contato: ${contact}.` : ''}`,
                    `Aceite registrado em ${formatDateTime(p.at)}. Código de verificação: ${p.hash.slice(0, 16)}`,
                    `Ver a proposta: ${p.proposalUrl}`
                ].join('\n')
            }
        }
        case 'team_invite': {
            const p = payload as EmailTemplates['team_invite']
            const until = new Date(p.expiresAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long' })
            const by = p.inviterName ? `${p.inviterName} convidou você` : 'Você foi convidado'
            return {
                subject: `Convite para a equipe ${p.companyName} no Lumen Deal`,
                html: layout(
                    p,
                    `<p style="margin:0 0 12px">${esc(by)} para entrar na equipe <strong>${esc(p.companyName)}</strong> como ${esc(ROLE_LABEL[p.role])}.</p>
                     <p style="margin:0;color:#5c5850">O convite vale até ${esc(until)}. Você pode entrar com e-mail e senha ou com sua conta Google.</p>`,
                    { label: 'Aceitar convite', url: p.inviteUrl }
                ),
                text: `${by} para entrar na equipe ${p.companyName} como ${ROLE_LABEL[p.role]}.\nAceite até ${until}: ${p.inviteUrl}`
            }
        }
    }
    throw new Error(`Template de e-mail desconhecido: ${String(template)}`)
}
