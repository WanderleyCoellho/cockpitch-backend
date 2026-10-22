# Arquitetura: Workspaces (multiempresa com equipe)

## 1. Motivação e Problema Atual
Hoje `User 1─N Provider`, e o plano e a cobrança ficam no `User`. Na prática cada login é um
"prestador" isolado. Isso impede:
- empresas com mais de uma pessoa (dono, vendedores, atendimento) usando a mesma conta;
- cobrar por empresa, e não por pessoa;
- aplicar limites de plano no servidor. Hoje o plano efetivo é lido do `localStorage`
  (`PlanContext.tsx`) e nenhum limite é verificado no backend.

## 2. Decisão
Introduzir **Workspace** como unidade de tenancy, cobrança e limites.

- `Workspace`: `id`, `name`, `slug` (único, usado em URLs públicas futuras), `segment`
  (enum: `PHOTO_VIDEO`, `EVENTS`, `AGENCY`, `CONSULTING`, `HEALTH_BEAUTY`, `CONSTRUCTION`,
  `EDUCATION`, `TECH`, `GENERAL`), `logoUrl`, `brandColor`, `locale` (default `pt-BR`),
  `currency` (default `BRL`), mais os campos de billing hoje no `User`: `planTier`,
  `billingStatus`, `licensePolicy`, `licensePolicyNote`, `stripeCustomerId` e `stripeSubscriptionId`.
- `WorkspaceMember`: `workspaceId`, `userId`, `role` (`OWNER` | `ADMIN` | `MEMBER`),
  único por (`workspaceId`, `userId`).
- `WorkspaceInvite`: `workspaceId`, `email`, `role`, `tokenHash`, `expiresAt`, `acceptedAt`.
- `Provider` passa a ser o **perfil público da empresa** (vitrine) e pertence ao Workspace
  (`workspaceId`). `userId` fica como legado (nullable) até a remoção.
- `Package`/`Proposal` continuam ligados a `Provider`; o escopo de acesso passa a ser
  "o usuário é membro do workspace dono do provider".
- O JWT carrega `userId`; o workspace ativo vem do header `X-Workspace-Id`. O backend valida
  a associação de membro a cada requisição (middleware `requireWorkspace`).
- **Entitlements no servidor:** `services/entitlements.ts` resolve os limites a partir de
  `Workspace.planTier`/`licensePolicy`. A criação de proposta e de membro verifica o limite
  e responde `402 { code: 'PLAN_LIMIT' }`.

Papéis:
| Ação | OWNER | ADMIN | MEMBER |
|---|---|---|---|
| Billing/plano, excluir workspace | ✔ | – | – |
| Convidar/remover membros | ✔ | ✔ | – |
| Perfil, pacotes, modelos | ✔ | ✔ | – |
| Criar/editar propostas | ✔ | ✔ | ✔ (só as próprias, ou todas se `canSeeAll`; v1: todas) |

## 3. Escopo do Impacto
- Prisma schema + migração; `auth.routes` (o registro cria Workspace + membro OWNER);
  todos os `verify*Ownership`; Stripe (customer/subscription por workspace); webhook;
  reconciliação; `internal.routes` (o Ops passa a listar workspaces).
- Frontend: `AuthContext` (lista de workspaces + ativo), `HttpGateway` (header),
  `PlanContext` (lê entitlements do servidor), nova tela "Equipe".
- Admin: listagens de licenciamento por workspace.
- Specs dependentes: `003-proposal-blocks`, `proposal-online-acceptance`, `email-notifications`.

## 4. Plano de Migração (aditivo, sem downtime)
1. Criar tabelas novas e colunas `workspaceId` **nullable**.
2. Migração de dados SQL: para cada `User` com providers, criar um Workspace (nome = nome do
   1º provider, cópia dos campos de billing) e um membro OWNER; preencher `Provider.workspaceId`.
3. O código passa a ler e escrever pelo workspace; os campos de billing no `User` ficam congelados (deprecados).
4. Numa release posterior: `Provider.workspaceId` passa a NOT NULL e as colunas legadas do `User` são removidas.

## 5. Nova Tecnologia/Dependências
Nenhuma. Convites por e-mail dependem de `email-notifications.md`; até lá, o link do convite é
exibido para ser copiado.

## 6. Critérios de Aceite de Infraestrutura
- A migração roda em um banco com dados atuais sem perda; todo provider termina com `workspaceId`.
- Um usuário que não é membro recebe 404 ao acessar recurso de outro workspace (teste de integração).
- MEMBER recebe 403 em billing/membros.
- Exceder o limite do plano retorna 402 com `code: PLAN_LIMIT`.

## 7. Riscos e Rollback
- Risco: rota esquecida sem escopo de workspace (vazamento entre tenants). Mitigação: helper
  único `scopedProviderWhere(ctx)` e testes de isolamento por recurso.
- Rollback: como a migração é aditiva, voltar o código para a versão anterior continua
  funcionando, porque as colunas antigas são preservadas até o passo 4.

---
_Changelog: 2026-10-05 — backend implementado (migração aditiva com backfill, `requireWorkspace`/`requireRole`,
entitlements no servidor, convites com token de uso único (hash SHA-256, 7 dias), Stripe por workspace,
Ops por pessoa → workspace que ela possui). Decisão: os campos de licença em `User` continuam como espelho
do workspace possuído (não congelados) até o painel Ops listar por workspace; `Provider.userId` segue como "criador"._
