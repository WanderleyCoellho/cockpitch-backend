import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import path from 'path'
import { stripeWebhookRouter } from './routes/stripe-webhook.routes.js'
import { apiRouter } from './routes/index.js'
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js'
import { env } from './config/env.js'

export const app = express()

app.use(
    helmet({
        // Permite que vídeos/imagens servidos de outra origem (ex.: :3001 -> :5173) sejam carregados no navegador.
        crossOriginResourcePolicy: false,
    })
)
const allowedOrigins = new Set([
    env.FRONTEND_URL,
    env.OPS_FRONTEND_URL,
    'http://localhost:5173',
    'http://localhost:5174'
])
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.has(origin)) {
                callback(null, true)
                return
            }
            callback(new Error('Not allowed by CORS'))
        },
        credentials: true
    })
)
app.use('/webhooks/stripe', stripeWebhookRouter)
app.use(
    '/uploads',
    express.static(path.resolve(process.cwd(), 'uploads'), {
        setHeaders: (res) => {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
            res.setHeader('Access-Control-Allow-Origin', '*')
        },
    })
)
app.use(express.json())

app.use('/api', apiRouter)

app.use(notFoundHandler)
app.use(errorHandler)
