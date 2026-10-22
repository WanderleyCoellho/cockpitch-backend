# Painel Ops (operação interna)

Status: 🚧 em implementação (2026-10-08) — backend pronto; frontend em reescrita.

## Objetivo
Painel interno da Lumen Dev Studios para acompanhar o negócio do Lumen Deal e agir rápido: receita,
assinantes, empresas, pessoas e saúde do sistema. Identidade visual do lumendevstudios.com
(`site-lumendev/specs/identidade-visual.md`), aprovada no canvas "Lumen Deal Ops — estrutura".

## Áreas
1. **Visão geral** — receita mensal (MRR), assinantes, novos cadastros (e quantos com Google), cancelamentos e
   pagamentos atrasados no período (7/30/365 dias); receita por plano; funil do cadastro à assinatura
   (conta → 1ª proposta → cliente abriu → aceita → assinou); "precisa de atenção"; últimos cadastros.
2. **Empresas** — lista com filtros (todas, pagantes, grátis, cortesia, atrasadas) e busca por nome ou
   e-mail de quem participa; ficha com assinatura, uso, pessoas, histórico e ações (abrir no Stripe,
   sincronizar, conceder/retirar cortesia).
3. **Pessoas** — como entra (senha/Google), empresas e papel, plano em uso.
4. **Sistema** — API (commit do deploy), banco (migrações), fila de e-mails (reenviar os que falharam),
   Stripe (modo, catálogo, últimos avisos do webhook, conferência completa).
5. **Comprovantes PIX** — fluxo antigo, mantido como item secundário.

## Decisões
- "Pagante" = plano pago, cobrança ACTIVE ou PAST_DUE, sem cortesia. MRR usa o preço atual do catálogo.
- **Histórico da empresa** (`WorkspaceEvent`): gravado pela sincronização com o Stripe (assinou, trocou de plano,
  pagamento falhou/voltou, cancelamento agendado/desfeito, cancelou) e pelas ações do Ops (cortesia
  concedida/retirada, licença alterada). Cancelamentos do período e receita perdida vêm daqui.
- `Workspace.subscriptionCancelAt`: data do cancelamento agendado (o cliente cancelou, vale até o fim do período).
- **Avisos do Stripe** (`StripeEventLog`): cada evento do webhook com o resultado (synced, ignored,
  unknown_customer, error). Guarda 90 dias.
- Cortesia é da empresa: conceder escolhe Profissional ou Equipe; retirar volta ao Grátis e, se a empresa
  tem cliente no Stripe, assume o que estiver lá. O plano é espelhado no dono (campos legados de User).
- Acesso só com a sessão do Ops (cookie httpOnly ou Bearer do Ops); token de cliente recebe 401.

## API (`/api/internal/ops`)
| Método | Caminho | O quê |
|---|---|---|
| GET | `/overview?days=7\|30\|365` | indicadores, receita por plano, funil, atenção, últimos cadastros |
| GET | `/workspaces?filter=&q=&page=&pageSize=` | lista + contagem por filtro |
| GET | `/workspaces/:id` | ficha |
| POST | `/workspaces/:id/sync` | confere a assinatura no Stripe agora |
| PATCH | `/workspaces/:id/license` | `{licensePolicy:"COURTESY", planTier:"PRO"\|"AGENCY", note?}` ou `{licensePolicy:"STANDARD", note?}` |
| GET | `/people?filter=&q=&page=` | pessoas + contagem por filtro |
| GET | `/system` | saúde e filas |
| POST | `/emails/:id/retry` | recoloca na fila um e-mail que falhou |

A conferência completa continua em `POST /api/internal/billing/reconcile`.

## Testes
`tests/ops.test.ts`.
