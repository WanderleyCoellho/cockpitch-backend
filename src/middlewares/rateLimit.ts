import { rateLimit } from 'express-rate-limit'

const message = { message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', code: 'RATE_LIMITED' }

function build(windowMs: number, limit: number) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message,
        // Em testes o limitador é mantido, mas cada instância tem seu próprio store em memória.
    })
}

/** Login/registro: alvo clássico de força bruta e criação de conta em massa. */
export const authRateLimit = build(15 * 60 * 1000, 10)

/** Endpoints públicos sem autenticação (visualizações, respostas de proposta). */
export const publicWriteRateLimit = build(60 * 1000, 30)

/** Uploads autenticados: protege disco/banda contra loop de cliente. */
export const uploadRateLimit = build(60 * 1000, 30)

/** Respostas do cliente (aceite/ajuste/recusa): 5 por hora por IP e por proposta. */
export const proposalResponseRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message,
    keyGenerator: (req) => `${req.ip}:${req.params.slug ?? ''}`
})
