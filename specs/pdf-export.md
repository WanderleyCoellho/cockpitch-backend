# Spec: Exportar proposta em PDF

## 1. Comportamento Esperado (O Quê e Por Quê)
O prestador (no painel) e o cliente (na página pública) baixam a proposta em PDF, com layout
fiel aos blocos e ao tema, para enviar por anexo, imprimir ou arquivar. Após o aceite, o PDF
inclui a página de **comprovante de aceite** (nome, e-mail, data/hora, IP, hash).

## 2. Contexto Técnico e Localização
- **Abordagem v1 (cliente):** rota de impressão `/p/:slug/print` no frontend, com CSS `@media print`
  dedicado (quebras de página por bloco, vídeos substituídos por pôster/thumbnail, carrosséis
  expandidos). O botão "Baixar PDF" abre o diálogo de impressão do navegador ("Salvar como PDF").
  Custo zero de infraestrutura.
- **v2 (servidor, para anexar em e-mail):** serviço de render com Chromium headless (Playwright)
  numa fila → ver futura spec de arquitetura. Não entra agora.
- **Camadas:** frontend `pages/ProposalPrintPage.tsx` reutilizando os renderers de bloco com `mode="print"`.
- **Novas dependências:** nenhuma (`jspdf`/`html2canvas` já instalados são descartados por gerar PDF rasterizado, sem texto selecionável).
- **Fora do escopo:** edição do PDF, assinatura digital no arquivo.
- **Depende de:** `architecture/003-proposal-blocks.md`.

## 3. Regras de Negócio e Contexto Estrito
- O PDF reflete a seleção atual do cliente (pacote/opcionais) e o total calculado.
- O cabeçalho/rodapé leva a marca do workspace, a validade e a paginação.
- Plano FREE: rodapé "Feito com Lumen Deal" (entitlement `removeBranding`).

## 4. Limites e Casos de Borda (Fallbacks)
- Mídia que falha ao carregar não bloqueia a impressão (timeout de 5 s, depois imprime sem a mídia).
- Texto longo quebra entre páginas sem cortar linhas (`break-inside: avoid` em itens).

## 5. Critérios de Aceite (Para o Test Harness)
- A rota de impressão renderiza todos os tipos de bloco sem elementos interativos.
- Teste manual: Chrome/Safari/Edge geram PDF A4 com texto selecionável e sem páginas em branco.
