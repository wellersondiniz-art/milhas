# Milhas da Vez

Comparador de milhas e pontos para o Brasil. Você informa seus cartões e programas de fidelidade, escolhe a loja e o valor da compra, e o site mostra qual combinação rende mais pontos e quanto isso vale em reais.

Fase 1: site estático (PWA), sem login e sem banco de dados. As regras do projeto estão no [CLAUDE.md](CLAUDE.md).

## Como rodar

Não precisa instalar nada além do Node 22 (para os testes) e do Python 3 (para o servidor local).

| Para quê | Comando |
| --- | --- |
| Rodar os testes | `npm test` (ou `node --test`) |
| Validar os dados | `npm run validar` |
| Servir localmente | `npm run servir` e abra http://localhost:8080 (copia `dados/` para `site/dados/` antes) |
| Copiar os dados para o site | `npm run dados` |
| Gerar as páginas por loja e de ofertas | `npm run paginas` (ou `node scripts/gerar-paginas.js`) |
| Auditar segurança | `npm run auditar` |

Sem npm? Use direto: `node scripts/copiar-dados.js && python3 -m http.server 8080 --directory site`.

Na Cloudflare Pages, o comando de build é `node scripts/copiar-dados.js && node scripts/gerar-paginas.js` (ou `npm run build`) e a pasta de saída é `site`. As pastas `site/dados/`, `site/loja/` e `site/ofertas/`, o `site/sitemap.xml` e o `site/robots.txt` são gerados e ficam fora do Git: a fonte continua sendo `dados/`.

### Páginas por loja

`node scripts/gerar-paginas.js` valida os dados e gera `site/loja/<id>/index.html` (uma por loja) e `site/ofertas/index.html` (ofertas ativas hoje), com título e descrição únicos, Open Graph, JSON-LD, `robots.txt` e, se a URL do site estiver definida, `sitemap.xml`. Os números vêm do motor. "Hoje" é a data de Brasília na hora do build, então as páginas só ficam em dia se o site for refeito todo dia (ou com `--hoje AAAA-MM-DD`).

Endereço do site: `URL_BASE` em `scripts/paginas/config.js`. Hoje é `https://milhasdavez.pages.dev`, o endereço gratuito da Cloudflare Pages, que só vale se o projeto na Cloudflare Pages se chamar exatamente `milhasdavez`. Quando o domínio `milhasdavez.com.br` estiver comprado e ligado ao projeto, basta trocar essa linha. Para gerar com outro endereço sem mexer no arquivo: `URL_DO_SITE=https://outro.exemplo npm run paginas`.

## Pastas

- `site/`: tudo que vai para a internet (`js/motor/` guarda o cálculo puro, sem interface; `js/tela/` monta a tela inicial e só exibe o que o motor devolve; `_headers` define os cabeçalhos de segurança).
- `dados/`: programas, cartões, lojas e ofertas em JSON, com os schemas (JSON Schema 2020-12) em `dados/schemas/`. Valores em reais (`valor_milheiro_brl`, `anuidade_brl`) ficam em centavos inteiros. O que não se sabe fica `"A_CONFIRMAR"` e não entra no cálculo. `npm run validar` aponta arquivo, registro e campo de cada erro.
- `testes/`: testes com `node --test`.
- `scripts/`: validação dos dados e geração de páginas por loja.
- `seguranca/`: auditoria de segurança e checklist.
