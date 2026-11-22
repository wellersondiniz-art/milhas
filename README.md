# Milhas da Vez

Comparador de milhas e pontos para o Brasil. Você informa seus cartões e programas de fidelidade, escolhe a loja e o valor da compra, e o site mostra qual combinação rende mais pontos e quanto isso vale em reais.

Fase 1: site estático (PWA), sem login e sem banco de dados. As regras do projeto estão no [CLAUDE.md](CLAUDE.md).

## Como rodar

Não precisa instalar nada além do Node 22 (para os testes) e do Python 3 (para o servidor local).

| Para quê | Comando |
| --- | --- |
| Rodar os testes | `npm test` (ou `node --test`) |
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

## Atualização semanal das ofertas

Quatro passos, rodados no seu computador. **Nada é publicado sozinho**: até você aprovar, nada muda em `dados/` e nada vai para o GitHub.

1. **Coletar.** Cadastre as páginas em `dados/fontes.json` (uma por par programa × loja; schema em `dados/schemas/fontes.schema.json`). Só entra página do domínio oficial do programa ou da loja (ou subdomínio); blog é recusado. Depois rode `npm run coletar`. O texto de cada página fica em `coleta/AAAA-MM-DD/<id>.txt` (pasta fora do Git).
2. **Extrair.** `ANTHROPIC_API_KEY=... npm run extrair` (ou `node --env-file=.env scripts/extrair.js`, com a chave num `.env` que o Git ignora). O modelo é o Claude Haiku 5.5, o mais barato da Anthropic, com o prompt de `scripts/atualizacao/prompt-extracao.md`: ele só copia texto da página para os campos de `ofertas.json`, cada valor com o trecho exato que o mostra, e deixa vazio (A_CONFIRMAR) o que não está escrito. Ele não calcula nem decide nada. Depois, o código confere cada valor: o trecho precisa estar na página e o número ou a data precisa estar no trecho. O que não passa vira A_CONFIRMAR e aparece no relatório.
3. **Propor.** `npm run propor` compara com `dados/ofertas.json` e gera `coleta/AAAA-MM-DD/relatorio.md`: ofertas novas, alteradas, encerradas e suspeitas (pontos por real mais de 3 vezes o normal do programa, faixa com 0 ponto, início no futuro), com os trechos de cada valor e os campos recusados.
4. **Aprovar.** Revise o relatório. Se estiver certo, rode o comando do fim dele: `npm run aprovar -- --data AAAA-MM-DD --codigo <código>`. O código só vale para aquele relatório; se a proposta ou o `ofertas.json` mudarem, ele não confere e nada é gravado. Com o código certo, o script grava `dados/ofertas.json`, valida, cria a branch `ofertas/AAAA-MM-DD`, faz o commit, envia e abre o pull request (com o `gh`; sem ele, mostra o link para abrir à mão). O merge continua com você. Use `--so-gravar` para só gravar o arquivo, sem Git.

Cada passo usa a data de hoje (Brasília); para outra data, passe `--data AAAA-MM-DD`. Custo: uma página de 20 mil caracteres dá uns 6 mil tokens, menos de US$ 0,01 por página.

Para ver o fluxo inteiro sem internet e sem chave: `npm run atualizacao:demo`. Ele usa duas páginas fictícias e respostas do modelo escritas à mão (`testes/atualizacao/`), roda numa cópia temporária do projeto e só simula os comandos de Git.

## Pastas

- `site/`: o código do site, legível (`js/motor/` guarda o cálculo puro, sem interface; `js/tela/` monta a tela inicial e só exibe o que o motor devolve; `_headers` define os cabeçalhos de segurança).
- `dados/`: programas, cartões, lojas e ofertas em JSON, com os schemas (JSON Schema 2020-12) em `dados/schemas/`. Valores em reais (`valor_milheiro_brl`, `anuidade_brl`) ficam em centavos inteiros. O que não se sabe fica `"A_CONFIRMAR"` e não entra no cálculo. `npm run validar` aponta arquivo, registro e campo de cada erro.
- `dist/`: o que vai para a internet, gerado por `npm run build` a partir de `site/` (minificado). Não editar à mão.
- `testes/`: testes com `node --test`.
- `scripts/`: validação dos dados, geração de páginas por loja, montagem de `dist/` (`scripts/publicar/`) e o fluxo semanal de ofertas (`coletar.js`, `extrair.js`, `propor-mudancas.js`, `aprovar-mudancas.js` e `scripts/atualizacao/`).
- `coleta/`: gerada pelo fluxo semanal, fica fora do Git.
- `seguranca/`: auditoria de segurança e checklist.
