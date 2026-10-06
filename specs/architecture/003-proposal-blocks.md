# Arquitetura: Proposta em blocos + modelos por segmento

## 1. Motivação e Problema Atual
O modelo `Proposal`/`Provider` tem campos de domínio de casamento (`weddingPhotoUrl`,
`backstageMedia`, `heroVideoUrl`, `aboutPortfolioMedia`, `deliveryTimes`, textos fixos em
`ProposalPublicPage.tsx` com 889 linhas). Uma consultoria, uma agência ou uma clínica não
se encaixam nesse layout. `sections`/`sectionsConfig` são JSON livres, sem contrato.

## 2. Decisão
A proposta passa a ser uma **lista ordenada de blocos tipados**, renderizada por um
componente por tipo.

- `Proposal.blocks: Json` validado por um **schema zod compartilhado** (`ProposalBlock`
  discriminado por `type`) e versionado (`blocksVersion: Int`).
- Tipos v1:
  | type | Propósito | Interativo para o cliente |
  |---|---|---|
  | `cover` | Título, subtítulo, mídia de fundo (imagem/vídeo), nome do cliente | animação de entrada |
  | `about` | Quem somos (rich text sanitizado + mídia) | – |
  | `scope` | Escopo/entregáveis em lista | checklist visual |
  | `pricing` | Itens com preço (ver `priced-line-items.md`), pacotes alternativos, opcionais | cliente escolhe pacote e liga/desliga opcionais; total recalculado ao vivo |
  | `gallery` | Imagens/vídeos (portfólio) | lightbox |
  | `timeline` | Etapas/cronograma | – |
  | `testimonials` | Depoimentos | carrossel |
  | `faq` | Perguntas frequentes | acordeão |
  | `team` | Pessoas | – |
  | `terms` | Condições, validade, forma de pagamento | – |
  | `cta` / `acceptance` | Aceite online (ver `proposal-online-acceptance.md`) | aceitar/recusar/pedir ajuste |
  | `contact` | WhatsApp, e-mail, agenda | botões |
- Cada bloco tem `id`, `type`, `visible`, `data` (por tipo) e `style` opcional.
- **Tema** (`theme` + `themeCustom`) continua no nível da proposta: paleta, fonte e modo claro/escuro.
- **Modelos (`ProposalTemplate`)**: `id`, `workspaceId` (null = modelo do sistema), `segment`,
  `name`, `description`, `blocks`, `theme`. O sistema traz ao menos um modelo por segmento.
  O usuário pode salvar qualquer proposta como modelo do workspace.
- **Biblioteca do workspace:** blocos reutilizáveis (ex.: "Sobre nós", FAQ padrão) vêm do perfil
  (`Provider`) por referência no momento da criação (copiados, não vinculados, para a proposta
  enviada não mudar depois).

## 3. Escopo do Impacto
- Backend: schema `Proposal` (+`blocks`, `blocksVersion`, `templateId`), novo `ProposalTemplate`,
  rotas de modelos, validação de blocos, endpoint público inalterado no contrato (passa a
  retornar `blocks`).
- Frontend: editor de proposta vira **editor de blocos** (adicionar, reordenar com
  `@hello-pangea/dnd` já instalado, ocultar, duplicar), pré-visualização ao vivo, página pública
  = renderer de blocos. `ProposalPublicPage.tsx` é quebrada em `blocks/*`.

## 4. Plano de Migração
1. Adicionar `blocks` nullable. O renderer público usa `blocks` se existir, senão o layout legado.
2. Migração de dados (script TS idempotente): converter cada proposta legada em blocos
   (`heroVideoUrl`/`weddingPhotoUrl` → `cover`; textos do provider → `about`; pacotes → `pricing`;
   `backstageMedia` → `gallery`; depoimentos → `testimonials`).
3. Depois de validado em produção, remover o layout legado e as colunas específicas (release posterior).

## 5. Nova Tecnologia/Dependências
- `isomorphic-dompurify` (backend) / `dompurify` (frontend) para o rich text dos blocos.
- Nenhuma lib de page builder: o conjunto de blocos é fechado e tipado, o que é mais simples de
  manter e de renderizar em PDF.

## 6. Critérios de Aceite de Infraestrutura
- Toda proposta legada abre idêntica ou equivalente após a conversão (checagem manual de 5 amostras + teste do conversor).
- Payload com bloco de tipo desconhecido ou campo inválido → 400 com `issues`.
- O renderer ignora bloco de tipo desconhecido (Must-Ignore) em vez de quebrar a página.

## 7. Riscos e Rollback
- JSON grande demais: limite de 60 blocos e 512 KB por proposta.
- Rollback: o renderer legado continua até o passo 3.

---
_Changelog: 2026-10-06 — backend implementado: `services/blocks.ts` (união discriminada estrita, 12 tipos v1,
60 blocos/512 KB, ids únicos, texto rico sanitizado, mídia só de upload da própria API → 400 `UNTRUSTED_MEDIA`),
`ProposalTemplate` + rotas `/api/templates` (GET lista sistema + empresa; POST ADMIN, a partir de `fromProposalId`
ou `blocks`, exige `customTemplates` → 402 nos planos Grátis/Essencial; DELETE), criação de proposta com `templateId`
(cópia dos blocos e do tema, não vínculo), endpoint público devolve `blocks`.
Assumido: modelos do sistema ficam no código (`services/templates/systemTemplates.ts`, ids `sys-*`, 1 por segmento)
em vez de linhas com `workspaceId` null — versionados com o app e sem seed. Assumido: o backend usa `sanitize-html`
(já adotado na Fase 0) no lugar de `isomorphic-dompurify`. Assumido: o passo 2 do plano de migração (conversão em massa)
foi trocado por conversão sob demanda no editor (ao abrir uma proposta legada, o editor monta os blocos; ao salvar, grava
`blocks`); a página pública mantém o layout legado enquanto `blocks` for null. Fora da v1: `style` por bloco e o bloco
`acceptance` (entra com `proposal-online-acceptance.md`; até lá `cta` leva ao contato)._
