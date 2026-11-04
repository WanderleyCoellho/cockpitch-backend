# EXECUTAR-TODAS — Roteiro de Execução Autônoma

## Contrato de Execução
- Implemente os itens abaixo respeitando as dependências de cada um. A numeração é uma ordem
  de leitura sugerida; só a relação "Depende de" é obrigatória.
- Depois de cada item, valide contra os Critérios de Aceite da spec correspondente antes de dar o item por concluído.
- **Pare e reporte ao usuário** quando:
  - os critérios de aceite de um item não passarem;
  - o código real contradisser uma decisão registrada (incluindo "Assumido:"). Explique o
    conflito e espere orientação. Estilo e nomenclatura sem impacto funcional não são motivo para parar.
- Fora desses casos, siga sem pedir confirmação.
- Cada item vai numa branch própria a partir da `main` do(s) repositório(s) afetado(s), com PR. A `main` é o que está
  em produção.

## Ordem de Execução
1. **Fundação (Fase 0)**: estabilidade, segurança, deploy, testes e CI — `specs/process/001-fundacao-hardening.md` — Depende de: nenhuma — ✅ concluído em 2026-10-05 (backend + frontend + admin).
2. **Storage (Railway Buckets)** — `specs/architecture/002-object-storage.md` — Depende de: 1 — ✅ concluído em 2026-10-05 (cota por plano fica para a etapa 3, que cria o Workspace).
3. **Workspaces + equipe + entitlements no servidor** — `specs/architecture/001-workspaces.md` — Depende de: 1 — ✅ concluído em 2026-10-05 (backend + frontend; Ops segue listando por pessoa).
4. **Itens com preço calculado** — `specs/priced-line-items.md` — Depende de: 3. — ✅ concluído em 2026-10-06 (backend + frontend + página pública com opcionais).
5. **Proposta em blocos + modelos por segmento** — `specs/architecture/003-proposal-blocks.md` — Depende de: 3, 4 (bloco `pricing`). — ✅ concluído em 2026-10-06 (backend + página pública + editor com modelos e pré-visualização).
6. **Ajuda contextual + onboarding + central de ajuda** — `specs/in-app-guidance.md` — Depende de: 1. — ✅ concluído em 2026-10-07 (checklist, tours, central /ajuda, estados vazios).
7. **Aceite online** — `specs/proposal-online-acceptance.md` — Depende de: 5. — ✅ concluído em 2026-10-06 (bloco de aceite, evidência com hash, aba Respostas e reabrir).
8. **Notificações por e-mail** — `specs/email-notifications.md` — Depende de: 3, 7 — ✅ concluído em 2026-10-07 (fila com novas tentativas, avisos de abertura/respostas, confirmação ao cliente, convites, preferências).
9. **Entrar e cadastrar com Google** — `specs/google-sign-in.md` — Depende de: 3 — ✅ concluído em 2026-10-07 (falta o Client ID no Railway para ligar).
10. **Exportar PDF (impressão)** — `specs/pdf-export.md` — Depende de: 5. — ✅ concluído em 2026-10-07 (rota de impressão A4, comprovante de aceite, botões no público e no painel).
11. **Assinatura eletrônica (empresa e cliente)** — `specs/digital-signature.md` — Depende de: 7, 8. — ✅ concluído.
12. **Modelos de proposta e biblioteca de blocos** — `specs/proposal-templates.md` — Depende de: 5. — ✅ concluído.
13. **Assinaturas com Stripe** — `specs/stripe-billing.md` — Depende de: 3. — ✅ concluído em 2026-10-06. Produção live em 2026-11-03.
14. **Painel Ops** — `specs/ops-panel.md` — Depende de: 3, 13. — ✅ concluído.
15. **Google com confirmação por e-mail** — revisão de `specs/google-sign-in.md` — Depende de: 9. — ✅ concluído em 2026-11-03.
16. **Privacidade: política, cookies e retenção** — `specs/lgpd-privacy.md` — Depende de: 8, 11, 15. — ✅ concluído em 2026-11-03 (retenção no PR #6 do backend, aguardando merge).
17. **Baixar meus dados e excluir minha conta** — `specs/account-data-rights.md` — Depende de: 13, 16. — ✅ implementado em 2026-11-04 (PRs: backend #7, frontend #8, Ops #4). Antes do deploy, dar gravação em Subscriptions e PaymentMethods na chave do Stripe.

### Pendências fora de spec (operacionais)
- Ligar a CSP de verdade (tirar o Report-Only) depois de conferir as violações no console.
- Trocar os `S3_*` colados à mão por variáveis de referência do bucket no Railway.
- Conferir o primeiro pagamento real e a entrega do webhook em produção.
- Revisão jurídica da Política de Privacidade e dos Termos (inclui o prazo de 5 anos dos comprovantes).
- Domínio `api.deal.lumendevstudios.com` para a API (planejado).
- Atualizações opcionais: react-router 7, substituir o quill, Express 5 no BFF do Ops.

---
_Gerado em 2026-10-05 a partir de: process/001, architecture/001–003, priced-line-items,
proposal-online-acceptance, email-notifications, pdf-export, in-app-guidance. Atualizado em 2026-11-04 com
digital-signature, proposal-templates, stripe-billing, ops-panel, google-sign-in (revisão), lgpd-privacy e
account-data-rights. Este arquivo não contém código._
