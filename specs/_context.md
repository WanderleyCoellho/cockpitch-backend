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
- Backend: Express 5, Prisma 6, zod 4 (mensagens em pt-BR via `z.locales.ptBR()`), jsonwebtoken, multer, Stripe 17,
  node-cron, google-auth-library. Testes: vitest 4 + supertest com Postgres real em Docker.
- Frontend (painel + página pública): React 18, Vite 6, Tailwind 4, react-router 6, TanStack Query 5,
  react-hook-form 7 + zod 4.
- Admin (Ops interno): React 18 + Vite, com BFF Express que repassa `/api` ao backend (cookie httpOnly).
- Banco: PostgreSQL (Prisma Migrate, migrações versionadas em `prisma/migrations`).
- Pagamentos: Stripe Checkout (assinatura) + webhook, **em produção (live) desde 2026-11-03** com chave restrita →
  ver `stripe-billing.md`. Licença manual por comprovante (fluxo Ops, legado).
- Storage de arquivos: **adotado** Railway Buckets via `src/lib/storage` (`STORAGE_DRIVER=s3`; `local` em dev/teste); mídia pública em `/media/<chave>` → ver `architecture/002-object-storage.md`.
- E-mail transacional: Resend, domínio de envio `mail.lumendevstudios.com` (região sa-east-1) → ver `email-notifications.md`.
- Mensageria: nenhuma. Jobs agendados in-process via node-cron (`src/jobs`):
  - `emailOutbox`: a cada minuto;
  - `billingReconciliation`: a cada 6 horas;
  - `dataRetention`: diário;
  - `paymentGrace`: de hora em hora.

## Hospedagem
- Backend + Postgres + Bucket: Railway, projeto `lumen-deal` (Dockerfile + `entrypoint.sh` roda `prisma migrate deploy`).
- Frontend/Admin: Vercel (time LumenDev Studios). DNS de lumendevstudios.com gerenciado na Vercel.
- Produção (2026-10-05):
  - App + página pública: Vercel `lumen-deal` → `https://deal.lumendevstudios.com`
  - Ops: Vercel `lumen-deal-ops` → `https://ops.deal.lumendevstudios.com` (o `vercel.json` repassa `/api/*` à API; o BFF Express fica só para uso local)
  - API: Railway `lumen-deal` / serviço `api` (região us-east4) → `https://api-production-d3ff.up.railway.app` (planejado: `api.deal.lumendevstudios.com`)
  - Postgres: Railway (mesmo projeto, us-east4). Bucket: Railway `files` (iad).
  - Deploys saem da branch `main` dos três repositórios (Railway e Vercel). Mudanças entram por branch própria + PR.
- Sem CDN/WAF dedicado na frente da API hoje. O frontend envia CSP em modo Report-Only (`vercel.json`).

## Camadas e Convenções (backend)
- **Adotado hoje:** `src/routes/*.routes.ts` concentram validação + regra + acesso a dados (camadas misturadas).
- **Alvo (incremental, por módulo tocado):** `routes` (HTTP, validação zod) → `services` (regra de negócio) → Prisma (acesso a dados). Rotas novas nascem nesse formato; rotas antigas migram quando forem alteradas.
- Express 5 já repassa ao `errorHandler` as rejeições de handlers async; não é preciso `asyncHandler`.
- Erros de negócio: `HttpError(status, message)`; formato de resposta único `{ message, issues? }`.
- Configuração só via `src/config/env.ts` (zod). Nenhum segredo versionado; `.env.example` documenta tudo.
- PATCH com schema que tem `.default()`: use `patchSchemaOf()` (`src/lib/zod.ts`). No zod 4, `.partial()` ainda aplica
  os defaults e apagaria dados.
- Segredos de uso único (códigos, tokens de link) são guardados só como hash e conferidos em tempo constante.
- Auditoria de segurança: `.security/allowlist.json` guarda as exceções aceitas, com motivo e validade.
- Nomes de tabela/campo/endpoint em inglês; textos de UI em pt-BR.

## Camadas e Convenções (frontend)
- `src/infra/gateway/HttpGateway.ts`: único client HTTP.
- `src/interface/{pages,components,context}`; `src/shared` para tipos, schemas e utilitários.
- HTML vindo de usuário só é renderizado após sanitização (`sanitizeHtml`).
- Ajuda contextual (tooltips/notas) via componentes compartilhados — ver `in-app-guidance.md`.

## Módulos existentes (backend)
- Auth de usuário — `src/routes/auth.routes.ts` (JWT Bearer, 7d; `requireAuth` confere o usuário e
  `sessionsValidAfter`). Google com confirmação por e-mail — `services/google-signup.service.ts`.
- Auth Ops — `src/routes/ops-auth.routes.ts` (credencial única via env, cookie httpOnly).
- Workspaces, equipe e convites — `workspace.routes.ts`, `invite.routes.ts`, `services/workspace.service.ts`.
- Provider/Package/PackageItem/Proposal — CRUD em `src/routes/*`. Blocos, modelos e biblioteca —
  `services/blocks.ts`, `template.service.ts`, `block-library.service.ts`.
- Aceite online e assinatura eletrônica — `services/proposal-response.service.ts`, `services/signature.service.ts`.
- E-mail transacional (fila com novas tentativas) — `services/email/{outbox,templates}.ts`, `services/notifications.service.ts`.
- Perfil e direitos LGPD (assinatura salva, exportar e excluir conta) — `profile.routes.ts` (`/api/me`),
  `services/{data-export,account-deletion,payment-grace}.service.ts`.
- Retenção de dados — `services/data-retention.service.ts`, `jobs/dataRetention.job.ts`.
- Painel Ops — `ops.routes.ts`, `services/ops.service.ts`.
- Página pública + views — `proposal-public.routes.ts`, `proposal-view.routes.ts`.
- Billing — `stripe.routes.ts`, `stripe-webhook.routes.ts`, `services/stripe-billing.service.ts`,
  `jobs/billingReconciliation.job.ts`, `lib/billing.ts`, `lib/stripe.ts`. Passagem de teste para produção:
  `scripts/stripe-cutover.ts`.
- Comprovantes + licenciamento manual — `payment-receipt.routes.ts`, `internal.routes.ts`.
- Upload de mídia — `upload.routes.ts`.

## Direção (decisões tomadas em 2026-10-05)
1. **Multiempresa via Workspace + membros/papéis** → `architecture/001-workspaces.md`.
2. **Proposta em blocos + modelos por segmento** → `architecture/003-proposal-blocks.md`.
3. **Storage em Railway Buckets (S3-compatível)** → `architecture/002-object-storage.md`.
4. Features v1: aceite online, itens com preço calculado, notificações por e-mail, exportar PDF, experiência interativa + ajuda contextual + manual.
5. **Privacidade (2026-11-03/04):**
   - só armazenamento necessário no navegador, sem banner;
   - retenção automática;
   - exportar e excluir conta pelo painel;
   - Lumen Deal como operador nos dados dos clientes finais;
   - **não treinar IA com conteúdo de clientes**.

   Ver `lgpd-privacy.md` e `account-data-rights.md`.

---
_Última atualização: 2026-11-04 — Express 5/zod 4/vitest 4, deploy pela `main`, Stripe em produção, jobs de retenção e
prazo de pagamento, módulos de LGPD. (Antes: 2026-10-05 — nome comercial Lumen Deal, Railway Buckets, domínio de e-mail.)_
