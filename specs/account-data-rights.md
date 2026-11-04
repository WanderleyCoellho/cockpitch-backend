# Spec: Baixar meus dados e excluir minha conta

Status: ✅ implementado (2026-11-04). Backend PR #7, frontend PR #8 e Ops PR #4 aguardam merge.

## 1. Comportamento Esperado (O Quê e Por Quê)
Quem usa o painel exerce sozinho dois direitos do art. 18 da LGPD:
- **acesso e portabilidade:** baixa um JSON com os dados pessoais da conta;
- **eliminação:** exclui a conta.

O dono de uma empresa com equipe decide, por empresa, entre indicar um novo dono ou encerrá-la. As propostas aceitas
por clientes continuam guardadas como comprovante.

## 2. Contexto Técnico e Localização
- **Stack/linguagem:** herdado de `specs/_context.md`.
- **Backend:**
  - Rotas em `src/routes/profile.routes.ts`, montado em `/api/me`, autenticado:
    - `GET /export`;
    - `GET /deletion`;
    - `POST /deletion/code`;
    - `DELETE /`.
  - Serviços:
    - `src/services/data-export.service.ts`;
    - `src/services/account-deletion.service.ts`;
    - `src/services/payment-grace.service.ts`, com o job `src/jobs/paymentGrace.job.ts` (hora em hora, minuto 20; desligado com Stripe não configurado).
  - Limite: `accountActionRateLimit`, 10 por 15 minutos por IP, em `export`, `deletion/code` e `DELETE`.
  - E-mails em `services/email/templates.ts`: `account_deletion_code`, `ownership_transferred` e `workspace_closed`.
  - Migration `20261104120000_account_deletion`:
    - `AccountDeletionCode`;
    - `Workspace.closedAt` e `Workspace.paymentGraceUntil`;
    - eventos `OWNERSHIP_TRANSFERRED` e `WORKSPACE_CLOSED`;
    - `Provider.userId` e `PaymentReceipt.userId` passam a ser opcionais, com `onDelete: SetNull`.
- **Frontend:**
  - `src/interface/components/AccountDataSection.tsx`, na página Equipe;
  - métodos `exportMyData`, `getAccountDeletion`, `requestAccountDeletionCode` e `deleteAccount` no `HttpGateway`;
  - aviso "Sua conta foi excluída" no login, via `location.state.notice`.
- **Ops:** rótulos dos eventos e e-mails novos em `src/lib/format.ts`.
- **Novas dependências:** nenhuma. Permissões da chave restrita do Stripe:

  | Recurso | Permissão |
  |---|---|
  | Customers | Gravação |
  | Subscriptions | **Gravação** |
  | PaymentMethods | **Gravação** |

- **Fora do escopo:**
  - exportar dados da empresa (propostas, pacotes, clientes), porque a controladora deles é a empresa;
  - reembolso proporcional ao encerrar;
  - trocar de dono sem excluir a conta.
- **Depende de:** `architecture/001-workspaces.md`, `stripe-billing.md`, `lgpd-privacy.md` (retenção).

## 3. Regras de Negócio e Contexto Estrito
1. **Exportação:**
   - inclui conta (com CPF formatado e formas de login, nunca o hash da senha), empresas e papéis, preferências de
     aviso, assinaturas feitas como empresa (`ProposalSignature` com `role=PROVIDER` e `userId`) e comprovantes de
     pagamento legados;
   - responde com `Content-Disposition: attachment` e `Cache-Control: no-store`.
2. **Confirmação da exclusão:**
   - código de 6 dígitos no e-mail da conta, guardado como hash com o `JWT_SECRET`;
   - vale 10 minutos e aceita 5 tentativas; 1 envio por minuto e 5 por hora;
   - o corpo do pedido leva `confirm: "EXCLUIR"`;
   - vale para qualquer conta, inclusive as que só entram com Google.
3. **Decisões:** são conferidas contra o estado **no momento da exclusão**, não o da tela.
   - Empresa da qual a pessoa é dona e que tem outros membros: decisão obrigatória (`DECISION_REQUIRED`).
   - Empresa da qual a pessoa é dona e que não tem outros membros: sempre encerrada.
   - Empresa onde a pessoa é ADMIN ou MEMBER: ela sai e os `Provider` criados por ela passam para o OWNER.
4. **Indicar novo dono (`TRANSFER`):**
   - **Quem pode ser:** precisa ser membro da empresa (`INVALID_NEW_OWNER`). Ele vira OWNER e os `Provider` do dono antigo passam para ele.
   - **No Stripe:**
     - todas as formas de pagamento do cliente são removidas;
     - o e-mail do cliente vira o do novo dono, e `metadata.ownerUserId` também muda;
     - a assinatura **continua**.
   - **Prazo (`paymentGraceUntil`):**
     - assinatura em dia: fim do período pago + 7 dias;
     - cobrança atrasada: agora + 7 dias;
     - cancelamento já agendado: sem prazo.
   - **Aviso:** o novo dono recebe `ownership_transferred` com o plano, a data até quando está pago, o prazo e um link para `/analytics`.
   - **Job de prazo, quando `paymentGraceUntil` vence:**
     - sincroniza com o Stripe;
     - se não estiver ACTIVE, cancela a assinatura (`subscriptions.cancel`) e sincroniza de novo, e a empresa vai para o Grátis;
     - em qualquer caso, apaga `paymentGraceUntil`.
