import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { formatCpf } from '../lib/cpf.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
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

