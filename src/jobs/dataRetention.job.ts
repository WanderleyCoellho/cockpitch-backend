import cron from 'node-cron'
import { env } from '../config/env.js'
import { runDataRetention } from '../services/data-retention.service.js'

let running = false

async function runOnce() {
    if (running) return
    running = true
    try {
        const result = await runDataRetention()
        if (Object.values(result).some((count) => count > 0)) console.log('[retencao] limpeza', result)
    } catch (error) {
        console.error('[retencao] erro no job', error)
    } finally {
        running = false
    }
}

/** Limpeza diária de dados vencidos (spec de retenção, LGPD). Só apaga o que já passou do prazo: rodar duas vezes não faz mal. */
export function startDataRetentionJob() {
    if (!env.DATA_RETENTION_ENABLED) return
    cron.schedule(env.DATA_RETENTION_CRON, runOnce)
    // Também na subida: um deploy diário poderia pular o horário marcado.
    setTimeout(runOnce, 60_000).unref()
}
