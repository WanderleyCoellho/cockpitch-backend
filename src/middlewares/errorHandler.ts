import type { NextFunction, Request, Response } from 'express'

export interface ApiError extends Error {
    statusCode?: number
    details?: any
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
    const isDevelopment = process.env.NODE_ENV === 'development'

    let message = 'Internal server error'
    let statusCode = 500
    let details: any = undefined

    if (err instanceof Error) {
        message = err.message
        if ('statusCode' in err && typeof (err as any).statusCode === 'number') {
            statusCode = (err as any).statusCode
        }
        if (isDevelopment && 'details' in err) {
            details = (err as any).details
        }
    }

    // Handle JSON parsing errors
    if (err instanceof SyntaxError && 'body' in err) {
        statusCode = 400
        message = 'Invalid JSON'
    }

    console.error('[api:error]', {
        statusCode,
        message,
        path: req.path,
        method: req.method,
        stack: isDevelopment ? (err instanceof Error ? err.stack : undefined) : undefined
    })

    res.status(statusCode).json({
        message,
        ...(isDevelopment && details && { details })
    })
}

export function notFoundHandler(req: Request, res: Response) {
    res.status(404).json({
        message: `Route ${req.method} ${req.path} not found`
    })
}
