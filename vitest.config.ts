import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        // Testes de integração compartilham um banco real: roda um arquivo por vez.
        fileParallelism: false,
        globalSetup: ['tests/globalSetup.ts'],
        env: {
            NODE_ENV: 'test',
            DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/cockpitch_test',
            JWT_SECRET: 'test-secret-with-at-least-thirty-two-characters!!',
            STRIPE_SECRET_KEY: 'sk_test_dummy',
            STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
            STRIPE_PRICE_STARTER: 'price_starter_test',
            STRIPE_PRICE_PRO: 'price_pro_test',
            OPS_ADMIN_EMAIL: 'ops@test.local',
            OPS_ADMIN_PASSWORD: 'ops-password-test',
            TRUST_PROXY: '0'
        }
    }
})
