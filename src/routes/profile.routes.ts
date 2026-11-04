import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { formatCpf } from '../lib/cpf.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { accountActionRateLimit } from '../middlewares/rateLimit.js'
import { deleteAccount, deleteAccountSchema, describeAccountDeletion, requestAccountDeletionCode } from '../services/account-deletion.service.js'
import { exportUserData } from '../services/data-export.service.js'
import { cpfSchema, signatureDrawingSchema } from '../services/signature.service.js'

/** Perfil de quem usa o painel: assinatura e CPF salvos para assinar propostas mais rápido. */
export const profileRouter = Router()

profileRouter.use(requireAuth)

const saveSchema = z.object({
    cpf: cpfSchema,
    signerTitle: z.string().trim().max(80).optional(),
    signature: signatureDrawingSchema
})

profileRouter.get('/signature', async (req: AuthenticatedRequest, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { name: true, email: true, cpf: true, savedSignature: true } })
    return res.json({ name: user.name, email: user.email, cpf: user.cpf ? formatCpf(user.cpf) : null, signature: user.savedSignature ?? null })
})

profileRouter.put('/signature', async (req: AuthenticatedRequest, res) => {
    const parsed = saveSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Dados inválidos', issues: parsed.error.issues })
    }
    const { signature, signerTitle, cpf } = parsed.data
    const saved = { method: signature.method, image: signature.method === 'DRAWN' ? signature.image : null, typedText: signature.method === 'TYPED' ? signature.typedText : null, signerTitle: signerTitle || null }
    await prisma.user.update({ where: { id: req.auth!.userId }, data: { cpf, savedSignature: saved as Prisma.InputJsonValue } })
    return res.json({ cpf: formatCpf(cpf), signature: saved })
})

profileRouter.delete('/signature', async (req: AuthenticatedRequest, res) => {
    await prisma.user.update({ where: { id: req.auth!.userId }, data: { savedSignature: Prisma.DbNull, cpf: null } })
    return res.status(204).send()
})

/** Baixar meus dados (LGPD): JSON com os dados pessoais da conta. */
profileRouter.get('/export', accountActionRateLimit, async (req: AuthenticatedRequest, res) => {
    const data = await exportUserData(req.auth!.userId)
    const day = new Date().toISOString().slice(0, 10)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `attachment; filename="lumen-deal-meus-dados-${day}.json"`)
    return res.json(data)
})

/** Excluir minha conta: o que precisa ser decidido antes (empresas de que a pessoa é dona). */
profileRouter.get('/deletion', async (req: AuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store')
    return res.json(await describeAccountDeletion(req.auth!.userId))
})

profileRouter.post('/deletion/code', accountActionRateLimit, async (req: AuthenticatedRequest, res) => {
    return res.json(await requestAccountDeletionCode(req.auth!.userId))
})

profileRouter.delete('/', accountActionRateLimit, async (req: AuthenticatedRequest, res) => {
    const parsed = deleteAccountSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Dados inválidos', issues: parsed.error.issues })
    }
    await deleteAccount(req.auth!.userId, parsed.data)
    return res.status(204).send()
})

