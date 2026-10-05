import { execSync } from 'child_process'

// Aplica as migrações no banco de teste antes da suíte (o mesmo comando do deploy).
export default function setup() {
    execSync('npx prisma migrate deploy', {
        stdio: 'inherit',
        env: {
            ...process.env,
            DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/lumen_deal_test'
        }
    })
}
