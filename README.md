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

## Métricas sem cookie (Plausible)

O site conta alguns usos com o [Plausible](https://plausible.io), sem cookie e sem dado pessoal. Não há script de terceiro: o próprio site manda cada evento com `fetch` para `https://plausible.io/api/event` (o único endereço de fora liberado na CSP, em `connect-src`). O código fica em `site/js/metricas/`.

| Evento | Propriedades | Quando |
| --- | --- | --- |
| `busca_loja` | `loja`, `origem` (`calculadora` ou `pagina-da-loja`) | Escolheu uma loja na calculadora ou abriu `/loja/<id>/`. Loja digitada que não está na lista vira `fora-da-lista`, sem o texto. |
| `calculo` | `loja` | Fez uma conta (refazer sozinho porque o perfil mudou não conta). |
| `clique_saida` | `destino` (site, sem `www.`), `pagina`, `loja` | Clicou num link para outro site. |
| `instalacao` | nenhuma | Instalou o app (Chrome e Android; o Safari não avisa). |
| `oferta_vencida_vista` | `pagina`, `loja` | A seção "Histórico" de ofertas que acabaram apareceu na tela. |

Nunca vão: valor da compra, cartões, programas, perfil, texto digitado, o que vem depois de `?` no endereço, cookie ou referrer. Cada valor precisa ser um código curto (`a-z`, `0-9`, `.`, `-`); se não for, o evento inteiro é descartado. Quem liga "Do Not Track" ou "Global Privacy Control" não é medido. A página Privacidade lista o que é medido a partir do próprio código.

### Ligar (uma vez só, feito por você)

1. Crie uma conta em plausible.io (30 dias grátis; depois o plano mais barato custa cerca de US$ 9 por mês, para até 10 mil visualizações).
2. Adicione o site com o endereço onde ele está no ar (hoje `milhasdavez.pages.dev`). Pode pular o passo de instalar o script: o site já manda os eventos sozinho.
3. Em Settings → Goals, crie 5 metas do tipo "Custom event", com estes nomes exatos: `busca_loja`, `calculo`, `clique_saida`, `instalacao`, `oferta_vencida_vista`.
4. Em Settings → Custom Properties, adicione: `loja`, `origem`, `destino`, `pagina`.
5. Em `site/js/metricas/config.js`, troque `DOMINIO_NO_PLAUSIBLE = 'A_CONFIRMAR'` pelo mesmo endereço do passo 2, e em `scripts/paginas/config.js` troque `TEXTOS_ATUALIZADOS_EM` para a data do dia. Rode `npm test` e publique: a página Privacidade passa a dizer o que é medido.
6. Quando mudar para `milhasdavez.com.br`, troque o domínio no Plausible (Settings → General → Change domain) e no `config.js` no mesmo dia.

O site só manda eventos quando está aberto exatamente nesse endereço. No seu computador, nos testes e nas prévias da Cloudflare, nada sai.

### Painel semanal

```bash
PLAUSIBLE_API_KEY=sua-chave npm run painel                 # semana fechada até ontem
PLAUSIBLE_API_KEY=sua-chave npm run painel -- --fim 2026-11-21
npm run painel -- --exemplo                                # números inventados, sem chave
```

A chave sai em plausible.io → Settings (da conta) → API Keys → "New API Key" do tipo Stats API. Ela fica só na variável de ambiente do seu computador: nunca no código, nem no Git. O painel é gravado em `painel/painel-AAAA-MM-DD.md` (fora do Git) com: resumo da semana, lojas mais buscadas, lojas sem oferta valendo hoje (para cadastrar), cliques de saída por site e taxa calcular → clicar (por loja e no total).
## Avisos de erro (reportes)

Cada resultado pode ter o botão **"Essa informação está errada?"**. Ele abre um formulário curto (o que está errado, link da prova e e-mail opcional; a loja vem do resultado) e envia para a função `functions/api/reportar.js`, que roda na própria Cloudflare Pages, no mesmo endereço do site. A função confere tudo de novo (`servidor/reportar/`), barra robô (campo escondido e envio rápido demais) e abuso (5 avisos por hora por conexão, 50 por dia no total) e abre uma **issue num repositório privado do GitHub**. Aviso sobre oferta que vale hoje ganha a etiqueta `prioridade: oferta ativa`.

O que fica guardado (é o que a página Privacidade diz):

- Na issue: loja, oferta, programa e cartão do resultado (ids dos nossos dados), o texto e o link, os dois dentro de bloco de código (o GitHub não monta link, imagem nem menção). Nada de IP.
- O e-mail, se a pessoa der um, vai num **comentário à parte**, que o robô `limpar-emails.yml` apaga quando a issue é fechada ou depois de 90 dias. Apagar o comentário (e não editar) tira o e-mail do histórico. Cuidado: se você recebe notificação por e-mail do GitHub, o endereço também chega na sua caixa; apague a notificação depois de responder.
- No Workers KV: um resumo embaralhado (HMAC) do IP com um contador, que some sozinho em 1 hora, e um contador do dia, sem nada da pessoa.

O botão vem **desligado** (`REPORTE_LIGADO = false` em `site/js/reporte/config.js`). Com ele desligado, a função continua no ar, mas sem configuração responde 503 e não grava nada. Para ligar, siga os passos abaixo uma vez. Os nomes dos botões dos painéis são de memória: se algum estiver diferente, procure o mais parecido.

### Passo 1. Repositório privado para os avisos (GitHub)

O repositório do site é público, e issue de repositório público qualquer pessoa lê. Por isso os avisos vão para outro, privado.

1. Abra <https://github.com/new>. Nome: `milhas-reportes`. Marque **Private** e **Add a README file**. Clique em **Create repository**.
2. Em **Issues** → **Labels** → **New label**, crie duas etiquetas: `reporte` e `prioridade: oferta ativa` (escreva igual, com os dois-pontos e o espaço; a cor é livre, vermelho para a de prioridade ajuda).
3. Ainda no `milhas-reportes`: **Add file** → **Create new file**. Nome do arquivo: `.github/workflows/limpar-emails.yml`. Cole o conteúdo de [`servidor/reportar/repo-de-reportes/limpar-emails.yml`](servidor/reportar/repo-de-reportes/limpar-emails.yml) e clique em **Commit changes**. Na aba **Actions**, ele aparece como `limpar-emails`; dá para rodar à mão com **Run workflow**.

Para triar: em **Issues**, filtre por `label:"prioridade: oferta ativa"` primeiro. Corrija em `dados/` (com `fonte_url` e `verificado_em`) e feche a issue; fechar apaga o e-mail.

### Passo 2. Token só para criar issues (GitHub)

1. Abra <https://github.com/settings/personal-access-tokens/new> (fine-grained token).
2. **Token name**: `milhasdavez-reportes`. **Expiration**: 1 ano (anote a data para trocar antes de vencer).
3. **Repository access**: **Only select repositories** → escolha só `milhas-reportes`.
4. **Permissions** → **Repository permissions** → **Issues**: **Read and write**. Não marque mais nada (o "Metadata: Read-only" entra sozinho).
5. **Generate token** e copie o valor. Ele aparece uma vez só. Não cole em arquivo, chat nem commit: ele vai direto para o passo 4.

### Passo 3. KV para o limite (Cloudflare)

No painel da Cloudflare: **Storage & Databases** → **Workers KV** → **Create** (namespace). Nome: `milhasdavez-reportes-limite`.

### Passo 4. Ligar a função ao token, ao repositório e ao KV (Cloudflare)

Em **Workers & Pages** → `milhasdavez` → **Settings**, no ambiente **Production**:

1. **Bindings** → **Add** → **KV namespace**. Variable name: `REPORTES_LIMITE`. KV namespace: `milhasdavez-reportes-limite`. Salve.
2. **Variables and Secrets** → **Add**:
   - Type **Secret**, nome `GITHUB_TOKEN`, valor: o token do passo 2.
   - Type **Text**, nome `REPORTES_REPO`, valor: `wellersondiniz-art/milhas-reportes`.
3. Não configure nada disso no ambiente **Preview**: assim os previews dos PRs nunca abrem issue de verdade (respondem 503).
4. Em **Deployments**, na publicação mais recente da `main`: **...** → **Retry deployment**, para a função pegar as configurações.

### Passo 5. Segunda trava contra abuso (opcional, Cloudflare, só com o domínio próprio)

Depois do domínio `milhasdavez.com.br` ativo na Cloudflare: **Security** → **WAF** → **Rate limiting rules** → **Create rule**. Quando: **URI Path** igual a `/api/reportar`. Limite: 5 pedidos a cada 10 segundos, contando por IP. Ação: **Block** por 10 segundos. O plano gratuito dá uma regra dessas.

### Passo 6. Ligar o botão e testar

1. Troque `REPORTE_LIGADO` para `true` em `site/js/reporte/config.js` (num PR; isso também acrescenta a seção "Quando você avisa de um erro" em Privacidade e a dica em Contato).
2. Depois do merge, no celular: faça uma conta, toque em "Essa informação está errada?", envie um aviso de teste com o seu e-mail. Espere uns 5 segundos antes de enviar (envio rápido demais é tratado como robô e some em silêncio).
3. Confira no `milhas-reportes`: a issue apareceu, com o comentário do e-mail. Feche a issue e veja em **Actions** o `limpar-emails` apagar o comentário.

Para desligar de novo: `REPORTE_LIGADO = false`, ou apague o segredo `GITHUB_TOKEN` (a função passa a responder 503 na hora).
## Alertas por e-mail

A pessoa diz "me avise quando a [loja] tiver [X] pontos por real ou mais para o meu perfil". Depois de cada atualização semanal das ofertas, o robô faz a conta com o **mesmo motor** da calculadora (`site/js/motor/`) e manda um e-mail para quem chegou no alvo. **Está desligado** (`ALERTAS_LIGADO = false` em `scripts/paginas/config.js`) até tudo abaixo estar configurado e testado.

Como funciona:

- **Inscrição** (`site/alertas/`, rota `POST /api/alertas/inscrever`): loja, programa (opcional), pontos por real, e-mail e o aceite. O perfil vai só com ids, clube e data do clube. A resposta é sempre a mesma, exista o e-mail ou não.
- **Duplo opt-in**: nada vale antes do clique no link de confirmação, que vale 48 horas e uma vez só. O banco guarda só o SHA-256 do token. O link abre uma página com o botão "Confirmar" (o leitor de links do provedor de e-mail não confirma sozinho).
- **Cancelar**: todo e-mail tem o link (assinado com HMAC) e o cabeçalho `List-Unsubscribe` com cancelamento em um clique. Cancelar apaga o e-mail e os alertas na hora.
- **Limites**: até 2 e-mails de alerta por pessoa em 7 dias, até 3 e-mails de confirmação por endereço em 24 horas, até 10 alertas por e-mail, até 10 pedidos por IP por dia e até 80 pedidos por dia no total (o plano grátis do Resend manda 100 por dia). Os dois últimos são contados no banco, de forma atômica (`alertas_contar`), com o IP guardado só como resumo HMAC. A mesma oferta com os mesmos pontos não é avisada duas vezes.
- **Privacidade**: cada e-mail vai para uma pessoa só. O log (`alertas_envios`) tem data, tipo, resultado e quantidade, sem e-mail, id ou loja. A saída do robô só tem contagens.
- **Código**: regras e envio em `servidor/alertas/`, rotas em `functions/api/alertas/`, robô em `scripts/alertas/enviar.js` e `.github/workflows/alertas.yml`, banco em `supabase/migrations/`.

Para ligar (uma vez só):

1. **Supabase**: crie o projeto (região São Paulo) e aplique, nesta ordem, `supabase/migrations/20261123000000_alertas_email.sql` e `supabase/migrations/20261124000000_alertas_limites.sql`. As tabelas têm RLS forçada, nenhuma política e nenhum grant para `anon`/`authenticated`: só a chave secreta acessa. Em **Project Settings → API Keys**, crie **duas** chaves secretas (`sb_secret_...`): uma para a Cloudflare e outra para o GitHub. Assim dá para revogar uma sem parar a outra.
2. **Resend**: crie a conta, verifique o domínio de envio (registros DNS no Cloudflare) e crie uma chave com permissão **só de envio**.
3. **Segredos**: gere 32+ caracteres aleatórios (ex.: `openssl rand -base64 48`) para `ALERTAS_SEGREDO` (assina os links; o mesmo valor vai para a Cloudflare e para o GitHub) e **outro** valor para `IP_SEGREDO` (resume o IP no limite de pedidos; só na Cloudflare).
4. **Cloudflare Pages** → `milhasdavez` → Settings → Variables and Secrets, no ambiente **Production**: `SUPABASE_URL` (variável), `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `ALERTAS_SEGREDO`, `IP_SEGREDO` (segredos) e `ALERTAS_REMETENTE` (variável, ex.: `Milhas da Vez <alertas@milhasdavez.com.br>`). Recomendado também: uma regra de Rate Limiting em `/api/alertas/*` (Security → WAF), como segunda trava.
5. **GitHub** → Settings → Environments → New environment `alertas`, com os segredos `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (a outra chave), `RESEND_API_KEY`, `ALERTAS_REMETENTE` e `ALERTAS_SEGREDO`, e a variável `ALERTAS_URL_SITE` (ex.: `https://milhasdavez.com.br`).
6. **Teste com um e-mail seu** e só então troque `ALERTAS_LIGADO` para `true` (e `TEXTOS_ATUALIZADOS_EM`, porque a Privacidade muda).

Comandos:

- `npm run alertas -- --simular`: avalia todos os alertas e conta, sem enviar nem gravar (precisa só de `SUPABASE_URL` e `SUPABASE_SECRET_KEY`).
- `npm run alertas`: rodada de verdade (o robô do GitHub faz isso sozinho quando `dados/ofertas.json` muda na `main`; também dá para rodar em Actions → alertas → Run workflow).
- `npm run test:banco`: aplica a migração num Postgres descartável no Docker e prova que `anon` e `authenticated` não leem nem apagam nada, mais os CHECKs e o limite de alertas. Não toca no Supabase.

## Plano pago (assinatura pelo Stripe)

Plano opcional que **só aumenta os limites dos alertas por e-mail** (até 50 alertas e até 7 e-mails por semana, contra 10 e 2 no grátis). A calculadora, as ofertas e a ordem do resultado são iguais para todos. **Está desligado** (`PLANO_LIGADO = false` em `scripts/paginas/config.js`) e em **modo de teste** (`PLANO_MODO_REAL = false`) até o dono aprovar.

Regras de ouro, e onde cada uma está garantida:

- **O número do cartão nunca passa pelo nosso código**: o botão "Assinar" é um link de pagamento do Stripe (`buy.stripe.com`) e o "Cancelar" é o portal do cliente do Stripe (`billing.stripe.com`). A página `/plano/` não tem formulário nem script (`testes/plano-paginas.test.mjs`).
- **A situação só muda pelo webhook com assinatura verificada**: `POST /api/plano/stripe` confere o `Stripe-Signature` (HMAC-SHA256 do corpo bruto, janela de 5 minutos) antes de qualquer coisa. Não existe rota do navegador que grave `plano_assinaturas` (`servidor/plano/webhook.js`).
- **Webhook idempotente**: o id de cada evento fica em `plano_eventos`; um aviso repetido responde 200 e não faz nada. Além disso, o webhook não confia no conteúdo do aviso: busca o cliente e as assinaturas na API do Stripe e grava o estado de agora, então avisos atrasados ou fora de ordem dão o mesmo resultado. Se algo falhar, responde 500 e o Stripe reenvia.
- **Chaves só no servidor**: `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` vivem só nos segredos da Cloudflare. O auditor (`npm run auditar`) procura chaves do Stripe no Git.
- **Modo de teste até a aprovação**: sem `PLANO_MODO_REAL=ligado` na Cloudflare, o servidor recusa chave de produção (`sk_live_`/`rk_live_`) e eventos reais; com `PLANO_MODO_REAL = false` no `config.js`, o build recusa links de pagamento que não sejam de teste. Para o modo real, o build também exige `PLANO_VENDEDOR` (nome, CPF ou CNPJ e endereço de quem vende, como pede o Decreto 7.962/2013) e `EMAIL_DE_CONTATO` (o reembolso de 7 dias é pedido por ele). Confira com o contador a nota fiscal de serviço antes de cobrar.

Estados (testados em `testes/plano.test.mjs`):

| No Stripe | Aqui | Benefício |
| --- | --- | --- |
| `active`, `trialing` | ativa | sim, até o fim do mês pago |
| `incomplete` | pendente | não |
| `past_due`, `unpaid`, `incomplete_expired`, `paused` | falhou | não (volta quando pagar) |
| `canceled` | cancelada | não |
| reembolso integral (`charge.refunded`) | reembolsada (e a assinatura é cancelada no Stripe) | não |
| contestação aberta (`charge.dispute.created`) | contestada | não, até ganhar a contestação |

Cancelar com `cancel_at_period_end` mantém o plano até o fim do mês pago.

Para ligar no **modo de teste** (o dono faz o cadastro; nada é cobrado):

1. **Stripe** (painel em modo de teste): crie o produto com preço mensal recorrente em BRL; crie um **Payment Link** para ele (peça o aceite dos Termos com o link de `/termos/`); ative o **portal do cliente** (cancelar no fim do período, trocar cartão, ver faturas) e copie o link de entrada dele.
2. **Webhook**: em Developers → Webhooks, endpoint `https://<site>/api/plano/stripe` com os eventos de `EVENTOS_TRATADOS` (`servidor/plano/webhook.js`). Copie o segredo de assinatura (`whsec_...`).
3. **Chave restrita**: Developers → API keys → chave restrita com **Customers: leitura** e **Subscriptions: escrita**.
4. **Supabase**: aplique `supabase/migrations/20261124000001_plano_pago.sql` (depois das duas dos alertas).
5. **Cloudflare Pages** → Production: segredos `STRIPE_SECRET_KEY` (a `rk_test_...`) e `STRIPE_WEBHOOK_SECRET`; `SUPABASE_URL` e `SUPABASE_SECRET_KEY` já vêm dos alertas. **Não** defina `PLANO_MODO_REAL`.
6. Em `scripts/paginas/config.js`: `PLANO_PRECO_CENTAVOS`, `PLANO_LINK_PAGAMENTO` (`https://buy.stripe.com/test_...`), `PLANO_LINK_PORTAL` (`https://billing.stripe.com/p/login/test_...`) e `PLANO_LIGADO = true` (e `TEXTOS_ATUALIZADOS_EM`).
7. Teste os quatro estados com os [cartões de teste do Stripe](https://docs.stripe.com/testing): pagar com o cartão de teste que termina em 4242; falhar com um cartão recusado ou com o relógio de teste (test clock) na renovação; cancelar pelo portal; reembolsar pelo painel. Confira em `plano_assinaturas`.

Para o **modo real**, só depois do ok do dono e do advogado: trocar a chave e o segredo do webhook pelos de produção, definir `PLANO_MODO_REAL=ligado` na Cloudflare e trocar `PLANO_MODO_REAL`, os links e o preço no `config.js`.

O que cada parte faz: regras e webhook em `servidor/plano/`, rota em `functions/api/plano/stripe.js`, página em `scripts/paginas/plano.js`, banco em `supabase/migrations/20261124000001_plano_pago.sql` (testes SQL em `supabase/testes/plano_pago.sql`, rodam com `npm run test:banco`).
## Explica pra mim

Embaixo do resultado pode aparecer o bloco **"Ficou com dúvida?"**, com o botão **"Explica pra mim"**. Ele escreve, em português simples, uma explicação do resultado e responde dúvidas como "vale a pena assinar o clube só para essa compra?".

Como funciona (e por que é seguro):

- O navegador **nunca** fala com o provedor de IA. Ele manda a loja, o valor, o perfil (ids, clube, milheiro) e a pergunta para a função `functions/api/explicar.js`, que roda na própria Cloudflare Pages. A chave da API fica só lá, como segredo.
- A função **refaz a conta com o nosso motor** e os dados publicados. O modelo recebe esse resultado pronto (com as diferenças já calculadas, como "6.000 pontos a mais") e só explica. Se o melhor jeito do servidor não for o mesmo da tela (dados mudaram), ela pede para refazer a conta.
- Modelo: **Claude Haiku 5.5** (o mais barato, US$ 0,10 / 0,50 por milhão de tokens; cerca de US$ 0,0005 por explicação). Reserva: **Claude Haiku 4.5**. Tempo-limite de 12 s por tentativa e 25 s no total, nova tentativa com espera crescente nos erros passageiros (429, 5xx, 529, rede) e troca para a reserva quando o principal não responde.
- Injeção de prompt: a pergunta é tratada como dado. Ela vai neutralizada (sem `<` `>` nem caracteres invisíveis), dentro de uma etiqueta, e as regras ficam só no `system`. A resposta é **conferida por código** antes de chegar à tela: todo número precisa estar no resultado do motor, não pode citar loja/programa/cartão de fora do resultado, nem ter link, e-mail, HTML, Markdown ou pedido de dado pessoal. Se não passar, a pessoa vê um recado fixo. A tela monta tudo com `textContent`.
- Pergunta com algo parecido com número de cartão, CPF, telefone ou e-mail nem sai do aparelho (e o servidor confere de novo).
- Limites: 10 explicações por pessoa por dia (resumo HMAC do IP, que some em 2 dias), 200 por dia no total e **teto de US$ 5 por mês** (o servidor soma o custo real de cada chamada e não chama se a próxima não couber).

O botão vem **desligado** (`EXPLICAR_LIGADO = false` em `site/js/explicar/config.js`). Sem a chave, a função responde 503 e não chama nada.

### Para ligar

1. **Conta na Anthropic** (<https://console.anthropic.com>): crie a conta, ponha crédito (o mínimo basta por meses) e, em **Limits**, defina um limite de gasto mensal baixo (por exemplo US$ 10). **Obrigatório**: é a única trava firme do teto. O teto do site reserva a vaga antes de chamar o modelo, mas o Workers KV demora até cerca de 60 segundos para mostrar o valor novo em outros pontos da rede, então pedidos no mesmo instante em lugares diferentes ainda podem passar juntos.
2. Crie uma chave em **API Keys** com o nome `milhasdavez-explicar`. Copie: ela aparece uma vez só. Não cole em arquivo, chat nem commit.
3. Antes de ligar, confira o modelo de verdade contra as tentativas de injeção, no seu computador: `ANTHROPIC_API_KEY=... npm run explicar:injecao` (custa menos de US$ 0,02). Tem que terminar com "Nenhum golpe chegou à tela".
4. **Cloudflare**: **Storage & Databases** → **Workers KV** → **Create**, nome `milhasdavez-explicar-limite`.
5. Em **Workers & Pages** → `milhasdavez` → **Settings**, só no ambiente **Production**:
   - **Bindings** → **Add** → **KV namespace**. Variable name: `EXPLICAR_LIMITE`. Namespace: `milhasdavez-explicar-limite`.
   - **Variables and Secrets** → **Add** → Type **Secret**, nome `ANTHROPIC_API_KEY`, valor: a chave do passo 2.
   - **Variables and Secrets** → **Add** → Type **Secret**, nome `IP_SEGREDO`, valor: 32+ caracteres aleatórios (ex.: `openssl rand -base64 48`). Serve só para embaralhar o IP no limite por pessoa. Se os alertas por e-mail já estiverem ligados, pode ser o mesmo `IP_SEGREDO` deles.
   - Opcional (Type **Text**): `EXPLICAR_TETO_MENSAL_USD` (padrão `5`) e `EXPLICAR_POR_DIA_TOTAL` (padrão `200`).
   - **Obrigatório**: em **Security** → **WAF** → **Rate limiting rules**, uma regra para o caminho `/api/explicar` (por exemplo, 10 pedidos por minuto por IP, bloquear por 10 minutos). Ela barra rajadas antes de chegarem à função.
   - Em **Deployments**, na publicação mais recente da `main`: **...** → **Retry deployment**.
6. **Revisão jurídica**: com o botão ligado, Privacidade e Termos ganham um trecho novo (envio da pergunta para a Anthropic, nos Estados Unidos). Mostre ao advogado junto com os outros textos.
7. Troque `EXPLICAR_LIGADO` para `true` (num PR) e atualize `TEXTOS_ATUALIZADOS_EM` em `scripts/paginas/config.js`.

Os nomes dos botões dos painéis são de memória: se algum estiver diferente, procure o mais parecido. Para desligar de novo: `EXPLICAR_LIGADO = false`, ou apague o segredo `ANTHROPIC_API_KEY` (a função passa a responder 503 na hora).
## Operação de produção

Monitor de disponibilidade, logs de erro sem dado pessoal, alerta de ofertas paradas, backup diário do banco com teste de restauração, painel de custos e plano de resposta a incidente: tudo em [docs/operacao.md](docs/operacao.md), em linguagem de quem não é de TI. Os robôs ficam em `.github/workflows/` (`disponibilidade`, `vigia`, `custos`, `backup`) e avisam abrindo uma issue com a etiqueta `operacao`. Cada um fica desligado até receber a configuração descrita no guia.

## Pastas

- `site/`: o código do site, legível (`js/motor/` guarda o cálculo puro, sem interface; `js/tela/` monta a tela inicial e só exibe o que o motor devolve; `_headers` define os cabeçalhos de segurança).
- `dados/`: programas, cartões, lojas e ofertas em JSON, com os schemas (JSON Schema 2020-12) em `dados/schemas/`. Valores em reais (`valor_milheiro_brl`, `anuidade_brl`) ficam em centavos inteiros. O que não se sabe fica `"A_CONFIRMAR"` e não entra no cálculo. `npm run validar` aponta arquivo, registro e campo de cada erro.
- `dist/`: o que vai para a internet, gerado por `npm run build` a partir de `site/` (minificado). Não editar à mão.
- `testes/`: testes com `node --test`.
- `scripts/`: validação dos dados, geração de páginas por loja, montagem de `dist/` (`scripts/publicar/`) e o fluxo semanal de ofertas (`coletar.js`, `extrair.js`, `propor-mudancas.js`, `aprovar-mudancas.js` e `scripts/atualizacao/`).
- `coleta/`: gerada pelo fluxo semanal, fica fora do Git.
- `functions/`: funções da Cloudflare Pages (`api/reportar.js`, `api/alertas/`, `api/plano/stripe.js` e `api/explicar.js`). `site/_routes.json` faz só `/api/*` passar por elas; o resto do site continua estático.
- `servidor/`: o código dessas funções, testado com `node --test` (`servidor/reportar/`, `servidor/alertas/`, `servidor/plano/` e `servidor/explicar/`).
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
