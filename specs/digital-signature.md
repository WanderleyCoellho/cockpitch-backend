# Spec: Assinatura eletrônica da proposta (empresa e cliente)

## 1. Comportamento esperado

A proposta e o comprovante levam duas assinaturas: a da empresa e a do cliente.

- **Empresa:** assina ao publicar. Quem está no painel informa o CPF, desenha ou digita a assinatura e confirma com um código de 6 dígitos enviado ao e-mail da conta. A assinatura e o CPF ficam salvos no perfil para as próximas propostas.
- **Cliente:** assina no aceite. Ele informa nome, e-mail e CPF, desenha ou digita a assinatura e confirma com o código enviado ao e-mail dele.
- **Assinatura digitada:** o nome vira assinatura numa fonte manuscrita. Mesmo assim, CPF e código continuam obrigatórios (como no gov.br e no Autentique).

## 2. Contexto técnico

Modelos:

- `ProposalSignature`
  - campos: `role` (PROVIDER | CLIENT), `userId?`, `responseId?`, nome, e-mail, CPF (só dígitos), `signerTitle?`, `method` (DRAWN | TYPED), `image?` (PNG em data URL), `typedText?`;
  - evidência: `contentHash` (SHA-256 do conteúdo assinado), `emailVerifiedAt`, IP, user agent e data.
- `SignatureCode`: só o hash do código, `attempts`, `expiresAt` e `usedAt`.
- `User.savedSignature` e `User.cpf`.

Rotas:

| Rota | Para que serve |
| --- | --- |
| `POST /api/proposals/:id/signature/code` | Envia o código ao e-mail da conta |
| `POST /api/proposals/:id/signature` | A empresa assina |
| `GET /api/proposals/:id/signatures` | Painel, com a evidência completa |
| `GET/PUT/DELETE /api/me/signature` | Assinatura salva no perfil |
| `POST /api/public/proposals/:slug/signature-code` | Envia o código ao cliente |
| `POST /api/public/proposals/:slug/responses` | Com `type=ACCEPTED`, exige `signerDocument` (CPF), `signature` e `code` |
| `GET /api/public/proposals/:slug` | Devolve `signatures` (CPF mascarado, sem e-mail e sem IP) |

## 3. Regras

- **CPF:** dígitos verificadores conferidos. Não há consulta à Receita.
- **Código:**
  - 6 dígitos, vale 10 minutos;
  - 5 tentativas por código;
  - 1 código por minuto e 5 por hora para o mesmo e-mail e proposta;
  - guardado só como hash;
  - uso único (corrida resolvida no `updateMany where usedAt null`).
- **Imagem desenhada:** só PNG (cabeçalho conferido), até 200 KB.
- **Conteúdo assinado pela empresa:** blocos + pacotes. Editar a proposta depois de assinar deixa a assinatura `current=false`, e o painel pede uma nova assinatura. A mesma versão não é assinada duas vezes (`409 ALREADY_SIGNED`).
- **Conteúdo assinado pelo cliente:** o mesmo `contentHash` do aceite (inclui a escolha de pacote e opcionais). Assinatura e aceite são gravados na mesma transação.
- **Assinatura da empresa não é obrigatória para o cliente aceitar.** Propostas antigas continuam funcionando, e o comprovante mostra "assinatura da empresa pendente".
- **Rate limit das respostas:** subiu de 5 para 10 por hora por IP e proposta, porque errar o código também conta.

## 4. Valor jurídico (texto para a ajuda)

É uma assinatura eletrônica com evidências, válida entre as partes que a aceitam (MP 2.200-2/2001, art. 10, § 2º, e Lei 14.063/2020). As evidências são:

- CPF;
- e-mail confirmado por código;
- IP;
- data e hora;
- código SHA-256 do conteúdo.

**Não é** assinatura qualificada com certificado ICP-Brasil.

## 5. Critérios de aceite

Os testes estão em `tests/signature.test.ts`:

- aceite com código, CPF e assinatura;
- tentativas e travamento do código;
- código vencido;
- espera entre códigos;
- assinatura da empresa, perfil e nova assinatura depois de editar;
- isolamento entre empresas;
- página pública sem e-mail e sem CPF completo.