5. **Encerrar (`CLOSE`):**
   - **Stripe:** apaga o cliente (`customers.del`), o que cancela a assinatura na hora e remove os cartões.
   - **Equipe:** os membros perdem o vínculo e recebem `workspace_closed`. No próximo acesso caem em
     `CreateWorkspacePage` e criam uma empresa nova no Grátis.
   - **O que fica:** propostas com resposta `ACCEPTED`, com a resposta aceita e as assinaturas, mais os `Provider` e
     `Package` ligados a elas. O link público continua abrindo o comprovante.
   - **O que sai:**
     - propostas sem aceite;
     - respostas de recusa ou ajuste;
     - visualizações;
     - pacotes sem vínculo;
     - modelos, blocos salvos e convites.
   - **Registro:** o workspace fica com `closedAt`, plano FREE, `billingStatus=CANCELED` e IDs do Stripe nulos,
     mais o evento `WORKSPACE_CLOSED { keptProposals }`.
   - Sem nenhuma proposta aceita, o workspace é apagado inteiro.
6. **A conta em si:**
   - e-mails PENDING para ela são apagados; os demais ficam sem `to` e `payload`;
   - `SignatureCode` com o e-mail dela são apagados;
   - o `User` é apagado, o que leva memberships, códigos e confirmações Google;
   - `ProposalSignature` feitas por ela ficam como evidência (art. 16, II, e art. 7º, VI).
7. **Ordem de execução:**
   1. confere o código;
   2. **Stripe**: transferências primeiro, depois encerramentos;
   3. **uma** transação no banco, com timeout de 30 segundos.

   Se o Stripe falhar, a resposta é 502 `BILLING_UNAVAILABLE` e nada é apagado no banco (o código já foi consumido;
   pede-se outro). O contrário deixaria uma assinatura cobrando o cartão de quem saiu.
- Assumido: um erro do Stripe no meio de várias empresas pode deixar as anteriores já alteradas no Stripe e o banco
  intacto. Repetir é seguro: um cliente que já não existe é tratado como sucesso, e a remoção de cartões e a
  atualização do cliente podem ser refeitas.

## 4. Limites e Casos de Borda (Fallbacks)
- Dois envios simultâneos: o código só é consumido uma vez (`updateMany` com `usedAt: null`).
- Token antigo depois da exclusão: `requireAuth` não acha o usuário e responde 401.
- Comprovante de pagamento legado de uma conta excluída: aprovar no Ops responde 409 `USER_DELETED`.
- Empresa em cortesia (`licensePolicy=COURTESY`): a transferência não mexe no Stripe; o encerramento apaga o cliente,
  se houver.
- Falha do job de prazo numa empresa: registra no log `[cobranca]` e segue para as outras; tenta de novo na hora
  seguinte.

## 5. Critérios de Aceite (Para o Test Harness)
**Integração (Postgres real + `tests/stripeFake.ts`), `tests/account-deletion.test.ts`:**
- exportação com os campos, sem o hash da senha, como anexo; 401 sem login;
- sem decisão, sem "EXCLUIR" ou com código errado: nada é apagado;
- dono sozinho com proposta aceita:
  - a empresa é encerrada e só a proposta aceita fica, com a resposta ACCEPTED, as assinaturas e sem visualizações;
  - o `Provider` fica com `userId` nulo;
  - o link público responde 200;
  - o token antigo responde 401;
- dono sozinho sem proposta aceita: a empresa e o perfil saem inteiros;
- encerramento com equipe: o cliente Stripe é apagado, a assinatura cancelada, o membro fica com `workspaces: []` e recebe `workspace_closed`;
- transferência em dia:
  - o novo dono vira OWNER e o `Provider` é reatribuído;
  - a assinatura continua ativa, o cartão é removido e o e-mail do cliente muda;
  - o prazo é o fim do período + 7 dias;
  - sai o e-mail `ownership_transferred`;
- transferência com cobrança atrasada: prazo de agora + 7 dias;
- novo dono de fora da empresa: `INVALID_NEW_OWNER`;
- membro que sai: o `Provider` dele passa para o dono e a empresa continua;
- Stripe com falha: 502 e nada é apagado;
- código já usado: `CODE_EXPIRED`;
- job de prazo:
  - vencido e atrasado: cancela e vai para o Grátis;
  - vencido e em dia: só apaga o prazo;
  - prazo no futuro: intocado.

**Manual:** o diálogo em Equipe, com uma empresa assinante (troca de dono) e uma com equipe (encerrar), no navegador.

---
_Changelog: 2026-11-04 — criada junto com a implementação (decisões do produto: novo dono ou encerrar; 7 dias para
regularizar; guardar só as propostas aceitas)._
