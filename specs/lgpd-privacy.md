# Spec: Privacidade e LGPD (política, cookies e retenção de dados)

Status: ✅ implementado (2026-11-03) — backend PR #6, frontend PRs #6 e #7.

## 1. Comportamento Esperado (O Quê e Por Quê)
O Lumen Deal trata dados de dois públicos: quem usa o painel (empresas e suas equipes) e os clientes finais que
abrem e respondem propostas. A plataforma precisa:
- explicar, em linguagem simples, o que trata, por quê, com quem compartilha, por quanto tempo e como exercer
  direitos (LGPD, arts. 6º, 9º e 18);
- não colocar cookies de rastreamento em quem abre uma proposta;
- apagar sozinha o que só serve por pouco tempo (LGPD, arts. 15 e 16).

## 2. Contexto Técnico e Localização
- **Stack/linguagem:** herdado de `specs/_context.md`.
- **Frontend:**
  - Política e termos: `src/interface/pages/LegalPages.tsx`, nas rotas `/privacidade` e `/termos`.
    - `PRIVACY_CONTACT` é o canal do encarregado.
    - `UPDATED_AT` guarda a data da versão.
    - `BROWSER_STORAGE` é a tabela de armazenamento no navegador.
  - Aviso ao cliente final: `components/proposal/blocks/AcceptanceBlock.tsx`, em todos os modos de resposta.
  - Rodapé "Privacidade": `BlockProposalPage.tsx` e `ProposalPublicPage.tsx`. Aparece mesmo quando a marca Lumen Deal está oculta.
  - Embeds de vídeo: `shared/media.tsx`. YouTube usa `youtube-nocookie.com`; Vimeo usa `?dnt=1`. Teste em `src/shared/__tests__/embed.test.ts`.
  - CSP: `vercel.json`, em modo **Report-Only**; o `frame-src` libera `www.youtube-nocookie.com` e `player.vimeo.com`.
- **Backend:**
  - Retenção: `src/services/data-retention.service.ts` (`runDataRetention`, `RETENTION_DAYS`).
  - Job: `src/jobs/dataRetention.job.ts`.
- **Novas dependências:** nenhuma.
- **Fora do escopo:**
  - banner de consentimento (só existe armazenamento necessário; ver regra 3);
  - uso de dados para treinar IA (ver regra 7).
- **Depende de:** `email-notifications.md`, `digital-signature.md`, `google-sign-in.md`.

## 3. Regras de Negócio e Contexto Estrito
1. **Papéis:**
   - Nos dados de quem usa o painel, o Lumen Deal é **controlador**.
   - Nos dados dos clientes finais coletados pelas propostas, a empresa é a controladora e o Lumen Deal é **operador**.
   - Os termos (seção "Dados dos seus clientes") dizem que o operador trata esses dados só para prestar o serviço,
     nunca para fins próprios, e listam sigilo, fornecedores, segurança, aviso de incidente, apoio aos pedidos dos
     titulares e exclusão no encerramento.
2. **Página pública:**
   - mostra nome, assinatura e CPF parcialmente oculto de quem aceitou;
   - e-mail, IP e CPF completo ficam só no painel da empresa.
3. **Cookies e armazenamento:** só armazenamento estritamente necessário:
   - `auth_token` (localStorage, 7 dias);
   - `lumen_active_workspace`;
   - `lumen-deal:block-tips-hidden`;
   - `lumen_google_pending` (sessionStorage);
   - cookie `ops_access_token` (HttpOnly, 12h, só no Ops).

   Pela LGPD e pelo guia de cookies da ANPD, isso dispensa consentimento; basta informar na tabela.
   Qualquer analytics ou pixel de terceiros exige, **antes de entrar**, banner com opção de recusar e carregamento só
   depois do aceite.
4. **Vídeos de terceiros** nas propostas sempre em modo sem cookies de rastreamento. Uma URL `/embed/` colada pela
   empresa também é remontada.
5. **Retenção.** O job roda todo dia às 06:15 UTC (`DATA_RETENTION_CRON`) e também 1 minuto depois da subida.
   `DATA_RETENTION_ENABLED=false` desliga.

   | Dado | Regra |
   |---|---|
   | `SignatureCode` | apagado 2 dias após a criação |
   | `GoogleSignupConfirmation` | apagada 7 dias após vencer |
   | `WorkspaceInvite` não aceito | apagado 30 dias após vencer |
   | `AccountDeletionCode` | apagado 2 dias após a criação |
   | E-mails com código ou link (`signature_code`, `google_confirm`, `account_deletion_code`, `team_invite`) | apagados de vez após 2, 2, 2 e 8 dias, em qualquer status |
   | Demais e-mails não pendentes com mais de 90 dias | `to`, `payload` e `lastError` esvaziados; a linha fica |
   | `StripeEventLog` | apagado após 90 dias |
   | Workspace com `closedAt` há mais de 5 anos | apagado inteiro, em cascata |

6. **Por que os e-mails comuns são esvaziados e não apagados:** o `dedupeKey` é o que garante que avisos de "uma vez
   só" não se repitam, por exemplo `opened:<proposalId>:<userId>`. Apagar a linha reenviaria o aviso.
7. **IA:** a plataforma não treina modelos com conteúdo de clientes, nem por cláusula nos termos.
   - Se um recurso de IA entrar, o caminho recomendado é contexto por requisição com os dados da própria empresa,
     num provedor que não treine com dados de API, mais estatísticas agregadas e anonimizadas.
   - Treino, se um dia existir, exige opt-in por empresa, dados pessoais removidos e RIPD.
   - A política e os termos precisam ser atualizados antes, com o provedor como fornecedor e a transferência internacional.
8. Qualquer prazo mudado em `RETENTION_DAYS` precisa mudar também na seção 6 da política, e vice-versa.
- Assumido: 5 anos para os comprovantes de empresa encerrada, pela prescrição do CC, art. 206, §5º, I. Pendente de
  revisão jurídica.

## 4. Limites e Casos de Borda (Fallbacks)
- E-mail pendente comum nunca é tocado (pode estar em nova tentativa). E-mail pendente com segredo vencido é
  apagado, porque o segredo já não vale.
- Rodar o job duas vezes, ou em duas instâncias, não causa problema: só apaga o que passou do prazo, e o
  esvaziamento ignora linhas já vazias.
- Falha do job vai para o log `[retencao]` e não derruba a API; a próxima rodada tenta de novo.

## 5. Critérios de Aceite (Para o Test Harness)
- **Integração (Postgres real), `tests/retention.test.ts`:** para cada regra da tabela, um registro vencido some e
  um recente fica. Cobre também:
  - pendentes intocados;
  - idempotência do esvaziamento;
  - "cliente abriu a proposta" não reenviado depois da limpeza;
  - empresa encerrada há mais de 5 anos apagada com as propostas.
- **Unidade (frontend), `embed.test.ts`:** URLs do YouTube e Vimeo, inclusive `/embed/`, saem nos domínios ou
  parâmetros sem rastreamento.
- **Manual:**
  - a página pública mostra o link "Privacidade" com e sem a marca;
  - o bloco de aceite mostra o aviso em todos os modos;
  - o console do navegador não acusa violações da CSP Report-Only antes de ela virar obrigatória.

---
_Changelog:_
- 2026-11-03: criada documentando o que foi implementado.
- 2026-11-04: adicionadas a regra de IA e as regras 5 e 8 ligadas à exclusão de conta (`account-data-rights.md`).
