import { OAuth2Client } from 'google-auth-library'
import { env } from '../config/env.js'
import { HttpError } from './httpError.js'

export type GoogleIdentity = { sub: string; email: string; name: string; emailVerified: boolean }

let client: OAuth2Client | null = null

/**
 * Valida o ID token do "Entrar com Google" (assinatura, emissor, validade e se foi emitido
 * para o nosso Client ID). Só depois disso o e-mail é confiável.
 */
export async function verifyGoogleIdToken(credential: string): Promise<GoogleIdentity> {
    if (!env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Entrar com Google ainda não está disponível.', 'GOOGLE_DISABLED')
    client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID)
    try {
        const ticket = await client.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID })
        const payload = ticket.getPayload()
        if (!payload?.sub || !payload.email) throw new Error('payload incompleto')
        return {
            sub: payload.sub,
            email: payload.email.trim().toLowerCase(),
            name: (payload.name || payload.given_name || payload.email.split('@')[0]).slice(0, 120),
            emailVerified: payload.email_verified === true
        }
    } catch {
        throw new HttpError(401, 'Não foi possível confirmar sua conta Google. Tente de novo.', 'GOOGLE_TOKEN_INVALID')
    }
}
