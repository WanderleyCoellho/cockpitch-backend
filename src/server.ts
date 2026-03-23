import { app } from './app.js'
import { env } from './config/env.js'
import { startBillingReconciliationJob } from './jobs/billingReconciliation.job.js'

app.listen(env.PORT, () => {
    console.log(`[api] cockpitch-backend running on port ${env.PORT}`)
    startBillingReconciliationJob()
})
