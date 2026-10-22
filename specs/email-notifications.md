# Spec: Notificações por e-mail

## 1. Comportamento Esperado (O Quê e Por Quê)
O prestador é avisado por e-mail quando algo importante acontece com a proposta, sem precisar
abrir o painel: **primeira abertura** pelo cliente, **aceite**, **recusa** e **pedido de ajuste**.
O cliente final recebe a **confirmação do aceite** (com link do PDF). Convites de equipe também
saem por e-mail.

## 2. Contexto Técnico e Localização
- **Camadas:** `src/lib/mailer/` (interface `Mailer` + `ResendMailer` + `ConsoleMailer` para dev),
  `src/services/notifications.service.ts`, tabela `EmailOutbox` (fila transacional no Postgres)
  e job node-cron a cada 1 min para despachar.
- **Padrões:** outbox (o registro é gravado na mesma transação do evento; o envio é assíncrono, com retry).
- **Novas dependências:** `resend` (SDK). Alternativa: SMTP via `nodemailer`, descartada por entregabilidade e configuração.
- **Fora do escopo:** marketing/newsletter, WhatsApp (v2), notificações in-app em tempo real.
- **Depende de:** `architecture/001-workspaces.md` (destinatários = membros com preferência ativa).

## 3. Regras de Negócio e Contexto Estrito
- `EmailOutbox`: `id`, `to`, `template`, `payload` Json, `status` (`PENDING` | `SENT` | `FAILED`),
  `attempts`, `nextAttemptAt`, `lastError`, `dedupeKey` (único).
- "Primeira abertura" é enviada uma vez por proposta (`dedupeKey=opened:<proposalId>`). Aberturas
  da própria equipe (usuário logado no mesmo navegador) não contam.
- Preferências por membro (`notifyOnOpen`, `notifyOnResponse`), default ligadas.
- Templates em pt-BR, HTML simples e responsivo, com a marca do workspace (logo/cor).
- Retry com backoff exponencial (1, 5, 15, 60 min) até 5 tentativas → `FAILED`.

## 4. Limites e Casos de Borda (Fallbacks)
- Sem `RESEND_API_KEY` → `ConsoleMailer` (loga o e-mail); o app não quebra.
- Timeout de 10 s por envio.
- Máx. 50 envios por execução do job.

## 5. Critérios de Aceite (Para o Test Harness)
- Unidade: o dedupe impede o segundo e-mail de "aberta".
- Integração (mailer mock): o aceite gera 2 registros na outbox (prestador + cliente).
- Falha do mailer → `attempts` incrementa e `nextAttemptAt` avança.

## Variáveis
`RESEND_API_KEY`, `MAIL_FROM` (ex.: `Lumen Deal <propostas@seudominio.com>`), `APP_PUBLIC_URL`.

---
_Changelog: 2026-10-07 — implementado. `EmailOutbox` gravada na transação do evento (`createMany ... skipDuplicates`
pelo `dedupeKey`), reserva atômica do lote (`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`, com
"reserva" de 5 min contra envio duplo), novas tentativas em 1/5/15/60 min e `FAILED` na 5ª falha, até 50 por execução,
job a cada minuto + disparo ~1 s depois de cada evento. Eventos: primeira abertura (uma vez por proposta e pessoa),
aceite/ajuste/recusa (reply-to = e-mail do cliente), confirmação de aceite ao cliente (reply-to = e-mail da empresa)
e convite de equipe. Preferências por pessoa e empresa (`GET/PATCH /api/workspaces/current/notifications`, tela Equipe).
Aberturas da própria equipe (token válido de membro no pedido) não contam nem avisam.
Assumido: envio pela API HTTP do Resend com `fetch` (timeout 10 s), sem o SDK `resend` — uma chamada só, menos dependência.
Assumido: o link de PDF no e-mail de confirmação fica para a etapa de PDF; hoje o e-mail leva à página da proposta.
Variáveis: `RESEND_API_KEY` (já no Railway), `MAIL_FROM` (padrão `Lumen Deal <notificacoes@mail.lumendevstudios.com>`),
os links usam `FRONTEND_URL`._
