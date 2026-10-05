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
    BILLING_RECONCILIATION_MIN_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(60),
    // URL pública da API, usada para montar links de arquivos (ex.: https://api.deal.lumendevstudios.com).
    PUBLIC_API_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    // Armazenamento de arquivos: "local" (dev/teste) ou "s3" (Railway Buckets em produção).
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('storage/objects'),
    S3_ENDPOINT: z.string().default(''),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().default(''),
    S3_ACCESS_KEY_ID: z.string().default(''),
    S3_SECRET_ACCESS_KEY: z.string().default(''),
    S3_FORCE_PATH_STYLE: z
        .enum(['true', 'false'])
        .default('false')
        .transform((value) => value === 'true')
}).superRefine((value, ctx) => {
    if (value.STORAGE_DRIVER !== 's3') return
    for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!value[key]) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} é obrigatório quando STORAGE_DRIVER=s3` })
        }
    }
})

export const env = EnvSchema.parse(process.env)
