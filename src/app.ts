import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import path from 'path'
import { stripeWebhookRouter } from './routes/stripe-webhook.routes.js'
import { apiRouter } from './routes/index.js'
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js'
import { env } from './config/env.js'

export const app = express()

// Atrás do proxy do Railway: sem isso req.ip seria o IP do proxy (rate limit global para todos)
// e req.protocol seria "http" (URLs de upload com conteúdo misto em páginas https).
app.set('trust proxy', env.TRUST_PROXY)
app.disable('x-powered-by')

app.use(
    helmet({
        // Permite que vídeos/imagens servidos de outra origem (ex.: :3001 -> :5173) sejam carregados no navegador.
        crossOriginResourcePolicy: false,
    })
)

const allowedOrigins = new Set(
    [
        env.FRONTEND_URL,
        env.OPS_FRONTEND_URL,
        ...env.CORS_EXTRA_ORIGINS.split(',').map((origin) => origin.trim()),
        ...(env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://localhost:5174'])
    ].filter(Boolean)
)
app.use(
    cors({
        origin: (origin, callback) => {
            // Origem não autorizada: responde sem cabeçalhos CORS (o navegador bloqueia) em vez de gerar erro 500.
            callback(null, !origin || allowedOrigins.has(origin))
        },
        credentials: true
    })
)

// O webhook precisa do body bruto para validar a assinatura: registrado antes do express.json().
app.use('/webhooks/stripe', stripeWebhookRouter)

// Comprovantes antigos ficavam em uploads/receipts: nunca devem ser servidos publicamente.
app.use('/uploads/receipts', (_req, res) => {
    res.status(404).json({ message: 'Not found' })
})
app.use(
    '/uploads',
    express.static(path.resolve(process.cwd(), 'uploads'), {
        dotfiles: 'deny',
        index: false,
        maxAge: '7d',
        setHeaders: (res) => {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('X-Content-Type-Options', 'nosniff')
        },
    })
)
app.use(express.json({ limit: '1mb' }))

app.use('/api', apiRouter)

app.use(notFoundHandler)
app.use(errorHandler)
