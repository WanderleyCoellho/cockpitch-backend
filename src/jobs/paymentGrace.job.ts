import cron from 'node-cron'
import { stripeMode } from '../lib/stripe.js'
import { enforcePaymentGrace } from '../services/payment-grace.service.js'

let running = false

/** De hora em hora: cancela a assinatura de quem recebeu a empresa e não regularizou o pagamento no prazo. */
export function startPaymentGraceJob() {
    if (stripeMode() === 'unconfigured') return
    cron.schedule('20 * * * *', async () => {
        if (running) return
        running = true
        try {
            const result = await enforcePaymentGrace()
            if (result.checked) console.log('[cobranca] prazo do novo dono', result)
        } catch (error) {
            console.error('[cobranca] erro no job de prazo', error)
        } finally {
            running = false
        }
    })
}
