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
- Toda mudança vai para a branch `claude/funny-clarke-xax3wt` do(s) repositório(s) afetado(s).

## Ordem de Execução
1. **Fundação (Fase 0)**: estabilidade, segurança, deploy, testes e CI — `specs/process/001-fundacao-hardening.md` — Depende de: nenhuma — ✅ concluído em 2026-10-05 (backend + frontend + admin).
2. **Storage (Railway Buckets)** — `specs/architecture/002-object-storage.md` — Depende de: 1 — ✅ concluído em 2026-10-05 (cota por plano fica para a etapa 3, que cria o Workspace).
3. **Workspaces + equipe + entitlements no servidor** — `specs/architecture/001-workspaces.md` — Depende de: 1.
4. **Itens com preço calculado** — `specs/priced-line-items.md` — Depende de: 3.
5. **Proposta em blocos + modelos por segmento** — `specs/architecture/003-proposal-blocks.md` — Depende de: 3, 4 (bloco `pricing`).
6. **Ajuda contextual + onboarding + central de ajuda** — `specs/in-app-guidance.md` — Depende de: 1. Os componentes base podem ser feitos em paralelo com 3–5 e aplicados a cada tela refeita.
7. **Aceite online** — `specs/proposal-online-acceptance.md` — Depende de: 5.
8. **Notificações por e-mail** — `specs/email-notifications.md` — Depende de: 3, 7 — domínio `mail.lumendevstudios.com` em verificação no Resend; precisa de `RESEND_API_KEY` no Railway (funciona em modo console sem isso).
9. **Exportar PDF (impressão)** — `specs/pdf-export.md` — Depende de: 5.

---
_Gerado em 2026-10-05 a partir de: process/001, architecture/001–003, priced-line-items,
proposal-online-acceptance, email-notifications, pdf-export, in-app-guidance. Este arquivo não contém código._
