import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'

/**
 * Guia de primeiros passos (spec in-app-guidance). Os passos vêm do estado real da empresa;
 * só o que não dá para deduzir (link compartilhado, tours vistos, checklist oculto) fica salvo na pessoa.
 */

const prefsSchema = z.object({
    linkShared: z.boolean().optional(),
    dismissedChecklist: z.boolean().optional(),
    toursSeen: z.array(z.string().max(40)).max(50).optional(),
    toursDisabled: z.boolean().optional()
})
type Prefs = z.infer<typeof prefsSchema>

export const onboardingPatchSchema = z
    .object({
        linkShared: z.literal(true).optional(),
        dismissedChecklist: z.boolean().optional(),
        tourSeen: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
        toursDisabled: z.boolean().optional(),
        resetTours: z.literal(true).optional()
    })
    .refine((body) => Object.keys(body).length > 0, { message: 'Nada para alterar' })

function readPrefs(value: Prisma.JsonValue | null | undefined): Prefs {
    const parsed = prefsSchema.safeParse(value ?? {})
    return parsed.success ? parsed.data : {}
}

export type OnboardingStepKey = 'profile' | 'package' | 'proposal' | 'shared' | 'viewed'

export async function getOnboarding(userId: string, workspaceId: string) {
    const [user, provider, packages, proposals, views] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onboarding: true } }),
        prisma.provider.findFirst({
            where: { workspaceId },
            orderBy: { createdAt: 'asc' },
            select: { whatsapp: true, instagram: true, shortDescription: true, aboutText: true, logoUrl: true }
        }),
        prisma.package.count({ where: { provider: { workspaceId } } }),
        prisma.proposal.count({ where: { provider: { workspaceId } } }),
        prisma.proposalView.count({ where: { proposal: { provider: { workspaceId } } } })
    ])
    const prefs = readPrefs(user.onboarding)
    // Perfil "pronto": um jeito de o cliente falar com a empresa e algo que a apresente.
    const profileDone =
        !!provider && !!(provider.whatsapp || provider.instagram) && !!(provider.shortDescription || provider.aboutText || provider.logoUrl)

    const steps: Array<{ key: OnboardingStepKey; done: boolean }> = [
        { key: 'profile', done: profileDone },
        { key: 'package', done: packages > 0 },
        { key: 'proposal', done: proposals > 0 },
        { key: 'shared', done: !!prefs.linkShared || views > 0 },
        { key: 'viewed', done: views > 0 }
    ]
    return {
        steps,
        completed: steps.filter((s) => s.done).length,
        total: steps.length,
        dismissed: !!prefs.dismissedChecklist,
        toursSeen: prefs.toursSeen ?? [],
        toursDisabled: !!prefs.toursDisabled
    }
}

export async function updateOnboardingPrefs(userId: string, patch: z.infer<typeof onboardingPatchSchema>) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onboarding: true } })
    const prefs = readPrefs(user.onboarding)
    const toursSeen = new Set(patch.resetTours ? [] : prefs.toursSeen ?? [])
    if (patch.tourSeen) toursSeen.add(patch.tourSeen)
    const next: Prefs = {
        ...prefs,
        ...(patch.linkShared ? { linkShared: true } : {}),
        ...(patch.dismissedChecklist !== undefined ? { dismissedChecklist: patch.dismissedChecklist } : {}),
        ...(patch.toursDisabled !== undefined ? { toursDisabled: patch.toursDisabled } : {}),
        toursSeen: [...toursSeen].slice(-50)
    }
    await prisma.user.update({ where: { id: userId }, data: { onboarding: next as Prisma.InputJsonValue } })
    return next
}
