# Cockpitch Backend

Backend oficial do Cockpitch.

## Stack

- Node.js + Express + TypeScript
- Prisma + PostgreSQL
- Stripe

## Scripts

- npm run dev
- npm run build
- npm run typecheck
- npm run prisma:generate
- npm run prisma:migrate

## Setup rapido

1. Copie .env.example para .env
2. Ajuste DATABASE_URL, JWT_SECRET, STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET
3. Para reconciliação de licença, configure BILLING_RECONCILIATION_ENABLED, BILLING_RECONCILIATION_CRON, BILLING_RECONCILIATION_API_KEY e BILLING_RECONCILIATION_MIN_INTERVAL_SECONDS
4. npm install
5. npm run prisma:migrate
6. npm run dev

## Endpoints principais

- GET /api/health
- POST /api/auth/register
- POST /api/auth/login
- GET /api/auth/me
- POST /api/ops-auth/login
- GET /api/ops-auth/me
- POST /api/ops-auth/logout
- CRUD /api/providers
- CRUD /api/packages
- CRUD /api/package-items
- CRUD /api/proposals
- GET /api/public/proposals/:slug
- POST /api/proposal-views
- POST /api/stripe/create-checkout
- POST /webhooks/stripe
- POST /api/upload
- POST /api/payment-receipts
- GET /api/payment-receipts/me
- POST /api/internal/billing/reconcile
- GET /api/internal/licensing/summary
- GET /api/internal/licensing/users
- PATCH /api/internal/licensing/users/:userId
- GET /api/internal/licensing/receipts
- PATCH /api/internal/licensing/receipts/:receiptId/analyze
- PATCH /api/internal/licensing/receipts/:receiptId/review
- POST /api/internal/licensing/receipts/:receiptId/approve-and-activate
- POST /api/internal/licensing/heartbeat
- GET /api/internal/licensing/heartbeat

Payload checkout:

{
  "priceId": "price_xxx"
}

Endpoint interno de reconciliação manual:

- URL: POST /api/internal/billing/reconcile
- Header opcional legado: x-internal-api-key: <BILLING_RECONCILIATION_API_KEY> (somente com INTERNAL_API_KEY_FALLBACK_ENABLED=true)
- Uso: dispara reconciliação Stripe x banco sob demanda
- Proteção: rate limit por intervalo minimo (BILLING_RECONCILIATION_MIN_INTERVAL_SECONDS)
- Auditoria: logs estruturados de sucesso/falha/rejeição com IP e user-agent

Monitoramento manual de licenças (agente 24/7):

- GET /api/internal/licensing/summary: resumo por plano e status de cobrança
- GET /api/internal/licensing/users: lista licenças com filtros opcionais (planTier, billingStatus, licensePolicy, search, limit)
- PATCH /api/internal/licensing/users/:userId: atualização manual de planTier, billingStatus e licensePolicy
- GET /api/internal/licensing/receipts: fila de comprovantes com filtros por status, risco e busca
- PATCH /api/internal/licensing/receipts/:receiptId/analyze: grava a pre-analise do agente
- PATCH /api/internal/licensing/receipts/:receiptId/review: registra a decisao humana final
- POST /api/internal/licensing/receipts/:receiptId/approve-and-activate: aprova comprovante e ativa licenca em transacao unica
- POST /api/internal/licensing/heartbeat: registro de heartbeat do agente monitor
- GET /api/internal/licensing/heartbeat: leitura dos últimos heartbeats recebidos

Autenticacao operacional recomendada:

- Login ops: POST /api/ops-auth/login com OPS_ADMIN_EMAIL e OPS_ADMIN_PASSWORD
- Sessao: cookie httpOnly (`OPS_COOKIE_NAME`) emitido no login
- Token: Bearer JWT continua aceito para compatibilidade e automacao
- Fallback legado: x-internal-api-key pode ser habilitado com INTERNAL_API_KEY_FALLBACK_ENABLED=true

Fluxo de comprovante:

- POST /api/payment-receipts: cliente autenticado envia PDF ou imagem do comprovante
- GET /api/payment-receipts/me: cliente consulta status do próprio comprovante
- O agente registra pre-analise em licensing/receipts/:receiptId/analyze
- A operação humana aprova ou rejeita em licensing/receipts/:receiptId/review
- Em casos comerciais especiais, o usuário pode ser marcado com licensePolicy=COURTESY para acesso garantido até segunda ordem
