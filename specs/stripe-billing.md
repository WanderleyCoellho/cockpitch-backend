# Assinaturas com Stripe

Status: ✅ implementado (2026-10-06)

## Objetivo
Cobrar os planos pagos do Lumen Deal (Essencial R$ 49, Profissional R$ 99, Equipe R$ 249, mensais, BRL) por
assinatura do Stripe, com o plano vivendo no **workspace** e sem configuração manual de IDs de preço.

## Decisões
- **Catálogo por `lookup_key`** (`src/lib/stripe.ts`): na subida da API (e no primeiro checkout) os produtos
  `lumen_deal_essencial|profissional|equipe` e os preços `lumen_deal_*_mensal` são criados se não existirem.
  Mudar o valor no `PLAN_CATALOG` cria um preço novo e transfere a lookup_key (assinantes antigos ficam no preço antigo).
  `STRIPE_PRICE_*` virou opcional (só para preços criados à mão).
- **Sincronização única** (`syncStripeCustomer`): webhook, retorno do checkout e reconciliação leem o estado atual das
  assinaturas do cliente no Stripe e gravam no workspace. Eventos fora de ordem/repetidos não causam regressão.
  Regras: `active/trialing` → plano do preço, ACTIVE; `past_due/unpaid` → mantém o plano, PAST_DUE;
  `incomplete`/cancelada → FREE. Preço desconhecido preserva o plano atual. Cortesia nunca é alterada.
  Clientes do Stripe que não são de nenhum workspace (outros negócios na mesma conta) são ignorados.
- **Sem assinatura dupla:** quem já assina e escolhe outro plano vai ao portal do cliente com a troca
  pré-preenchida (`subscription_update_confirm`). Prorrateio `always_invoice`: no upgrade a diferença é cobrada
  na hora (não fica para a próxima fatura); no downgrade vira crédito.
- **Portal do cliente** (`POST /api/stripe/portal`): cartão, faturas, dados fiscais, troca de plano e cancelamento
  no fim do período. A configuração do portal é criada pela API.
- **Checkout** coleta endereço e CPF/CNPJ (`tax_id_collection`) para a nota fiscal; idioma pt-BR; cupons liberados.
- **Retorno do checkout** (`POST /api/stripe/sync` com `session_id`) sincroniza na hora; a sessão precisa ser do workspace.
- Cliente Stripe salvo que não existe mais (troca de chaves teste → produção) é recriado automaticamente.

## Webhook
`POST /webhooks/stripe` — eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `customer.subscription.created|updated|deleted|paused|resumed`,
`invoice.paid`, `invoice.payment_failed`. Falha na sincronização responde 500 (o Stripe reenvia).

## Configuração (Railway, serviço `api`)
- `STRIPE_SECRET_KEY` — chave secreta (ou restrita) do Stripe.
- `STRIPE_WEBHOOK_SECRET` — `whsec_…` do endpoint do webhook.
- A chave publicável não é usada (o checkout é a página hospedada do Stripe).

## Fora do escopo
- Nota fiscal de serviço (NFS-e): o Stripe não emite; integrar um emissor (ex.: NFE.io/eNotas) numa etapa futura.
- Pix/boleto em assinaturas.

## Testes
`tests/stripe.test.ts` (Stripe em memória em `tests/stripeFake.ts`, webhooks assinados com a biblioteca real).
