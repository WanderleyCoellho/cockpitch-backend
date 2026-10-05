# Arquitetura: Storage de objetos (Railway Buckets, S3-compatível)

## 1. Motivação e Problema Atual
`upload.routes.ts` e `payment-receipt.routes.ts` gravam em `uploads/` no disco do container.
No Railway esse disco é efêmero: tudo some a cada deploy. Os comprovantes já foram tirados do
diretório público na Fase 0, mas continuam sem persistência.

## 2. Decisão
- **Railway Buckets** (S3-compatível, roda sobre Tigris). Escolhido no lugar do Cloudflare R2
  em 2026-10-05: mesmo preço de armazenamento (US$ 0,015/GB-mês), saída e operações grátis, e
  nenhuma conta ou configuração externa para o dono do produto. Fica no mesmo projeto do Railway,
  com credenciais injetadas por variável de referência.
- Interface `StorageDriver` (`put`, `getSignedReadUrl`, `delete`) em `src/lib/storage/`, com as
  implementações `S3StorageDriver` (Railway Buckets; também serve para R2/S3 se precisar migrar) e
  `LocalStorageDriver` (dev/teste). A escolha é feita por `STORAGE_DRIVER=s3|local`.
- **Buckets do Railway são sempre privados** (não há bucket público). Por isso:
  - **Mídia pública** (fotos/vídeos de proposta e perfil): o banco guarda a **chave** do objeto e
    a API expõe `GET /media/:key`, que responde **302 para uma URL pré-assinada** válida por 1 h
    (`Cache-Control: private, max-age=3000`). O link salvo nas propostas nunca expira; só o redirect
    é temporário. Como a saída do bucket é grátis, o vídeo não passa pelo servidor.
  - **Privado** (comprovantes): só pela rota autenticada do Ops, com URL pré-assinada de 5 min.
- Cada upload grava `Upload { id, workspaceId, key, mime, size, visibility }` para controle de cota
  por plano (Grátis 0,5 GB · Essencial 5 GB · Profissional 20 GB · Equipe 100 GB) e limpeza de órfãos.
  **Adiado para a etapa de Workspaces** (a cota é por workspace, que ainda não existe).

## 3. Escopo do Impacto
`upload.routes.ts`, `payment-receipt.routes.ts`, `internal.routes.ts`, `app.ts` (nova rota
`/media/:key`; o static `/uploads` permanece só para o driver local e URLs legadas),
`trustedUploadUrl.ts` (aceita `/media/`). Frontend: sem mudança de contrato (`file_url`).

## 4. Plano de Migração
1. Driver local com os comprovantes fora do diretório público (feito na Fase 0).
2. Driver S3 + `/media/:key` atrás da env; em produção, `STORAGE_DRIVER=s3`.
3. Se houver arquivos antigos em volume, um script único copia para o bucket e reescreve as URLs.

## 5. Nova Tecnologia/Dependências
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
- Alternativas descartadas: Cloudflare R2 (exige conta e configuração externa sem ganho de custo);
  volume do Railway (não escala horizontalmente, US$ 0,15/GB).

## 6. Critérios de Aceite de Infraestrutura
- Upload de imagem → `file_url` em `/media/...` → GET responde 302 → a URL assinada responde 200.
- Comprovante: sem sessão Ops → 401; com sessão → 302 para URL assinada de curta duração.
- Um redeploy no Railway não perde arquivos.

## 7. Riscos e Rollback
- Sem backup automático de bucket no Railway: job semanal de cópia para outro bucket (fase futura).
- Upload grande (vídeo de 100 MB) passa pelo backend (custa saída de serviço US$ 0,05/GB) → v2: upload direto por URL pré-assinada.
- Rollback: `STORAGE_DRIVER=local`.

## Variáveis (injetadas pelo Railway por referência ao bucket)
`STORAGE_DRIVER=s3`, `S3_ENDPOINT=${{bucket.ENDPOINT}}`, `S3_REGION=${{bucket.REGION}}`,
`S3_BUCKET=${{bucket.BUCKET}}`, `S3_ACCESS_KEY_ID=${{bucket.ACCESS_KEY_ID}}`,
`S3_SECRET_ACCESS_KEY=${{bucket.SECRET_ACCESS_KEY}}`.

---
_Changelog: 2026-10-05 — implementado (drivers local/S3, `/media/*`, comprovantes em `private/`, healthcheck do storage). Tabela `Upload`/cota adiada para Workspaces._
