# Spec: Itens com preço calculado

## 1. Comportamento Esperado (O Quê e Por Quê)
Hoje `Package.price` é texto livre ("R$ 3.500" ou "a partir de...") e `PackageItem` é só um nome.
Empresas de qualquer segmento precisam montar orçamentos com quantidade, valor unitário,
desconto e total calculado, além de oferecer **opcionais** que o cliente liga/desliga na página
pública, com o total atualizado ao vivo.

## 2. Contexto Técnico e Localização
- **Stack:** herdada de `_context.md`.
- **Camadas:** Prisma (colunas novas), `services/pricing.ts` (cálculo puro, compartilhado com o
  frontend por cópia do módulo em `src/shared/pricing.ts`), rotas `package.routes.ts` / `package-item.routes.ts`.
- **Padrões:** valores monetários em **centavos (Int)**; nunca `float`.
- **Novas dependências:** nenhuma (formatação via `Intl.NumberFormat`).
- **Fora do escopo:** impostos/notas fiscais, parcelamento com juros, multimoeda na mesma proposta.
- **Depende de:** `architecture/001-workspaces.md` (moeda do workspace) e `architecture/003-proposal-blocks.md` (bloco `pricing`).

## 3. Regras de Negócio e Contexto Estrito
- `PackageItem` ganha `description?`, `quantity` (Decimal 10,2, default 1), `unit` (ex.: "h",
  "un", "diária"), `unitPriceCents` (Int, default 0), `kind` (`INCLUDED` | `OPTIONAL` | `COURTESY`).
  `isCourtesy` é migrado para `kind=COURTESY`.
- `Package` ganha `priceMode` (`SUM_OF_ITEMS` | `FIXED` | `ON_REQUEST`), `fixedPriceCents?`,
  `discountType` (`NONE` | `PERCENT` | `AMOUNT`), `discountValue` (Int: basis points ou centavos).
- Total = (FIXED ? fixed : Σ quantity×unitPrice dos itens INCLUDED) + Σ OPTIONAL selecionados − desconto. COURTESY mostra o valor riscado e soma 0.
- Desconto nunca deixa o total negativo; o arredondamento é sempre para o centavo mais próximo (half-up).
- `price` (texto) fica como "rótulo de exibição" opcional (`priceLabel`) para quem não quer cálculo.
- Assumido: o cliente final só seleciona opcionais e escolhe um pacote entre os oferecidos; não edita quantidades.

## 4. Limites e Casos de Borda (Fallbacks)
- Máx. 100 itens por pacote; `quantity` entre 0,01 e 10.000; `unitPriceCents` ≤ 1.000.000.000 (R$ 10 milhões).
  Assumido: limites reduzidos em relação ao rascunho para que quantidade × valor caiba em inteiro seguro do JavaScript (< 2^53) sem biblioteca de números grandes.
- `ON_REQUEST` exibe "Sob consulta" e não entra em totais.
- Legado: pacotes sem itens precificados continuam exibindo `price` (texto).

## 5. Critérios de Aceite (Para o Test Harness)
- Unidade: `calculatePackageTotal` para os 3 modos, os 3 tipos de desconto, cortesia e opcionais (≥ 10 casos, incluindo arredondamento).
- Integração: POST de item com `unitPriceCents` negativo → 400.
- O frontend exibe o total recalculado ao ligar um opcional na página pública sem nova requisição.

---
_Changelog: 2026-10-06 — backend implementado: `services/pricing.ts` (módulo puro, cópia no frontend), migração com backfill (preço em texto → `fixedPriceCents`; texto não numérico → ON_REQUEST com rótulo; `isCourtesy` → `kind`), `price` legado recalculado a cada alteração, `pricing` nas respostas de pacotes e propostas._
