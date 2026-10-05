import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { signAccessToken } from '../lib/jwt.js'
import { HttpError } from '../lib/httpError.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { authRateLimit } from '../middlewares/rateLimit.js'
import { acceptInvite, createWorkspaceWithOwner, findValidInvite, listUserWorkspaces } from '../services/workspace.service.js'

const segmentSchema = z.enum([
    'PHOTO_VIDEO', 'EVENTS', 'AGENCY', 'CONSULTING', 'HEALTH_BEAUTY', 'CONSTRUCTION', 'EDUCATION', 'TECH', 'GENERAL'
])

const registerSchema = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().email(),
    password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres').max(128),
    /** Nome da empresa/negócio. Se ausente, usa o nome da pessoa. */
    workspaceName: z.string().trim().min(2).max(120).optional(),
    segment: segmentSchema.default('GENERAL'),
    /** Cadastro a partir de um convite de equipe: entra no workspace de quem convidou. */
    inviteToken: z.string().min(20).max(200).optional()
})

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(128)
})

export const authRouter = Router()

// Hash real usado quando o e-mail não existe: o login leva o mesmo tempo nos dois casos.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('lumen-deal-dummy-password', 12)

/**
 * Sessão do usuário. Os campos planTier/billingStatus/licensePolicy/providerId refletem o workspace
 * principal (o mais antigo) para manter compatibilidade com clientes que ainda não usam `workspaces`.
 */
async function buildSessionUser(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return null
    const workspaces = await listUserWorkspaces(userId)
    const primary = workspaces[0]
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        planTier: primary?.planTier ?? 'FREE',
        billingStatus: primary?.billingStatus ?? 'INACTIVE',
        licensePolicy: primary?.licensePolicy ?? 'STANDARD',
        licensePolicyNote: primary?.licensePolicyNote ?? null,
        providerId: primary?.providerId ?? null,
        activeWorkspaceId: primary?.id ?? null,
        workspaces
    }
}

authRouter.post('/register', authRateLimit, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const { name, email, password, workspaceName, segment, inviteToken } = parsed.data
    const normalizedEmail = email.trim().toLowerCase()

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) {
        return res.status(409).json({ message: 'Email already in use' })
    }

    if (inviteToken) {
        const invite = await findValidInvite(inviteToken)
        if (invite.email !== normalizedEmail) {
            throw new HttpError(403, `Este convite foi enviado para ${invite.email}. Use esse e-mail no cadastro.`, 'INVITE_EMAIL_MISMATCH')
        }
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
            data: { name, email: normalizedEmail, passwordHash, role: 'PROVIDER' }
        })
        if (inviteToken) {
            await acceptInvite(tx, inviteToken, { id: created.id, email: created.email })
        } else {
            await createWorkspaceWithOwner(tx, {
                userId: created.id,
                ownerName: name,
                ownerEmail: normalizedEmail,
                workspaceName: workspaceName ?? name,
                segment
            })
        }
        return created
    })

    const token = signAccessToken({ userId: user.id, role: user.role })
    return res.status(201).json({ token, user: await buildSessionUser(user.id) })
})

authRouter.post('/login', authRateLimit, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body)

    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase()
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

    // Mesma resposta e custo de bcrypt para e-mail inexistente (não revela quais e-mails têm conta).
    const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
    if (!user || !ok) {
        return res.status(401).json({ message: 'Invalid credentials' })
    }

    const token = signAccessToken({ userId: user.id, role: user.role })
    return res.json({ token, user: await buildSessionUser(user.id) })
})

authRouter.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const user = await buildSessionUser(req.auth.userId)
    if (!user) {
        return res.status(404).json({ message: 'User not found' })
    }

    return res.json({ user })
})
