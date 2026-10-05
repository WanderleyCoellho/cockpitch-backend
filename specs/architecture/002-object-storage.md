# Arquitetura: Storage de objetos (Cloudflare R2 / S3)

## 1. Motivação e Problema Atual
`upload.routes.ts` e `payment-receipt.routes.ts` gravam em `uploads/` no disco do container.
No Railway esse disco é efêmero: tudo some a cada deploy. Além disso, `/uploads` é servido
estático com `Access-Control-Allow-Origin: *`, o que deixa os **comprovantes de pagamento
públicos** para quem souber ou adivinhar a URL.

## 2. Decisão
- Interface `StorageDriver` (`put`, `getSignedReadUrl`, `delete`, `publicUrl`) em `src/lib/storage/`.
- Implementações: `S3StorageDriver` (R2 é compatível com S3) e `LocalStorageDriver` (dev/teste).
  A escolha é feita por `STORAGE_DRIVER=s3|local`.
- Dois "espaços":
  - **public** (mídia de proposta/perfil): bucket público ou domínio de CDN do R2. A URL é estável.
  - **private** (comprovantes e, futuramente, PDFs assinados): nunca expostos. A leitura é feita
    por URL assinada de curta duração (5 min) gerada por endpoint autenticado.
- O banco guarda a **chave do objeto** (`storageKey`), não a URL absoluta. A URL é derivada na
  leitura, o que permite trocar de domínio/CDN sem migrar dados.
- A validação de "URL confiável" (`trustedUploadUrl.ts`) passa a aceitar o domínio público configurado.
- Cada upload grava `Upload { id, workspaceId, key, mime, size, visibility }` para controle de
  cota por plano e limpeza de órfãos.

## 3. Escopo do Impacto
`upload.routes.ts`, `payment-receipt.routes.ts`, `internal.routes.ts` (o Ops abre o comprovante
via URL assinada), `app.ts` (o static `/uploads` fica restrito ao driver local e, mesmo nele,
sem servir `receipts/`), frontend (sem mudança de contrato: continua recebendo `file_url`).

## 4. Plano de Migração
1. Entregar o driver local com os comprovantes **fora** do diretório público (a Fase 0 já faz isso).
2. Adicionar o driver S3 atrás da env; em produção, configurar o R2 e virar a chave.
3. Script único copia os arquivos existentes (se houver volume) para o bucket e reescreve as URLs.

## 5. Nova Tecnologia/Dependências
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`: SDK oficial que funciona com R2, S3 e MinIO.
- Alternativas descartadas: volume do Railway (não escala horizontalmente, sem CDN);
  Cloudinary (caro para vídeo, aprisiona no fornecedor).

## 6. Critérios de Aceite de Infraestrutura
- Com `STORAGE_DRIVER=s3` e credenciais do R2, um upload de imagem retorna uma URL pública
  acessível e um comprovante retorna 404 em acesso público e 200 via URL assinada.
- Um redeploy no Railway não perde arquivos.

## 7. Riscos e Rollback
- Custo de egress: o R2 não cobra. Upload grande (vídeo de 100 MB) passa pelo backend → v2:
  upload direto ao bucket por URL pré-assinada.
- Rollback: `STORAGE_DRIVER=local`.

## Variáveis necessárias (fornecidas pelo dono do projeto)
`S3_ENDPOINT`, `S3_REGION` (=`auto` no R2), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_BUCKET_PUBLIC`, `S3_BUCKET_PRIVATE`, `S3_PUBLIC_BASE_URL`.
