import { formatCpf } from '../lib/cpf.js'
import { prisma } from '../lib/prisma.js'
import { loginMethodsOf } from './ops.service.js'

/**
 * "Baixar meus dados" (LGPD, art. 18, II e V): os dados pessoais da própria conta, em JSON.
 * Dados dos clientes das empresas não entram: a empresa é a controladora deles.
 */
export async function exportUserData(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            cpf: true,
            savedSignature: true,
            onboarding: true,
            passwordHash: true,
            googleSub: true,
            createdAt: true,
            updatedAt: true,
            memberships: {
                orderBy: { createdAt: 'asc' },
                select: {
                    role: true,
                    notifyOnOpen: true,
                    notifyOnResponse: true,
                    createdAt: true,
                    workspace: { select: { name: true, segment: true, planTier: true, billingStatus: true, createdAt: true } }
                }
            },
            paymentReceipts: { orderBy: { createdAt: 'asc' }, select: { originalFilename: true, status: true, detectedAmount: true, createdAt: true, reviewedAt: true } }
        }
    })
    const signatures = await prisma.proposalSignature.findMany({
        where: { userId, role: 'PROVIDER' },
        orderBy: { createdAt: 'asc' },
        select: {
            signerName: true,
            signerEmail: true,
            signerDocument: true,
            signerTitle: true,
            method: true,
            typedText: true,
            image: true,
            contentHash: true,
            emailVerifiedAt: true,
            ip: true,
            userAgent: true,
            createdAt: true,
            proposal: { select: { clientName: true, slug: true } }
        }
    })

    return {
        exportedAt: new Date().toISOString(),
        about:
            'Dados pessoais da sua conta no Lumen Deal (LGPD, art. 18). Propostas, pacotes e dados de clientes pertencem às empresas e são exportados por elas.',
        account: {
            id: user.id,
            name: user.name,
            email: user.email,
            cpf: user.cpf ? formatCpf(user.cpf) : null,
            loginMethods: loginMethodsOf(user),
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            savedSignature: user.savedSignature,
            onboarding: user.onboarding
        },
        workspaces: user.memberships.map((m) => ({
            name: m.workspace.name,
            segment: m.workspace.segment,
            role: m.role,
            memberSince: m.createdAt,
            emailNotifications: { proposalOpened: m.notifyOnOpen, proposalResponse: m.notifyOnResponse },
            ...(m.role === 'OWNER' ? { planTier: m.workspace.planTier, billingStatus: m.workspace.billingStatus, createdAt: m.workspace.createdAt } : {})
        })),
        proposalSignatures: signatures.map(({ proposal, signerDocument, ...signature }) => ({
            ...signature,
            signerDocument: formatCpf(signerDocument),
            proposal: { clientName: proposal.clientName, link: proposal.slug }
        })),
        paymentReceipts: user.paymentReceipts
    }
}
