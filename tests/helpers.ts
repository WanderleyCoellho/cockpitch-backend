import bcrypt from 'bcryptjs'
import type { PlanTier, BillingStatus, LicensePolicy, WorkspaceRole } from '@prisma/client'
import { prisma } from '../src/lib/prisma.js'
import { signAccessToken } from '../src/lib/jwt.js'
import { createWorkspaceWithOwner } from '../src/services/workspace.service.js'

export async function resetDatabase() {
    await prisma.$executeRawUnsafe(
        'TRUNCATE "ProposalView", "Proposal", "ProposalTemplate", "PackageItem", "Package", "Provider", "PaymentReceipt", "WorkspaceInvite", "WorkspaceMember", "Workspace", "User" RESTART IDENTITY CASCADE'
    )
}

let counter = 0

function nextEmail() {
    counter += 1
    return `user${counter}-${Date.now()}@test.local`
}

/** Cria usuário + workspace (dono) + perfil público, direto no banco (sem passar pelo rate limit de /auth). */
export async function createUser(
    name = 'Usuário Teste',
    plan: { planTier?: PlanTier; billingStatus?: BillingStatus; licensePolicy?: LicensePolicy } = {
        planTier: 'PRO',
        billingStatus: 'ACTIVE'
    }
) {
    const email = nextEmail()
    const { user, workspace } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
            data: { name, email, passwordHash: await bcrypt.hash('password123', 4) }
        })
        const workspace = await createWorkspaceWithOwner(tx, {
            userId: user.id,
            ownerName: name,
            ownerEmail: email,
            workspaceName: `${name} Ltda`,
            segment: 'GENERAL'
        })
        await tx.workspace.update({ where: { id: workspace.id }, data: plan })
        return { user, workspace }
    })
    const token = signAccessToken({ userId: user.id, role: user.role })
    return { user, workspace, provider: workspace.providers[0], token, email, auth: `Bearer ${token}` }
}

/** Cria um usuário que entra como membro (sem workspace próprio) num workspace existente. */
export async function addMember(workspaceId: string, role: WorkspaceRole = 'MEMBER', name = 'Membro') {
    const email = nextEmail()
    const user = await prisma.user.create({
        data: {
            name,
            email,
            passwordHash: await bcrypt.hash('password123', 4),
            memberships: { create: { workspaceId, role } }
        }
    })
    const token = signAccessToken({ userId: user.id, role: user.role })
    const member = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } })
    return { user, member, email, auth: `Bearer ${token}` }
}

export async function createPackage(providerId: string, name = 'Pacote') {
    return prisma.package.create({ data: { providerId, name, price: 'R$ 1.000' } })
}
