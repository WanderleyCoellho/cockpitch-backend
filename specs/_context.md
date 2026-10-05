# Contexto Arquitetural do Projeto

> Fonte de verdade da arquitetura do Lumen Deal. Vale para os 3 repositórios
> (`cockpitch-backend`, `cockpitch-frontend`, `cockpitch-admin`). As specs ficam
> centralizadas aqui, no backend.

## Produto
**Lumen Deal** (nome comercial; "Cockpitch" era o nome provisório e permanece só nos nomes dos repositórios),
produto da Lumen Dev Studios (lumendevstudios.com), da mesma família do Lumen CFO.
Plataforma SaaS de **propostas comerciais interativas** para qualquer empresa ou
profissional autônomo. A proposta é uma página pública (link compartilhável) que o
cliente final navega, interage, aceita online e baixa em PDF. A origem foi um
produto para fotografia/vídeo de casamento; a direção atual é **multissegmento**.

## Stack
- Linguagem: TypeScript (Node.js 20) em todos os repositórios.
- Backend: Express 4, Prisma 6, zod, jsonwebtoken, multer, Stripe, node-cron.
- Frontend (painel + página pública): React 18, Vite 6, Tailwind 4, react-router 6.
- Admin (Ops interno): React 18 + Vite, com BFF Express que repassa `/api` ao backend (cookie httpOnly).
- Banco: PostgreSQL (Prisma Migrate, migrações versionadas em `prisma/migrations`).
- Pagamentos: Stripe Checkout (assinatura) + webhook; licença manual por comprovante (fluxo Ops).
- Storage de arquivos: **adotado** disco local (`uploads/`), **decidido** Railway Buckets (S3-compatível) → ver `architecture/002-object-storage.md`.
- E-mail transacional: Resend, domínio de envio `mail.lumendevstudios.com` (região sa-east-1) → ver `email-notifications.md`.
- Mensageria: nenhuma. Jobs agendados in-process via node-cron.

## Hospedagem
- Backend + Postgres + Bucket: Railway, projeto `lumen-deal` (Dockerfile + `entrypoint.sh` roda `prisma migrate deploy`).
- Frontend/Admin: Vercel (time LumenDev Studios). DNS de lumendevstudios.com gerenciado na Vercel.
- Produção (2026-10-05):
  - App + página pública: Vercel `lumen-deal` → `https://deal.lumendevstudios.com`
  - Ops: Vercel `lumen-deal-ops` → `https://ops.deal.lumendevstudios.com` (o `vercel.json` repassa `/api/*` à API; o BFF Express fica só para uso local)
  - API: Railway `lumen-deal` / serviço `api` (região us-east4) → `https://api-production-d3ff.up.railway.app` (planejado: `api.deal.lumendevstudios.com`)
  - Postgres: Railway (mesmo projeto, us-east4). Bucket: Railway `files` (iad).
  - Enquanto os PRs não forem integrados, os deploys usam a branch `claude/funny-clarke-xax3wt`.
- Sem CDN/WAF dedicado na frente da API hoje.

## Camadas e Convenções (backend)
- **Adotado hoje:** `src/routes/*.routes.ts` concentram validação + regra + acesso a dados (camadas misturadas).
- **Alvo (incremental, por módulo tocado):** `routes` (HTTP, validação zod) → `services` (regra de negócio) → Prisma (acesso a dados). Rotas novas nascem nesse formato; rotas antigas migram quando forem alteradas.
- Handlers async passam por `asyncHandler` (Express 4 não captura rejeições).
- Erros de negócio: `HttpError(status, message)`; formato de resposta único `{ message, issues? }`.
- Configuração só via `src/config/env.ts` (zod). Nenhum segredo versionado; `.env.example` documenta tudo.
- Nomes de tabela/campo/endpoint em inglês; textos de UI em pt-BR.

## Camadas e Convenções (frontend)
- `src/infra/gateway/HttpGateway.ts`: único client HTTP.
- `src/interface/{pages,components,context}`; `src/shared` para tipos, schemas e utilitários.
- HTML vindo de usuário só é renderizado após sanitização (`sanitizeHtml`).
- Ajuda contextual (tooltips/notas) via componentes compartilhados — ver `in-app-guidance.md`.

## Módulos existentes (backend)
- Auth de usuário — `src/routes/auth.routes.ts` (JWT Bearer, 7d).
- Auth Ops — `src/routes/ops-auth.routes.ts` (credencial única via env, cookie httpOnly).
- Provider/Package/PackageItem/Proposal — CRUD em `src/routes/*`.
- Página pública + views — `proposal-public.routes.ts`, `proposal-view.routes.ts`.
- Billing — `stripe.routes.ts`, `stripe-webhook.routes.ts`, `jobs/billingReconciliation.job.ts`, `lib/billing.ts`.
- Comprovantes + licenciamento manual — `payment-receipt.routes.ts`, `internal.routes.ts`.
- Upload de mídia — `upload.routes.ts`.

## Direção (decisões tomadas em 2026-10-05)
1. **Multiempresa via Workspace + membros/papéis** → `architecture/001-workspaces.md`.
2. **Proposta em blocos + modelos por segmento** → `architecture/003-proposal-blocks.md`.
3. **Storage em Railway Buckets (S3-compatível)** → `architecture/002-object-storage.md`.
4. Features v1: aceite online, itens com preço calculado, notificações por e-mail, exportar PDF, experiência interativa + ajuda contextual + manual.

---
_Última atualização: 2026-10-05 — nome comercial Lumen Deal, Railway Buckets no lugar do R2, domínio de e-mail._
