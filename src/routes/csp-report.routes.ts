import express, { Router } from 'express'
import { env } from '../config/env.js'
import { cspReportRateLimit } from '../middlewares/rateLimit.js'

/**
 * Recebe as violações de CSP que os navegadores enviam (diretiva report-uri do frontend e do Ops)
 * e registra uma linha no log. É o único jeito de saber se a política bloqueou algo para um usuário real.
 *
 * Qualquer um pode chamar esta rota, então ela nunca confia no conteúdo: só registra relatórios
 * de páginas nossas, corta query string e mascara tokens do caminho. Responde sempre 204.
 */
export const cspReportRouter = Router()

const ourOrigins = new Set(
    [env.FRONTEND_URL, env.OPS_FRONTEND_URL, ...env.CORS_EXTRA_ORIGINS.split(',').map((origin) => origin.trim())]
        .filter(Boolean)
        .map((url) => safeOrigin(url))
        .filter(Boolean)
)

// Extensões do navegador geram violações que não dependem de nós.
const EXTENSION_SCHEMES = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/i

// Rotas cujo segundo trecho do caminho é um segredo (link de proposta, convite, confirmação de conta).
const TOKEN_PATH = /^\/(p|convite|confirmar-conta)\/[^/]+/

function safeOrigin(value: string) {
    try {
        return new URL(value).origin
    } catch {
        return ''
    }
}

function text(value: unknown) {
    return typeof value === 'string' ? value.slice(0, 500) : ''
}

/** URL sem query, sem fragmento e sem tokens no caminho. Palavras-chave como "inline" e "eval" passam como estão. */
function scrubUrl(value: string) {
    if (!value) return ''
    try {
        const url = new URL(value)
        if (url.protocol === 'data:' || url.protocol === 'blob:') return url.protocol.slice(0, -1)
        return (url.origin + url.pathname.replace(TOKEN_PATH, '/$1/:token')).slice(0, 200)
    } catch {
        return /^[a-z-]{1,20}$/i.test(value) ? value : 'invalid'
    }
}

cspReportRouter.post(
    '/',
    cspReportRateLimit,
    express.json({ type: ['application/csp-report', 'application/json'], limit: '16kb' }),
    (req, res) => {
        const report = req.body?.['csp-report']
        if (report && typeof report === 'object') {
            const page = text(report['document-uri'])
            const blocked = text(report['blocked-uri'])
            const source = text(report['source-file'])
            const fromExtension = EXTENSION_SCHEMES.test(blocked) || EXTENSION_SCHEMES.test(source)

            if (ourOrigins.has(safeOrigin(page)) && !fromExtension) {
                const line = {
                    directive: text(report['effective-directive'] || report['violated-directive']).slice(0, 60),
                    blocked: scrubUrl(blocked),
                    page: scrubUrl(page),
                    source: scrubUrl(source) || undefined,
                    line: Number.isInteger(report['line-number']) ? report['line-number'] : undefined,
                    disposition: text(report.disposition).slice(0, 10) || undefined,
                }
                console.warn(`[csp-violation] ${JSON.stringify(line)}`)
            }
        }
        res.status(204).end()
    }
)
