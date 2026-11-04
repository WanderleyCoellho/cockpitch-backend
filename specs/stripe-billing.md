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
  Regras:
  - `active/trialing`: plano do preço, ACTIVE;
  - `past_due`: mantém o plano, PAST_DUE (o Stripe ainda tenta cobrar);
  - `unpaid`: INACTIVE, sem plano pago (as tentativas acabaram);
  - `incomplete` ou cancelada: FREE. Preço desconhecido preserva o plano atual. Cortesia nunca é alterada.
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
`POST /webhooks/stripe`. Corpo cru com limite de 1 MB e assinatura conferida.

**Eventos de cobrança:**
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.created|updated|deleted|paused|resumed`
- `invoice.paid`
- `invoice.payment_failed`

Falha na sincronização responde 500 (o Stripe reenvia).

**Sinais de risco** (`RISK_STRIPE_EVENTS`): gravados no histórico da empresa, um por `eventId`. O Ops decide reembolsar
ou cancelar no Dashboard.

| Evento | Registro no histórico |
|---|---|
| `charge.dispute.created` | `PAYMENT_DISPUTED` |
| `charge.refunded` | `PAYMENT_REFUNDED` |
| `radar.early_fraud_warning.created` | `FRAUD_WARNING` |

**Outras proteções:**
- Evento de modo diferente da chave (live contra teste) é recusado e registrado como `mode_mismatch`.
- Cada evento fica em `StripeEventLog` por 90 dias (job de retenção, ver `lgpd-privacy.md`).

## Produção (live desde 2026-11-03)
- A chave é **restrita** (`rk_live_`). `stripeMode()` aparece no log da subida e avisa se a produção usar chave de teste.

  | Recurso | Permissão |
  |---|---|
  | Customers | Gravação |
  | Products | Gravação |
  | Prices | Gravação |
  | Checkout Sessions | Gravação |
  | Customer portal | Gravação |
  | Charges | Leitura |
  | Subscriptions | **Gravação** |
  | PaymentMethods | **Gravação** |

  Subscriptions e PaymentMethods em gravação são exigidas por `account-data-rights.md`.
- **Passagem de teste para produção:** `src/scripts/stripe-cutover.ts` (`services/stripe-cutover.service.ts`). Sem
  `--apply`, é só simulação; `--apply` só roda com chave live. As empresas pagas no teste voltam ao Grátis e as
  cortesias ficam.
- A API interna compara a chave em tempo constante (`sameSecret`).
- **Troca de dono por exclusão de conta:** os cartões do dono antigo saem e a assinatura segue com prazo
  `paymentGraceUntil`, aplicado pelo job `paymentGrace`. Encerrar a empresa apaga o cliente no Stripe. Detalhes em
  `account-data-rights.md`.

## Configuração (Railway, serviço `api`)
- `STRIPE_SECRET_KEY` — chave secreta (ou restrita) do Stripe.
- `STRIPE_WEBHOOK_SECRET` — `whsec_…` do endpoint do webhook.
- A chave publicável não é usada (o checkout é a página hospedada do Stripe).

## Fora do escopo
- Nota fiscal de serviço (NFS-e): o Stripe não emite; integrar um emissor (ex.: NFE.io/eNotas) numa etapa futura.
- Pix/boleto em assinaturas.

## Testes
`tests/stripe.test.ts` (Stripe em memória em `tests/stripeFake.ts`, webhooks assinados com a biblioteca real). Cobre:
- risco;
- `mode_mismatch`;
- `unpaid`;
- passagem de teste para produção.

O prazo do novo dono fica em `tests/account-deletion.test.ts`.

---
_Changelog:_
- 2026-11-03: produção (chave restrita, sinais de risco, guarda de modo, `unpaid` sem acesso, script de passagem).
- 2026-11-04: permissões novas e prazo do novo dono.
