# Spec: Entrar e cadastrar com Google

## 1. Comportamento Esperado (O Quê e Por Quê)
Qualquer pessoa pode criar conta ou entrar com a conta Google (Gmail ou Google Workspace).
**No primeiro login com Google**, ela precisa confirmar o e-mail e criar uma senha pelo link enviado. Isso vale para
conta nova e para conta que já existia com senha no mesmo e-mail.
Reduz atrito no cadastro e o esquecimento de senha. Convites de equipe também aceitam Google.

## 2. Contexto Técnico e Localização
- **Frontend:** botão oficial do Google Identity Services (`accounts.google.com/gsi/client`, modo popup) em
  login, cadastro e convite. O botão só aparece quando o servidor informa um Client ID.
- **Backend:** `GET /api/auth/google/config` e `POST /api/auth/google`; `lib/googleIdToken.ts` valida o ID token com
  `google-auth-library` (assinatura, emissor, validade, audiência = `GOOGLE_CLIENT_ID`).
- **Dados:**
  - `User.googleSub` (único), `User.passwordHash` opcional e `User.sessionsValidAfter`;
  - `GoogleSignupConfirmation`: `tokenHash`, `email`, `googleSub`, `name`, `userId?`, `workspaceName?`, `segment?`,
    `inviteId?`, `expiresAt`, `usedAt?`.
- **Confirmação:** `src/services/google-signup.service.ts` (`requestGoogleConfirmation`, `describeGoogleConfirmation`,
  `confirmGoogleSignup`):
  - rotas `GET|POST /api/auth/google/confirm/:token`;
  - e-mail `google_confirm`;
  - tela `/confirmar-conta[/:token]` (`ConfirmAccountPage.tsx`).

## 3. Regras de Negócio
- Só e-mails verificados pelo Google (`email_verified`).
- Conta já vinculada (`googleSub`): entra direto.
- **Primeiro login com Google** (conta nova, ou conta com senha no mesmo e-mail):
  - responde 202 `GOOGLE_CONFIRMATION_SENT` e manda um link;
  - ninguém entra até abrir o link e criar a senha;
  - o link vale 24 horas, com espera de 60 segundos entre envios e no máximo 5 por hora;
  - o token é guardado só como hash SHA-256.
- Ao vincular uma conta que já existia, a senha anterior é trocada e `sessionsValidAfter` derruba as sessões abertas.
  Isso fecha a tomada de conta de quem cadastrou antes, com senha, o e-mail de outra pessoa.
- `requireAuth` recusa token emitido antes de `sessionsValidAfter` e token sem `userId`.
- Outra conta Google tentando o mesmo e-mail já vinculado → 409.
- Gmail sem conta e sem dados da empresa/convite → 404 `GOOGLE_ACCOUNT_NOT_FOUND` com nome e e-mail do Google;
  a tela de cadastro pede só empresa e segmento.
- Convite: o e-mail do Google precisa ser o do convite.
- Conta antiga só com Google (criada antes da confirmação) não entra por senha: recebe a mesma resposta genérica de credencial inválida.
- Rate limit de autenticação (10 por 15 min por IP).

## 4. Configuração
`GOOGLE_CLIENT_ID` no Railway (Client ID OAuth "Aplicativo da Web" com as origens JavaScript autorizadas
`https://deal.lumendevstudios.com` e `http://localhost:5173`). Vazio = recurso desligado, sem erro.

## 5. Critérios de Aceite
- Testes de integração com o validador simulado, em `tests/google*.test.ts`:
  - cadastro e vinculação **pelo link** (202, depois confirmar e entrar);
  - sessões antigas derrubadas;
  - limites de envio;
  - link vencido ou usado;
  - conflito;
  - e-mail não verificado;
  - token inválido;
  - convite (conta nova e existente).

---
_Changelog:_
- 2026-10-07: implementado (backend + frontend + Ops mostra como cada pessoa entra).
- 2026-11-03: o primeiro login com Google passa a exigir confirmação por e-mail e criação de senha para todas as
  contas, com revogação de sessões ao vincular (backend PR #2, frontend PR #2).
