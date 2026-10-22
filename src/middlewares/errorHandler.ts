import type { NextFunction, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { HttpError } from '../lib/httpError.js'

type ErrorResponse = { statusCode: number; message: string; code?: string }

function resolveError(err: unknown): ErrorResponse {
    if (err instanceof HttpError) {
        return { statusCode: err.statusCode, message: err.message, code: err.code }
    }

    // Erros conhecidos do Prisma viram respostas HTTP previsíveis em vez de 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
            const target = Array.isArray(err.meta?.target) ? (err.meta?.target as string[]).join(', ') : 'campo único'
            return { statusCode: 409, message: `Já existe um registro com este valor (${target}).`, code: 'CONFLICT' }
        }
        if (err.code === 'P2025') {
            return { statusCode: 404, message: 'Registro não encontrado.', code: 'NOT_FOUND' }
        }
        if (err.code === 'P2003') {
            return { statusCode: 400, message: 'Referência inválida.', code: 'INVALID_REFERENCE' }
        }
    }

    // JSON malformado no body (body-parser) ou payload grande demais.
    if (err && typeof err === 'object' && 'type' in err) {
        const type = (err as { type?: string }).type
        if (type === 'entity.parse.failed') return { statusCode: 400, message: 'Invalid JSON' }
        if (type === 'entity.too.large') return { statusCode: 413, message: 'Payload too large' }
    }

    return { statusCode: 500, message: 'Internal server error' }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
    const { statusCode, message, code } = resolveError(err)

    if (statusCode >= 500) {
        console.error('[api:error]', {
            method: req.method,
            path: req.path,
            error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err
        })
    }

    if (res.headersSent) return

    // Nunca expõe detalhes internos em erros 5xx.
    res.status(statusCode).json(code ? { message, code } : { message })
}

export function notFoundHandler(req: Request, res: Response) {
    res.status(404).json({
        message: `Route ${req.method} ${req.path} not found`
    })
}
