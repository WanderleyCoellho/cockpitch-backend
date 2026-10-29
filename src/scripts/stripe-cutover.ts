import { prisma } from '../lib/prisma.js'
import { stripeMode } from '../lib/stripe.js'
import { runStripeCutover } from '../services/stripe-cutover.service.js'

/**
 * Virada do Stripe para produção (rodar uma vez, dentro do container da API, depois de trocar as chaves):
 *   node dist/scripts/stripe-cutover.js            → só lista o que mudaria
 *   node dist/scripts/stripe-cutover.js --apply    → aplica
 * Recusa aplicar com chave de teste: com a chave errada, todo cliente real pareceria inexistente.
 */
async function main() {
    const apply = process.argv.includes('--apply')
    const mode = stripeMode()
    console.log(`[stripe-cutover] chave do Stripe: ${mode} · ${apply ? 'APLICANDO' : 'simulação (use --apply para aplicar)'}`)
    if (apply && mode !== 'live') {
        console.error('[stripe-cutover] recusado: --apply só com chave live (sk_live_/rk_live_).')
        process.exitCode = 1
        return
    }

    const rows = await runStripeCutover({ apply })
    const label = { keep: 'mantém', reset_to_free: 'volta ao Grátis', clear_ids: 'cortesia: só limpa o cliente antigo' }
    for (const row of rows) {
        console.log(`- ${row.name} (${row.workspaceId}) · ${row.planTier}/${row.billingStatus}/${row.licensePolicy} · ${row.customerId} → ${label[row.action]}`)
    }
    const changed = rows.filter((row) => row.action !== 'keep').length
    console.log(`[stripe-cutover] ${rows.length} empresas com cliente Stripe · ${changed} ${apply ? 'alteradas' : 'seriam alteradas'}`)
}

main()
    .catch((error) => {
        console.error('[stripe-cutover] falhou:', error instanceof Error ? error.message : error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
