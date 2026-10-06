import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { signAccessToken } from '../lib/jwt.js'
import { HttpError } from '../lib/httpError.js'
import { env } from '../config/env.js'
import { verifyGoogleIdToken } from '../lib/googleIdToken.js'
import { onboardingPatchSchema, updateOnboardingPrefs } from '../services/onboarding.service.js'
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

const googleSchema = z.object({
    credential: z.string().min(20).max(5000),
    /** Presentes no cadastro: sem eles e sem convite, uma conta nova não é criada (o app pede os dados). */
    workspaceName: z.string().trim().min(2).max(120).optional(),
    segment: segmentSchema.optional(),
    inviteToken: z.string().min(20).max(200).optional()
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

// Configuração pública do "Entrar com Google" (o Client ID não é segredo).
authRouter.get('/google/config', (_req, res) => {
    return res.json({ enabled: !!env.GOOGLE_CLIENT_ID, clientId: env.GOOGLE_CLIENT_ID || null })
})

/**
 * Entrar ou cadastrar com Google.
 * - Conta já vinculada (googleSub) ou com o mesmo e-mail verificado: entra (e vincula).
 * - Conta nova: precisa do nome da empresa/segmento ou de um convite; senão responde 404 com os dados
 *   do Google para o app completar o cadastro.
 */
authRouter.post('/google', authRateLimit, async (req, res) => {
    const parsed = googleSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    }
    const { credential, workspaceName, segment, inviteToken } = parsed.data
    const google = await verifyGoogleIdToken(credential)
    if (!google.emailVerified) {
        throw new HttpError(403, 'Seu e-mail do Google ainda não foi verificado.', 'GOOGLE_EMAIL_UNVERIFIED')
    }

    const invite = inviteToken ? await findValidInvite(inviteToken) : null
    if (invite && invite.email !== google.email) {
        throw new HttpError(403, `Este convite foi enviado para ${invite.email}. Entre com essa conta Google.`, 'INVITE_EMAIL_MISMATCH')
    }

    let user =
        (await prisma.user.findUnique({ where: { googleSub: google.sub } })) ??
        (await prisma.user.findUnique({ where: { email: google.email } }))

    if (user) {
        // Mesmo e-mail confirmado pelo Google: vincula a conta existente (a pessoa passa a ter os dois jeitos de entrar).
        if (user.googleSub && user.googleSub !== google.sub) {
            throw new HttpError(409, 'Este e-mail já está ligado a outra conta Google.', 'GOOGLE_ACCOUNT_CONFLICT')
        }
        if (!user.googleSub) user = await prisma.user.update({ where: { id: user.id }, data: { googleSub: google.sub } })
        if (invite) {
            const already = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
                select: { id: true }
            })
            if (!already) {
                const target = { id: user.id, email: user.email }
                await prisma.$transaction((tx) => acceptInvite(tx, inviteToken!, target))
            }
        }
        const token = signAccessToken({ userId: user.id, role: user.role })
        return res.json({ token, user: await buildSessionUser(user.id), created: false, joinedWorkspaceId: invite?.workspaceId ?? null })
    }

    if (!invite && !workspaceName) {
        return res.status(404).json({
            message: 'Não há conta com este Gmail. Conte o nome da sua empresa para criar a conta.',
            code: 'GOOGLE_ACCOUNT_NOT_FOUND',
            google: { email: google.email, name: google.name }
        })
    }

    const created = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
            data: { name: google.name, email: google.email, googleSub: google.sub, passwordHash: null, role: 'PROVIDER' }
        })
        if (invite) {
            await acceptInvite(tx, inviteToken!, { id: createdUser.id, email: createdUser.email })
        } else {
            await createWorkspaceWithOwner(tx, {
                userId: createdUser.id,
                ownerName: google.name,
                ownerEmail: google.email,
                workspaceName: workspaceName!,
                segment: segment ?? 'GENERAL'
            })
        }
        return createdUser
    })

    const token = signAccessToken({ userId: created.id, role: created.role })
    return res.status(201).json({ token, user: await buildSessionUser(created.id), created: true, joinedWorkspaceId: invite?.workspaceId ?? null })
})

// Guia de primeiros passos: marca tour visto, oculta o checklist, registra link compartilhado.
authRouter.patch('/me/onboarding', requireAuth, async (req: AuthenticatedRequest, res) => {
    const parsed = onboardingPatchSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'Invalid payload', issues: parsed.error.issues })
    return res.json({ onboarding: await updateOnboardingPrefs(req.auth!.userId, parsed.data) })
})
