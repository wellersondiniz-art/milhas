# comprador de milhas

Comparador de milhas e pontos para o Brasil. Você informa seus cartões e programas de fidelidade, escolhe a loja e o valor da compra, e o site mostra qual combinação rende mais pontos e quanto isso vale em reais.

Fase 1: site estático (PWA), sem login e sem banco de dados. As regras do projeto estão no [CLAUDE.md](CLAUDE.md).

## Como rodar

Não precisa instalar nada além do Node 22 (para os testes) e do Python 3 (para o servidor local).

| Para quê | Comando |
| --- | --- |
| Rodar os testes | `npm test` (ou `node --test`) |
| Validar os dados | `npm run validar` |
| Servir localmente | `npm run servir` e abra http://localhost:8080 |
| Auditar segurança | `npm run auditar` |

Sem npm? Use direto: `python3 -m http.server 8080 --directory site`.

## Pastas

- `site/`: tudo que vai para a internet (`js/motor/` guarda o cálculo puro, sem interface; `_headers` define os cabeçalhos de segurança).
- `dados/`: programas, cartões, lojas e ofertas em JSON, com os schemas (JSON Schema 2020-12) em `dados/schemas/`. Valores em reais (`valor_milheiro_brl`, `anuidade_brl`) ficam em centavos inteiros. O que não se sabe fica `"A_CONFIRMAR"` e não entra no cálculo. `npm run validar` aponta arquivo, registro e campo de cada erro.
- `testes/`: testes com `node --test`.
- `scripts/`: validação dos dados e geração de páginas por loja.
- `seguranca/`: auditoria de segurança e checklist.
