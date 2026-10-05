# Spec: Aceite online da proposta

## 1. Comportamento Esperado (O Quê e Por Quê)
O cliente final, na página pública, pode **Aceitar**, **Recusar** ou **Pedir ajuste**. No aceite,
ele informa nome completo, e-mail e (opcional) documento, confirma o pacote/opcionais escolhidos
e marca "Li e concordo com as condições". O sistema registra a evidência e muda o
`commercialStatus` automaticamente. Hoje o status comercial é atualizado só à mão.

## 2. Contexto Técnico e Localização
- **Camadas:** nova tabela `ProposalResponse`; `services/proposal-response.service.ts`; rota
  pública `POST /api/public/proposals/:slug/responses`; o painel ganha a aba "Respostas" na proposta.
- **Padrões:** rota pública com rate limit + validação zod; regra no service.
- **Novas dependências:** nenhuma.
- **Fora do escopo:** assinatura eletrônica com certificado ICP-Brasil, pagamento no aceite (v2: link de pagamento Stripe).
- **Depende de:** `architecture/003-proposal-blocks.md` (bloco `acceptance`), `priced-line-items.md` (snapshot do total).

## 3. Regras de Negócio e Contexto Estrito
- `ProposalResponse`: `proposalId`, `type` (`ACCEPTED` | `DECLINED` | `CHANGE_REQUESTED`),
  `signerName`, `signerEmail`, `signerDocument?`, `message?`, `selection` (Json: pacote + opcionais),
  `totalCents` (snapshot), `contentHash` (SHA-256 dos blocos + seleção no momento do aceite),
  `ip`, `userAgent`, `createdAt`.
- ACCEPTED → `commercialStatus=ACEITA`, `status=FECHADA`; DECLINED → `NEGADA`; CHANGE_REQUESTED → `NEGOCIANDO`.
- Proposta com `status` ≠ ABERTA ou vencida (`createdAt + validityDays`) não aceita novas respostas (409 com mensagem amigável).
- Após ACCEPTED, novas respostas são bloqueadas; o painel pode "reabrir" (volta para ABERTA) e o histórico é mantido.
- A edição da proposta pelo prestador depois do aceite gera aviso: "o cliente aceitou a versão anterior".
- O cliente recebe tela de confirmação e opção de baixar o PDF da versão aceita.

## 4. Limites e Casos de Borda (Fallbacks)
- Rate limit: 5 respostas/hora por IP por proposta.
- Duplo clique ou concorrência: a transação verifica o status dentro do `UPDATE ... WHERE status='ABERTA'`; só a primeira vence.
- Se o e-mail de notificação falhar, o aceite é registrado mesmo assim (e-mail é assíncrono, com retry).

## 5. Critérios de Aceite (Para o Test Harness)
- Integração: aceite válido → 201, status atualizado, `contentHash` preenchido.
- Segundo aceite → 409. Proposta vencida → 409.
- Payload sem `agreeTerms=true` → 400.
- O painel lista as respostas em ordem cronológica com IP e data.
