# Spec: Experiência interativa + ajuda contextual + manual

## 1. Comportamento Esperado (O Quê e Por Quê)
Duas frentes, pedidas explicitamente:
1. **Para o cliente final (página pública):** a proposta é uma experiência navegável e não um
   PDF na tela. Navegação por seções com indicador de progresso, animações de entrada, galeria
   em lightbox, FAQ em acordeão, simulador de preço (opcionais ligáveis), botão flutuante de
   contato e aceite ao final. Isso cria profundidade e familiaridade com a marca do prestador.
2. **Para quem usa o painel:** não depender de manual separado. Cada campo e ferramenta explica
   **para que serve e como usar** no próprio lugar:
   - **Tooltip de ajuda** (ícone "?" ao lado do rótulo, e também ao repousar o mouse ~600 ms
     sobre o campo; no toque, ao tocar no ícone): o que é, exemplo bom e onde aparece para o cliente.
   - **Nota inline** (texto curto sob o campo) para as regras que afetam o resultado (ex.: "o slug vira o link público").
   - **Checklist de primeiros passos** no dashboard (completar perfil → criar pacote → criar
     proposta → enviar link → receber primeira visualização), com progresso salvo no servidor.
   - **Tour guiado** opcional (3–6 passos) na primeira visita a cada tela principal, que pode ser reaberto pelo menu "Ajuda".
   - **Estados vazios didáticos:** toda lista vazia explica o próximo passo com um botão de ação.
   - **Central de ajuda** (manual) dentro do app em `/ajuda`, gerada do mesmo conteúdo dos
     tooltips + artigos por tarefa, com busca. Assim o manual se constrói junto com o sistema,
     sem documento separado para manter.

## 2. Contexto Técnico e Localização
- **Frontend:** `src/interface/components/help/` → `HelpTip`, `FieldHint`, `EmptyState`,
  `OnboardingChecklist`, `GuidedTour`; `src/shared/help/content.ts` = **catálogo único** de textos
  de ajuda, indexado por chave (`proposal.slug`, `package.priceMode`...). Os componentes de
  formulário recebem `helpKey` e não texto solto, o que mantém tooltips e manual em sincronia.
- `pages/HelpCenterPage.tsx` renderiza o catálogo agrupado por área + artigos `src/shared/help/articles/*.md`.
- **Backend:** `User.onboarding Json` (passos concluídos, tours vistos), `PATCH /api/me/onboarding`.
- **Novas dependências:** `@radix-ui/react-tooltip` (já instalado) e `react-markdown` (já instalado).
- **Fora do escopo:** chat de suporte, vídeos tutoriais, i18n (catálogo nasce pronto para isso, só em pt-BR).
- **Depende de:** nada estrutural; acompanha cada tela à medida que é refeita.

## 3. Regras de Negócio e Contexto Estrito
- Todo campo novo ou alterado em formulário **deve** ter `helpKey` (regra de revisão de PR).
- Texto de ajuda: no máximo 240 caracteres no tooltip; o "Saiba mais" leva ao artigo.
- Tour aparece uma vez por usuário por tela; pode ser desligado globalmente.
- Acessível: tooltip abre por foco de teclado, tem `aria-describedby` e fecha com Esc.

## 4. Limites e Casos de Borda (Fallbacks)
- Falha ao salvar o progresso do onboarding não bloqueia o uso (estado local como fallback).
- Chave de ajuda inexistente: o ícone não aparece e um aviso é emitido no console em dev.

## 5. Critérios de Aceite (Para o Test Harness)
- Teste unitário: todas as `helpKey` usadas nos formulários existem no catálogo (varredura).
- `/ajuda` lista todas as entradas do catálogo e a busca filtra por título/conteúdo.
- O checklist reflete o estado real (ex.: criar o primeiro pacote marca o passo).

---
_Changelog: 2026-10-07 — concluído. Checklist de primeiros passos no Dashboard calculado do estado real (perfil com contato e
apresentação, pacote, proposta, link compartilhado, primeira abertura) com `GET /workspaces/current/onboarding` e
`PATCH /auth/me/onboarding` (`User.onboarding`). Tours guiados sem dependência nova (destaque do elemento, Esc, setas,
uma vez por pessoa e tela; reabrir/desligar/rever todos pelo botão "Ajuda") em Dashboard, Propostas, Pacotes e Equipe.
Central de ajuda `/ajuda` com 11 artigos Markdown (`src/shared/help/articles/NN-slug.md`, tabelas via `remark-gfm`) e o
catálogo de dicas agrupado por área; busca sem acento. Todo item do catálogo tem "Saiba mais" para um artigo (teste).
Estados vazios didáticos em Propostas e Pacotes. Dashboard deixa o modelo legado "Prestadores" e mostra o perfil da empresa.
Assumido: `/api/me/onboarding` ficou em `/api/auth/me/onboarding`, junto de `/auth/me`._
