import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const EnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3001),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres aleatórios'),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    STRIPE_PRICE_STARTER: z.string().default(''),
    STRIPE_PRICE_PRO: z.string().default(''),
    STRIPE_PRICE_AGENCY: z.string().default(''),
    // Número de proxies reversos na frente da API (Railway = 1). Necessário para req.ip/req.protocol corretos.
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
    // Origens extras liberadas no CORS, separadas por vírgula (ex.: domínios de preview).
    CORS_EXTRA_ORIGINS: z.string().default(''),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    OPS_FRONTEND_URL: z.string().url().default('http://localhost:5174'),
    OPS_ADMIN_EMAIL: z.string().default(''),
    OPS_ADMIN_PASSWORD: z.string().default(''),
    OPS_JWT_SECRET: z.string().default(''),
    OPS_ACCESS_TOKEN_TTL: z.string().default('12h'),
    OPS_COOKIE_NAME: z.string().default('ops_access_token'),
    INTERNAL_API_KEY_FALLBACK_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((value) => value === 'true'),
    BILLING_RECONCILIATION_ENABLED: z
        .enum(['true', 'false'])
        .default('false')
        .transform((value) => value === 'true'),
    BILLING_RECONCILIATION_CRON: z.string().default('0 */6 * * *'),
    BILLING_RECONCILIATION_API_KEY: z.string().default(''),
    BILLING_RECONCILIATION_MIN_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(60)
})

export const env = EnvSchema.parse(process.env)
