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

/**
 * Respostas do cliente (aceite/ajuste/recusa): 10 por hora por IP e por proposta.
 * Errar o código de assinatura também conta; o próprio código já limita a 5 tentativas.
 */
export const proposalResponseRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message,
    keyGenerator: (req) => `${req.ip}:${req.params.slug ?? ''}`
})

/** Códigos de assinatura por e-mail: 10 por hora por IP e por proposta (o serviço ainda limita por e-mail). */
export const signatureCodeRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message,
    keyGenerator: (req) => `${req.ip}:${req.params.slug ?? req.params.id ?? ''}`
})
