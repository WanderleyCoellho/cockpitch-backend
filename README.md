# Lumen Deal — Backend

Backend oficial do **Lumen Deal**, plataforma de propostas comerciais interativas da Lumen Dev Studios.

## Stack

- Node.js 20 + Express 5 + TypeScript
- Prisma + PostgreSQL
- Stripe (assinaturas) + licenciamento manual por comprovante
- Vitest + Supertest (testes de integração com Postgres real)

## Scripts

- `npm run dev` — API com reload
- `npm run build` / `npm start`
- `npm run typecheck`
- `npm test` — precisa de um Postgres em `DATABASE_URL` (padrão: `postgresql://postgres:postgres@localhost:5432/lumen_deal_test`); as migrações são aplicadas automaticamente
- `npm run prisma:generate` / `npm run prisma:migrate`
- Teste de integração do S3 (opcional): `pip install "moto[server]" && moto_server -p 5055 &` e depois `S3_TEST_ENDPOINT=http://localhost:5055 npm test`

## Arquivos (storage)

- Produção: Railway Buckets (S3-compatível, privado). Mídia pública é servida por `GET /media/<chave>`,
  que redireciona para uma URL assinada de 1 h; o link salvo nas propostas nunca expira.
- Comprovantes ficam em `private/` e só abrem pela rota autenticada do Ops (URL assinada de 5 min).
- Dev/teste: `STORAGE_DRIVER=local` grava em `storage/objects`.

## Setup rápido

1. `cp .env.example .env` e preencha (todas as variáveis estão documentadas lá)
2. `npm install`
3. `npm run prisma:migrate`
4. `npm run dev`

Banco de teste local com Docker:

```bash
docker run -d --name lumen-deal-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=lumen_deal_test -p 5432:5432 postgres:16-alpine
npm test
```

## Deploy (Railway)

- O `Dockerfile` é multi-stage: compila com todas as dependências e roda só com as de produção.
- `entrypoint.sh` aplica `prisma migrate deploy` e inicia a API.
- Use `GET /api/health/ready` como healthcheck (verifica o banco).
- Configure `TRUST_PROXY=1`, `NODE_ENV=production` e os `STRIPE_PRICE_*`.

## Especificações

Roadmap e decisões de arquitetura em [`specs/`](specs/) — comece por
[`specs/_context.md`](specs/_context.md) e [`specs/EXECUTAR-TODAS.md`](specs/EXECUTAR-TODAS.md).

## Endpoints principais

- GET /api/health
- GET /api/health/ready (banco + storage)
- GET /media/<chave> (mídia pública)
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
- GET /api/internal/licensing/receipts/:receiptId/file
- PATCH /api/internal/licensing/receipts/:receiptId/analyze
- PATCH /api/internal/licensing/receipts/:receiptId/review
- POST /api/internal/licensing/receipts/:receiptId/approve-and-activate
- POST /api/internal/licensing/heartbeat
- GET /api/internal/licensing/heartbeat

Payload checkout (o servidor resolve o preço via `STRIPE_PRICE_*`):

```json
{ "planTier": "PRO" }
```

Resposta: `{ "sessionId": "cs_...", "url": "https://checkout.stripe.com/..." }`. Redirecione para `url`.

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
