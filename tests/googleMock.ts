import { vi } from 'vitest'
import { HttpError } from '../src/lib/httpError.js'

/** Identidades simuladas do Google (a validação real é feita pela biblioteca oficial). */
const identities: Record<string, { sub: string; email: string; name: string; emailVerified: boolean }> = {
    'token-ana': { sub: 'google-sub-ana', email: 'ana@gmail.com', name: 'Ana Souza', emailVerified: true },
    'token-bia': { sub: 'google-sub-bia', email: 'bia@gmail.com', name: 'Bia Lima', emailVerified: true },
    'token-unverified': { sub: 'google-sub-x', email: 'x@gmail.com', name: 'X', emailVerified: false },
    'token-ana-other-sub': { sub: 'google-sub-ana-2', email: 'ana@gmail.com', name: 'Ana Souza', emailVerified: true }
}

/** Credenciais têm tamanho mínimo; o sufixo "x" é removido aqui. */
export const cred = (name: string) => `${name}${'x'.repeat(30)}`

export const verifyGoogleIdToken = vi.fn(async (credential: string) => {
    const id = identities[credential.replace(/x+$/, '')]
    if (!id) throw new HttpError(401, 'Não foi possível confirmar sua conta Google.', 'GOOGLE_TOKEN_INVALID')
    return id
})
