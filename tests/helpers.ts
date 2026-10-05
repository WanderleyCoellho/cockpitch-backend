import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma.js'
import { signAccessToken } from '../src/lib/jwt.js'

export async function resetDatabase() {
    await prisma.$executeRawUnsafe(
        'TRUNCATE "ProposalView", "Proposal", "PackageItem", "Package", "Provider", "PaymentReceipt", "User" RESTART IDENTITY CASCADE'
    )
}

let counter = 0

/** Cria usuário + provider direto no banco (sem passar pelo rate limit de /auth). */
export async function createUser(name = 'Usuário Teste') {
    counter += 1
    const email = `user${counter}-${Date.now()}@test.local`
    const user = await prisma.user.create({
        data: {
            name,
            email,
            passwordHash: await bcrypt.hash('password123', 4),
            providers: { create: { name, email } }
        },
        include: { providers: true }
    })
    const token = signAccessToken({ userId: user.id, role: user.role })
    return { user, provider: user.providers[0], token, email, auth: `Bearer ${token}` }
}

export async function createPackage(providerId: string, name = 'Pacote') {
    return prisma.package.create({ data: { providerId, name, price: 'R$ 1.000' } })
}
