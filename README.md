# Milhas da Vez

Comparador de milhas e pontos para o Brasil. Você informa seus cartões e programas de fidelidade, escolhe a loja e o valor da compra, e o site mostra qual combinação rende mais pontos e quanto isso vale em reais.

Fase 1: site estático (PWA), sem login e sem banco de dados. As regras do projeto estão no [CLAUDE.md](CLAUDE.md).

## Como rodar

O site não tem dependências. Para os testes no navegador, rode `npm install` uma vez (instala só o Playwright, ferramenta de teste) e `npx playwright install chromium`. O servidor local usa Python 3.

| Para quê | Comando |
| --- | --- |
| Rodar todos os testes | `npm test` (unitários + dados + navegador; ver abaixo) |
| Validar os dados | `npm run validar` |
| Servir localmente | `npm run servir` e abra http://localhost:8080 (faz o build e serve `dist/`, igual ao que vai para o ar) |
| Servir o código sem minificar | `npm run servir:fonte` (serve `site/`, bom para depurar) |
| Copiar os dados para o site | `npm run dados` |
| Gerar as páginas por loja e de ofertas | `npm run paginas` (ou `node scripts/gerar-paginas.js`) |
| Auditar segurança | `npm run auditar` |

Sem npm? Use direto: `node scripts/copiar-dados.js && python3 -m http.server 8080 --directory site`.

Na Cloudflare Pages, o comando de build é `npm run build` e a pasta de saída é `dist`. O build gera as páginas e o `sw.js` em `site/` e depois monta `dist/` (scripts/publicar/montar-dist.js): JS e HTML minificados, CSS minificado e embutido em cada página (com o resumo SHA-256 na CSP do `_headers`), `modulepreload` dos módulos e `sw.js` gerado de novo com os arquivos finais. `dist/` fica fora do Git. As pastas `site/dados/`, `site/loja/` e `site/ofertas/`, o `site/sitemap.xml` e o `site/robots.txt` são gerados e ficam fora do Git: a fonte continua sendo `dados/`.

### Páginas por loja

`node scripts/gerar-paginas.js` valida os dados e gera `site/loja/<id>/index.html` (uma por loja) e `site/ofertas/index.html` (ofertas ativas hoje), com título e descrição únicos, Open Graph, JSON-LD, `robots.txt` e, se a URL do site estiver definida, `sitemap.xml`. Os números vêm do motor. "Hoje" é a data de Brasília na hora do build, então as páginas só ficam em dia se o site for refeito todo dia (ou com `--hoje AAAA-MM-DD`).

Endereço do site: `URL_BASE` em `scripts/paginas/config.js`. Hoje é `https://milhasdavez.pages.dev`, o endereço gratuito da Cloudflare Pages, que só vale se o projeto na Cloudflare Pages se chamar exatamente `milhasdavez`. Quando o domínio `milhasdavez.com.br` estiver comprado e ligado ao projeto, basta trocar essa linha. Para gerar com outro endereço sem mexer no arquivo: `URL_DO_SITE=https://outro.exemplo npm run paginas`.

## Pastas

- `site/`: o código do site, legível (`js/motor/` guarda o cálculo puro, sem interface; `js/tela/` monta a tela inicial e só exibe o que o motor devolve; `_headers` define os cabeçalhos de segurança).
- `dados/`: programas, cartões, lojas e ofertas em JSON, com os schemas (JSON Schema 2020-12) em `dados/schemas/`. Valores em reais (`valor_milheiro_brl`, `anuidade_brl`) ficam em centavos inteiros. O que não se sabe fica `"A_CONFIRMAR"` e não entra no cálculo. `npm run validar` aponta arquivo, registro e campo de cada erro.
- `dist/`: o que vai para a internet, gerado por `npm run build` a partir de `site/` (minificado). Não editar à mão.
- `testes/`: testes com `node --test`.
- `scripts/`: validação dos dados, geração de páginas por loja e montagem de `dist/` (`scripts/publicar/`).
- `seguranca/`: auditoria de segurança e checklist.

## Testes

`npm test` roda tudo, em ordem, e para no primeiro erro:

1. **Unitários** (`npm run test:unidade`): `node --test` em `testes/*.test.mjs`, com relatório de cobertura de `site/js/` e `scripts/`. Reprova abaixo de 95% das linhas, 88% dos caminhos ou 95% das funções.
2. **Dados** (`npm run validar`): schemas, ids entre arquivos, datas e fontes de `dados/`.
3. **Navegador** (`npm run test:navegador`): Playwright em `testes/navegador/`, cada teste no celular (Pixel 7) e no computador (1280 × 800). Monta o site (`npm run build`) e serve a pasta `dist/`, a mesma que vai para o ar, com os cabeçalhos de `_headers`; erro de JavaScript ou de CSP no console reprova.
   - `calcular.spec.mjs`: loja, valor e resultado, por teclado e por toque; erros do formulário; falha ao carregar; toda loja real calcula.
   - `perfil.spec.mjs`: marcar, recarregar, a conta usar o perfil, exportar/importar, apagar e modo privado.
   - `offline.spec.mjs`: instalável segundo o próprio Chrome, calculadora sem internet, página nunca aberta, perfil fora do cache.
   - `fotos.spec.mjs`: regressão visual com as fotos de `testes/navegador/fotos/`.

Os testes do navegador usam dados falsos (`testes/navegador/dados-de-teste/`, validados pelo mesmo schema) e o relógio parado em 10/11/2026, para o resultado não mudar quando os dados reais mudam.

**Fotos de referência.** Foram tiradas na imagem Docker oficial do Playwright, a mesma do CI, porque a letra muda de um sistema para outro. Por isso, fora do CI o `npm test` pula as fotos. Para comparar no seu computador: `npm run test:fotos` (precisa do Docker). Mudou a tela de propósito? `npm run test:fotos:atualizar` e confira as imagens novas no pull request. Relatório com as diferenças: `npm run test:relatorio`.

**No GitHub.** `.github/workflows/testes.yml` roda em todo pull request: "Unitários e dados" e "Navegador (Playwright)". Quando o navegador falha, o relatório (com fotos e passo a passo) fica no artefato `relatorio-playwright` da execução.
