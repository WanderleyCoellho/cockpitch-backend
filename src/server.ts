import { app } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import { startBillingReconciliationJob } from './jobs/billingReconciliation.job.js'
import { startEmailOutboxJob } from './jobs/emailOutbox.job.js'

// Rede de segurança: uma promise rejeitada fora do ciclo de requisição não derruba a API inteira.
process.on('unhandledRejection', (reason) => {
    console.error('[process] unhandledRejection', reason)
})

const server = app.listen(env.PORT, () => {
    console.log(`[api] lumen-deal-api running on port ${env.PORT}`)
    startBillingReconciliationJob()
    startEmailOutboxJob()
})

// Encerramento gracioso: o Railway envia SIGTERM no deploy; termina as requisições em andamento.
function shutdown(signal: string) {
    console.log(`[api] ${signal} received, shutting down`)
    server.close(() => {
        prisma
            .$disconnect()
            .catch(() => undefined)
            .finally(() => process.exit(0))
    })
    setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
