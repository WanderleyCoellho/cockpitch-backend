# Modelos de proposta e ordem dos blocos

## Ordem recomendada

capa → o momento do cliente (problema) → escopo → etapas → portfólio → equipe → depoimentos
→ **investimento** → dúvidas → chamada/contato → condições → aceite

O que sustenta essa ordem (dados de fornecedores de software de propostas, não estudos acadêmicos):

- A introdução é a parte mais lida: 34,6% a 38% do tempo de leitura (Proposify, Qwilr).
  Ela deve falar do problema do cliente, não da empresa.
- A seção de preços fica com cerca de 27% do tempo de leitura. Mostrar valor antes do preço
  é consenso entre as fontes.
- As propostas ganhas têm em média 7 seções e 11 páginas (Proposify).
- Mídia (vídeo, imagens) aumenta a taxa de fechamento em +23% a +32%. Itens opcionais
  aumentam em +32% (Bidsketch).
- Com 3 pacotes, destaque o do meio e use o mais caro como âncora.
- Use a palavra "Investimento" em vez de "Preço".
- Contato depois dos pacotes é consenso de mercado, mas nenhum estudo mede isso.
  Por isso é uma dica, nunca uma regra.

### Saúde e estética

Antes e depois só com caráter educativo e com autorização do paciente
(Resolução CFM 2.336/2023). Os modelos do segmento avisam isso na descrição.

## Modelos com temas das referências

| Modelo | Segmento | Tema |
| --- | --- | --- |
| Agência de crescimento | AGENCY | neon_lime |
| Consultoria corporativa | CONSULTING | corporate_green |
| Produto digital | TECH | impact |
| Estúdio criativo | GENERAL | geometric |
| Produtora audiovisual | PHOTO_VIDEO | spotlight |
| Estética e skincare | HEALTH_BEAUTY | nude_editorial |
| Clínica premium | HEALTH_BEAUTY | bronze_glass |
| Harmonização facial | HEALTH_BEAUTY | champagne |
| Arquitetura e interiores | CONSTRUCTION | sand_portfolio |
| Escritório de arquitetura | CONSTRUCTION | golden_arch |

Os temas ficam no frontend: `ThemeSelector.tsx` (tokens + `style`) e `public/theme.tsx` (CSS).
O backend guarda só o nome do tema.

Regras:

- Títulos de bloco não trocam `{cliente}` nem `{empresa}`. Use os marcadores só nos textos.
- Os testes em `tests/blocks.test.ts` conferem três coisas:
  - a capa vem primeiro;
  - o escopo vem antes do preço;
  - não há marcadores nos títulos.
