# Processo: Fundação — estabilidade e segurança (Fase 0)

## Situação Atual
Achados da análise de 2026-10-05:
1. Handlers `async` sem captura no Express 4: qualquer erro do Prisma (ex.: `slug` duplicado,
   P2002) vira uma rejeição não tratada e **derruba o processo** no Node 20.
2. `Dockerfile` roda `npm install --omit=dev` e depois `npm run build`. `typescript`/`prisma` são devDependencies, então o build falha.
3. XSS armazenado: `ProposalPublicPage.tsx` renderiza `provider.aboutText` com `dangerouslySetInnerHTML` sem sanitizar.
4. Comprovantes servidos publicamente em `/uploads/receipts/*` com CORS `*`.
5. `packageIds` de proposta é aceito sem checar se os pacotes pertencem ao usuário (IDOR).
6. `mapPlanTier` deduz o plano procurando "starter/pro/agency" dentro do `priceId` do Stripe; IDs reais não contêm isso.
7. Endpoint público expõe todas as `views` (com `sessionId`) e o `userId` do provider.
8. Login/registro/Ops login sem limite de tentativas; senha Ops comparada com `!==`.
9. Erros de typecheck no frontend (`sectionsConfig` ausente no tipo `Proposal`).
10. `redirectToCheckout` do Stripe.js está descontinuado; o backend já pode devolver a `url` da sessão.
11. Ausência de `.env.example` (citado no README) e de testes/CI.

## Problema/Risco
1, 3, 4 e 5 são riscos de produção imediatos (indisponibilidade, roubo de sessão, vazamento de
dado financeiro, vazamento entre clientes). 2 e 6 impedem o deploy e a cobrança de funcionar.

## Prática Recomendada
- `asyncHandler` aplicado a todas as rotas + tradução de erros conhecidos do Prisma
  (P2002 → 409, P2025 → 404) no `errorHandler`; `process.on('unhandledRejection')` registra o erro sem derrubar o processo.
- Dockerfile multi-stage (deps completas para o build; runtime só com produção + Prisma CLI para migrar).
- Sanitização de HTML na renderização (frontend) **e** na escrita (backend).
- Comprovantes fora do diretório estático público; leitura apenas por rota autenticada do Ops.
- Validar a posse de cada `packageId`.
- Mapa explícito `STRIPE_PRICE_<TIER>` → tier via env; o checkout aceita só preços mapeados.
- Endpoint público retorna um DTO enxuto (sem `views`, sem `userId`).
- Rate limit em memória por IP nos endpoints de autenticação (`express-rate-limit`); comparação em tempo constante.
- Checkout devolve `url`; o frontend redireciona com `window.location`.
- `.env.example` completo; testes com Vitest + Supertest para as regras críticas; workflow de CI (typecheck + test + build).

## Plano de Adoção
Um PR por repositório, sem mudança de contrato visível ao usuário, exceto:
- O checkout passa a retornar `{ sessionId, url }` (aditivo).
- O endpoint público deixa de retornar `views` (o frontend não usa).

## Critérios de Aceite
- `POST /api/proposals` com `slug` repetido → 409 e o processo continua de pé (teste).
- `packageIds` de outro usuário → 403 (teste).
- `GET /uploads/receipts/<arquivo>` → 404.
- `mapPlanTier('price_abc')` com `STRIPE_PRICE_PRO=price_abc` → `PRO` (teste).
- 11ª tentativa de login em 15 min pelo mesmo IP → 429 com `Retry-After`.
- `docker build` conclui; frontend `typecheck`, `lint` e `build` sem erros.
