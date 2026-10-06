# Spec: Entrar e cadastrar com Google

## 1. Comportamento Esperado (O Quê e Por Quê)
Qualquer pessoa pode criar conta ou entrar com a conta Google (Gmail ou Google Workspace), sem senha.
Reduz atrito no cadastro e o esquecimento de senha. Convites de equipe também aceitam Google.

## 2. Contexto Técnico e Localização
- **Frontend:** botão oficial do Google Identity Services (`accounts.google.com/gsi/client`, modo popup) em
  login, cadastro e convite. O botão só aparece quando o servidor informa um Client ID.
- **Backend:** `GET /api/auth/google/config` e `POST /api/auth/google`; `lib/googleIdToken.ts` valida o ID token com
  `google-auth-library` (assinatura, emissor, validade, audiência = `GOOGLE_CLIENT_ID`).
- **Dados:** `User.googleSub` (único) e `User.passwordHash` opcional.

## 3. Regras de Negócio
- Só e-mails verificados pelo Google (`email_verified`).
- Conta já vinculada (`googleSub`) ou com o mesmo e-mail: entra e vincula; a senha, se existir, continua valendo.
- Outra conta Google tentando o mesmo e-mail já vinculado → 409.
- Gmail sem conta e sem dados da empresa/convite → 404 `GOOGLE_ACCOUNT_NOT_FOUND` com nome e e-mail do Google;
  a tela de cadastro pede só empresa e segmento.
- Convite: o e-mail do Google precisa ser o do convite.
- Conta só Google não entra por senha (mesma resposta genérica de credencial inválida).
- Rate limit de autenticação (10 por 15 min por IP).

## 4. Configuração
`GOOGLE_CLIENT_ID` no Railway (Client ID OAuth "Aplicativo da Web" com as origens JavaScript autorizadas
`https://deal.lumendevstudios.com` e `http://localhost:5173`). Vazio = recurso desligado, sem erro.

## 5. Critérios de Aceite
- Testes de integração com o validador simulado: cadastro, vinculação, conflito, e-mail não verificado, token inválido,
  convite (conta nova e existente) — `tests/google*.test.ts`.

---
_Changelog: 2026-10-07 — implementado (backend + frontend + Ops mostra como cada pessoa entra)._
