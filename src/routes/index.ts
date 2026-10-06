import { Router } from 'express'
import { authRouter } from './auth.routes.js'
import { healthRouter } from './health.routes.js'
import { providerRouter } from './provider.routes.js'
import { packageRouter } from './package.routes.js'
import { packageItemRouter } from './package-item.routes.js'
import { proposalRouter } from './proposal.routes.js'
import { proposalPublicRouter } from './proposal-public.routes.js'
import { proposalViewRouter } from './proposal-view.routes.js'
import { stripeRouter } from './stripe.routes.js'
import { uploadRouter } from './upload.routes.js'
import { internalRouter } from './internal.routes.js'
import { opsRouter } from './ops.routes.js'
import { paymentReceiptRouter } from './payment-receipt.routes.js'
import { opsAuthRouter } from './ops-auth.routes.js'
import { workspaceRouter } from './workspace.routes.js'
import { inviteRouter } from './invite.routes.js'
import { templateRouter } from './template.routes.js'

export const apiRouter = Router()

apiRouter.use('/auth', authRouter)
apiRouter.use('/ops-auth', opsAuthRouter)
apiRouter.use('/workspaces', workspaceRouter)
apiRouter.use('/invites', inviteRouter)
apiRouter.use('/templates', templateRouter)
apiRouter.use('/providers', providerRouter)
apiRouter.use('/packages', packageRouter)
apiRouter.use('/package-items', packageItemRouter)
apiRouter.use('/proposals', proposalRouter)
apiRouter.use('/public', proposalPublicRouter)
apiRouter.use('/proposal-views', proposalViewRouter)
apiRouter.use(uploadRouter)
apiRouter.use('/payment-receipts', paymentReceiptRouter)
apiRouter.use(healthRouter)
apiRouter.use(stripeRouter)
apiRouter.use('/internal/ops', opsRouter)
apiRouter.use('/internal', internalRouter)
