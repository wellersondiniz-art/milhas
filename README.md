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

Na Cloudflare Pages, o comando de build é `npm run build` e a pasta de saída é `dist` (passo a passo em [Publicar na Cloudflare Pages](#publicar-na-cloudflare-pages)). O build gera as páginas e o `sw.js` em `site/` e depois monta `dist/` (scripts/publicar/montar-dist.js): JS e HTML minificados, CSS minificado e embutido em cada página (com o resumo SHA-256 na CSP do `_headers`), `modulepreload` dos módulos e `sw.js` gerado de novo com os arquivos finais. `dist/` fica fora do Git. As pastas `site/dados/`, `site/loja/` e `site/ofertas/`, o `site/sitemap.xml` e o `site/robots.txt` são gerados e ficam fora do Git: a fonte continua sendo `dados/`.

### Páginas por loja

`node scripts/gerar-paginas.js` valida os dados e gera `site/loja/<id>/index.html` (uma por loja) e `site/ofertas/index.html` (ofertas ativas hoje), com título e descrição únicos, Open Graph, JSON-LD, `robots.txt` e, se a URL do site estiver definida, `sitemap.xml`. Os números vêm do motor. "Hoje" é a data de Brasília na hora do build, então as páginas só ficam em dia se o site for refeito todo dia (ou com `--hoje AAAA-MM-DD`).

Endereço do site: `URL_BASE` em `scripts/paginas/config.js`. Hoje é `https://milhasdavez.pages.dev`, o endereço gratuito da Cloudflare Pages, que só vale se o projeto na Cloudflare Pages se chamar exatamente `milhasdavez`. Quando o domínio `milhasdavez.com.br` estiver comprado e ligado ao projeto, basta trocar essa linha. Para gerar com outro endereço sem mexer no arquivo: `URL_DO_SITE=https://outro.exemplo npm run paginas`.

## Publicar na Cloudflare Pages

O site vai para o ar pela Cloudflare Pages, ligada a este repositório do GitHub: cada merge na `main` publica o site, e cada pull request ganha um endereço de teste (o "preview"). Eu (Claude) não tenho acesso à sua conta da Cloudflare: os passos abaixo são para você clicar no painel. O painel está em inglês, então os nomes dos botões vêm em inglês, entre aspas. A Cloudflare muda o painel de vez em quando; se um nome não bater, procure o mais parecido.

**Por que tem build.** O que vai para o ar é a pasta `dist/`, montada por `npm run build`. A pasta `site/` sozinha não basta: os dados (`site/dados/`), as páginas por loja, a página de ofertas e o `sw.js` são gerados no build e ficam fora do Git. Publicar `site/` sem build daria um site quebrado. O build não instala nada e leva poucos segundos.

### Passo 1. Criar o projeto (uma vez só)

1. Entre em https://dash.cloudflare.com e abra **"Workers & Pages"** no menu da esquerda.
2. Clique em **"Create"** (ou "Create application"), escolha a aba **"Pages"** e depois **"Import an existing Git repository"** (em alguns painéis: "Connect to Git").
3. Escolha **GitHub**, autorize o app da Cloudflare e dê acesso só ao repositório `wellersondiniz-art/milhas` ("Only select repositories"). Selecione o repositório e clique em **"Begin setup"**.
4. Preencha **"Set up builds and deployments"** exatamente assim:

   | Campo | Valor |
   | --- | --- |
   | Project name | `milhasdavez` (tem que ser exatamente este: ele vira o endereço `milhasdavez.pages.dev`, que está em `scripts/paginas/config.js`) |
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory (em "Advanced") | deixe vazio |
   | Environment variables (em "Advanced") | `NODE_VERSION` = `22` |

   O arquivo `.node-version` do repositório já pede o Node 22; a variável é só uma garantia a mais. Não crie nenhuma outra variável: o site não tem segredo nenhum.

   Quando o repositório tiver `package-lock.json` (o PR dos testes com Playwright traz um), a Cloudflare instala as ferramentas de teste antes do build. Elas não vão para o ar, só deixam o build uns segundos mais lento. Se quiser pular essa instalação, crie também `SKIP_DEPENDENCY_INSTALL` = `1`.
5. Clique em **"Save and Deploy"** e espere o primeiro build terminar ("Success"). O site fica em https://milhasdavez.pages.dev.

### Passo 2. Previews por pull request e `main` em produção

1. No projeto `milhasdavez`, abra **"Settings"** → **"Builds"** (em alguns painéis: "Builds & deployments") → **"Branch control"** → **"Configure"** (ou "Edit").
2. Confira: **"Production branch"** = `main` e **"Enable automatic production branch deployments"** ligado.
3. Em **"Preview branch"**, escolha **"All non-Production branches"**. Salve.

Pronto: cada pull request no GitHub ganha um build próprio, e a Cloudflare comenta no PR com o link do preview (algo como `https://<código>.milhasdavez.pages.dev` e `https://<nome-da-branch>.milhasdavez.pages.dev`). Os previews saem com o cabeçalho `X-Robots-Tag: noindex`, então o Google não indexa. Só o que entra na `main` vai para `milhasdavez.pages.dev` (e depois para o domínio).

### Passo 3. HTTPS forçado

- No `milhasdavez.pages.dev`, a Cloudflare já força HTTPS: quem abre `http://` é mandado para `https://`. Não há nada para clicar.
- O `_headers` do site manda `Strict-Transport-Security` (HSTS, um ano), então o navegador passa a usar HTTPS sozinho depois da primeira visita. O "preload" do HSTS fica desligado de propósito (só depois do domínio próprio, e com decisão sua).
- Para o domínio próprio, ver o passo 5.

### Passo 4. Página 404

Não há o que clicar. O arquivo `site/404.html` vai para `dist/404.html`, e a Cloudflare o mostra, com status 404, para qualquer endereço que não existe. Sem esse arquivo, a Cloudflare trataria o site como "aplicativo de uma página só" e devolveria a tela inicial com status 200 para qualquer endereço errado, o que confunde quem chega e o Google.

### Passo 5. Domínio próprio `milhasdavez.com.br` (depois de registrar no Registro.br)

**5.1 Pôr o domínio na Cloudflare**

1. No painel da Cloudflare, na página inicial da conta, clique em **"Add a domain"** (ou "Add site"), digite `milhasdavez.com.br`, escolha o plano **Free** e continue até ver os **2 nameservers** da Cloudflare (algo como `xxx.ns.cloudflare.com`).
2. No Registro.br, abra o domínio → **DNS** → **"Alterar servidores DNS"** e troque pelos 2 nameservers da Cloudflare. Salve.
3. Espere a Cloudflare mostrar o domínio como **"Active"** (de minutos a algumas horas; ela manda e-mail).

**5.2 Ligar o domínio ao site**

1. Em **"Workers & Pages"** → `milhasdavez` → **"Custom domains"** → **"Set up a custom domain"**. Digite `milhasdavez.com.br` → **"Continue"** → **"Activate domain"**. A Cloudflare cria o registro DNS e o certificado sozinha.
2. Repita para `www.milhasdavez.com.br` (ele precisa existir para o redirecionamento do passo 5.4 funcionar).
3. Espere os dois aparecerem como **"Active"**.

**5.3 HTTPS forçado no domínio**

No domínio `milhasdavez.com.br`, abra **"SSL/TLS"** → **"Edge Certificates"** e ligue:

- **"Always Use HTTPS"**: liga (manda todo `http://` para `https://`).
- **"Minimum TLS Version"**: `TLS 1.2`.
- **"HTTP Strict Transport Security (HSTS)"**: deixe desligado aqui. O HSTS já vem do `_headers`; ligar nos dois lugares só cria confusão.

Ainda no domínio, deixe desligados **"Rocket Loader"** (em "Speed") e **"Email Address Obfuscation"** (em "Scrape Shield"). Os dois injetam scripts na página, e a CSP do site bloqueia scripts de fora: o resultado seria erro no console. Pelo mesmo motivo, não ligue o "Web Analytics" da Cloudflare no projeto (métricas são da Fase 2).

**5.4 Redirecionar `www` para o domínio sem `www`**

O arquivo `_redirects` da Cloudflare Pages não faz redirecionamento entre domínios, então isso é uma regra no painel:

1. No domínio `milhasdavez.com.br`, abra **"Rules"** → **"Overview"** → **"Create rule"** → **"Redirect Rule"**. Se aparecer o modelo **"Redirect from WWW to root"**, use-o e só confira os campos abaixo.
2. Preencha:

   | Campo | Valor |
   | --- | --- |
   | Rule name | `www para o domínio` |
   | If incoming requests match | "Custom filter expression": **Hostname** · **equals** · `www.milhasdavez.com.br` |
   | Then: URL redirect | **Type**: "Dynamic" · **Expression**: `concat("https://milhasdavez.com.br", http.request.uri.path)` |
   | Status code | `301` |
   | Preserve query string | marcado |

3. Clique em **"Deploy"**.

**5.5 Trocar o endereço no código**

Peça um PR trocando `URL_BASE` em `scripts/paginas/config.js` para `https://milhasdavez.com.br` (uma linha; muda o `sitemap.xml`, o `robots.txt` e os links das páginas por loja). Faça o merge só depois que `https://milhasdavez.com.br` abrir com cadeado.

Opcional: para quem ainda tiver o link antigo, dá para mandar `milhasdavez.pages.dev` para o domínio com **"Bulk Redirects"** (na conta, não no domínio): origem `milhasdavez.pages.dev`, destino `https://milhasdavez.com.br`, `301`, marcando "Preserve query string", "Subpath matching" e "Preserve path suffix", e **sem** "Include subdomains" (senão os previews param de abrir).

### Passo 6. Conferir os cabeçalhos depois de publicar

No terminal (troque o endereço pelo domínio quando ele estiver ativo):

```sh
SITE=https://milhasdavez.pages.dev

# 1. Página inicial: status 200 e os cabeçalhos de segurança
curl -sI "$SITE/" | grep -iE '^(HTTP|content-security-policy|strict-transport-security|x-content-type-options|x-frame-options|referrer-policy|permissions-policy|cross-origin-opener-policy|cross-origin-resource-policy)'

# 2. Endereço que não existe: tem que dar 404 (não 200)
curl -sI "$SITE/pagina-que-nao-existe" | head -n 1

# 3. http vira https (301 ou 308, com "location: https://...")
curl -sI "http://${SITE#https://}/" | grep -iE '^(HTTP|location)'

# 4. O service worker não pode ficar velho no cache
curl -sI "$SITE/sw.js" | grep -iE '^(HTTP|cache-control)'
```

O que tem que aparecer:

| Teste | Esperado |
| --- | --- |
| 1 | `HTTP/2 200`; `content-security-policy` com `default-src 'self'` **e** com `'sha256-...'` em `style-src` (o `sha256` prova que foi publicada a pasta `dist/`, e não a `site/`); `strict-transport-security: max-age=31536000; includeSubDomains`; `x-content-type-options: nosniff`; `x-frame-options: DENY`; `referrer-policy: strict-origin-when-cross-origin`; `permissions-policy` com `camera=()`; `cross-origin-opener-policy: same-origin`; `cross-origin-resource-policy: same-origin` |
| 2 | `HTTP/2 404` |
| 3 | `HTTP/1.1 301` ou `308` e `location: https://...` |
| 4 | `HTTP/2 200` e `cache-control: no-cache` |

Com o domínio ativo, confira também o `www`:

```sh
curl -sI "https://www.milhasdavez.com.br/loja/magalu/?teste=1" | grep -iE '^(HTTP|location)'
# Esperado: HTTP/2 301 e location: https://milhasdavez.com.br/loja/magalu/?teste=1
```

Faltou algum cabeçalho? Veja se o `dist/_headers` existe depois de `npm run build` e se a "Build output directory" do projeto é mesmo `dist`.

### Checklist de 5 minutos antes de cada publicação

Publicar = fazer o merge de um pull request na `main`.

- [ ] **Testes no GitHub verdes** no pull request (a verificação "testes").
- [ ] **No seu computador**, na branch do PR: `npm test`, `npm run validar` e `npm run auditar` sem falha.
- [ ] **Dados em dia**: as ofertas novas têm `fonte_url` e `verificado_em`, e o que não se sabe está como `"A_CONFIRMAR"` (o `npm run validar` aponta o resto).
- [ ] **Preview aberto no celular**: abra o link que a Cloudflare comentou no PR, faça uma conta (loja + valor), abra "Ofertas" e "Meu perfil", e um endereço errado (`/xyz`) para ver a página 404.
- [ ] **Depois do merge**: em "Workers & Pages" → `milhasdavez` → "Deployments", o build da `main` está "Success"; rode os testes 1 e 2 do passo 6.

Deu problema no ar? Em "Deployments", abra a publicação anterior que funcionava, clique em "..." → **"Rollback to this deployment"**. Volta em segundos, sem mexer no código. Depois corrija com calma num PR.

## Atualização semanal das ofertas

Quatro passos, rodados no seu computador. **Nada é publicado sozinho**: até você aprovar, nada muda em `dados/` e nada vai para o GitHub.

1. **Coletar.** Cadastre as páginas em `dados/fontes.json` (uma por par programa × loja; schema em `dados/schemas/fontes.schema.json`). Só entra página do domínio oficial do programa ou da loja (ou subdomínio); blog é recusado. Depois rode `npm run coletar`. O texto de cada página fica em `coleta/AAAA-MM-DD/<id>.txt` (pasta fora do Git).
2. **Extrair.** `ANTHROPIC_API_KEY=... npm run extrair` (ou `node --env-file=.env scripts/extrair.js`, com a chave num `.env` que o Git ignora). O modelo é o Claude Haiku 5.5, o mais barato da Anthropic, com o prompt de `scripts/atualizacao/prompt-extracao.md`: ele só copia texto da página para os campos de `ofertas.json`, cada valor com o trecho exato que o mostra, e deixa vazio (A_CONFIRMAR) o que não está escrito. Ele não calcula nem decide nada. Depois, o código confere cada valor: o trecho precisa estar na página e o número ou a data precisa estar no trecho. O que não passa vira A_CONFIRMAR e aparece no relatório.
3. **Propor.** `npm run propor` compara com `dados/ofertas.json` e gera `coleta/AAAA-MM-DD/relatorio.md`: ofertas novas, alteradas, encerradas e suspeitas (pontos por real mais de 3 vezes o normal do programa, faixa com 0 ponto, início no futuro), com os trechos de cada valor e os campos recusados.
4. **Aprovar.** Revise o relatório. Se estiver certo, rode o comando do fim dele: `npm run aprovar -- --data AAAA-MM-DD --codigo <código>`. O código só vale para aquele relatório; se a proposta ou o `ofertas.json` mudarem, ele não confere e nada é gravado. Com o código certo, o script grava `dados/ofertas.json`, valida, cria a branch `ofertas/AAAA-MM-DD`, faz o commit, envia e abre o pull request (com o `gh`; sem ele, mostra o link para abrir à mão). O merge continua com você. Use `--so-gravar` para só gravar o arquivo, sem Git.

Cada passo usa a data de hoje (Brasília); para outra data, passe `--data AAAA-MM-DD`. Custo: uma página de 20 mil caracteres dá uns 6 mil tokens, menos de US$ 0,01 por página.

Para ver o fluxo inteiro sem internet e sem chave: `npm run atualizacao:demo`. Ele usa duas páginas fictícias e respostas do modelo escritas à mão (`testes/atualizacao/`), roda numa cópia temporária do projeto e só simula os comandos de Git.

## Operação de produção

Monitor de disponibilidade, logs de erro sem dado pessoal, alerta de ofertas paradas, backup diário do banco com teste de restauração, painel de custos e plano de resposta a incidente: tudo em [docs/operacao.md](docs/operacao.md), em linguagem de quem não é de TI. Os robôs ficam em `.github/workflows/` (`disponibilidade`, `vigia`, `custos`, `backup`) e avisam abrindo uma issue com a etiqueta `operacao`. Cada um fica desligado até receber a configuração descrita no guia.

## Pastas

- `site/`: o código do site, legível (`js/motor/` guarda o cálculo puro, sem interface; `js/tela/` monta a tela inicial e só exibe o que o motor devolve; `_headers` define os cabeçalhos de segurança).
- `dados/`: programas, cartões, lojas e ofertas em JSON, com os schemas (JSON Schema 2020-12) em `dados/schemas/`. Valores em reais (`valor_milheiro_brl`, `anuidade_brl`) ficam em centavos inteiros. O que não se sabe fica `"A_CONFIRMAR"` e não entra no cálculo. `npm run validar` aponta arquivo, registro e campo de cada erro.
- `dist/`: o que vai para a internet, gerado por `npm run build` a partir de `site/` (minificado). Não editar à mão.
- `testes/`: testes com `node --test`.
- `scripts/`: validação dos dados, geração de páginas por loja, montagem de `dist/` (`scripts/publicar/`) e o fluxo semanal de ofertas (`coletar.js`, `extrair.js`, `propor-mudancas.js`, `aprovar-mudancas.js` e `scripts/atualizacao/`).
- `coleta/`: gerada pelo fluxo semanal, fica fora do Git.
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
