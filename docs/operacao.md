# Operação do Milhas da Vez

Este guia explica como o site é vigiado depois que está no ar, em linguagem de quem não é de TI. São seis partes:

1. [Monitor de disponibilidade](#1-monitor-de-disponibilidade): avisa se o site cair.
2. [Logs de erro sem dado pessoal](#2-logs-de-erro-sem-dado-pessoal): guarda o que deu errado no servidor, sem nada que identifique alguém.
3. [Atualização de ofertas falhou ou parou](#3-atualização-de-ofertas-falhou-ou-parou): avisa se as ofertas ficarem velhas.
4. [Backup diário do banco](#4-backup-diário-do-banco): cópia de segurança fora do Supabase, com teste de restauração.
5. [Painel de custos](#5-painel-de-custos): quanto cada serviço já gastou no mês e o limite.
6. [Plano de resposta a incidente](#6-plano-de-resposta-a-incidente): o que fazer se vazar uma chave, se o site for invadido ou se sair uma oferta errada.

Tudo que depende de conta ou chave fica **desligado até você configurar**. Desligado, nada quebra: o robô só escreve "desligado" e termina.

## Resumo

| Parte | O que faz | Como você fica sabendo | Para ligar | Custo |
| --- | --- | --- | --- | --- |
| 1. Monitor | Abre o site a cada 5 min (UptimeRobot) e a cada 15 min (robô do GitHub) | E-mail do UptimeRobot e alerta do GitHub | Conta no UptimeRobot e a variável `SITE_URL` | Grátis |
| 2. Logs de erro | Guarda rota, tipo e mensagem do erro, já limpos | Alerta do GitHub se houver erro grave | Aplicar uma migração no Supabase | Grátis |
| 3. Ofertas | Confere todo dia se as ofertas foram atualizadas | Alerta do GitHub | Já vem ligado | Grátis |
| 4. Backup | Copia o banco todo dia, cifrado, para o Cloudflare R2; testa a restauração todo mês | Alerta do GitHub se falhar | Senha do backup, balde no R2 e 6 segredos no GitHub | Grátis até 10 GB |
| 5. Custos | Mede o mês de IA, banco e e-mail contra o limite | Alerta do GitHub a partir de 80% | Segredos do Supabase (e, se quiser, da Anthropic) | Grátis |
| 6. Incidente | Passo a passo para emergências | Você consulta quando precisar | Nada | Grátis |

## Como os alertas chegam até você

Os robôs rodam no GitHub Actions. Quando algo dá errado, o robô abre uma **issue** (um aviso) no repositório com a etiqueta `operacao`, atribuída a você. O GitHub então manda:

- um **e-mail** para o endereço da sua conta do GitHub;
- uma **notificação no celular**, se você tiver o app **GitHub Mobile** (Android ou iPhone).

Cada problema tem um aviso só. Se o problema continua, o robô não manda o mesmo texto de novo; ele só comenta quando algo muda. **Quando o problema some, o robô fecha o aviso sozinho.**

Para receber, faça uma vez (5 minutos):

1. Instale o **GitHub Mobile** e entre com a sua conta. Em Settings → Notifications, ligue as notificações push.
2. No site do GitHub, em [github.com/settings/notifications](https://github.com/settings/notifications), deixe marcado **Email** em "Participating, @mentions and custom" e em "Watching".
3. No repositório, clique em **Watch** e escolha **All Activity** (ou pelo menos "Issues").

O repositório é público. Por isso o texto dos avisos nunca traz chave, e-mail de ninguém ou detalhe técnico que ajude um atacante: só o que falhou e o link do robô.

Atenção: o GitHub **pausa os robôs agendados** de um repositório público que passa 60 dias sem nenhuma mudança. Se isso acontecer, o GitHub manda um e-mail e basta clicar em **Enable workflow** na aba Actions.

---

## 1. Monitor de disponibilidade

Dois vigias, de empresas diferentes, para um cobrir o outro.

### Principal: UptimeRobot (fora do GitHub e da Cloudflare)

Plano grátis: 50 monitores, conferência a cada 5 minutos, aviso por e-mail, uso comercial permitido. O plano pago mais barato custa a partir de US$ 12/mês e não é necessário agora. ([preços](https://uptimerobot.com/pricing/), conferidos em 24/11/2026)

Passo a passo (10 minutos):

1. Crie a conta em [uptimerobot.com](https://uptimerobot.com) com o seu e-mail.
2. Clique em **+ New monitor**. Tipo **HTTP(s)**. Endereço: `https://milhasdavez.com.br`. Intervalo: **5 minutes**. Em "How will we notify you?", marque o seu e-mail. Salve.
3. Crie um segundo monitor igual para `https://milhasdavez.com.br/dados/ofertas.json` (é o arquivo de que o comparador depende).
4. Se quiser o aviso no celular, instale o app do UptimeRobot e entre na mesma conta, ou deixe as notificações do seu app de e-mail ligadas para o remetente do UptimeRobot.

Enquanto o domínio não estiver no ar, use o endereço `https://milhasdavez.pages.dev`.

### Reserva: robô `disponibilidade` no GitHub

A cada 15 minutos, abre a página inicial e o `/dados/ofertas.json`. Se algum falhar, espera 30 segundos e tenta de novo antes de acusar (para não dar alarme falso por um soluço da rede). Fora do ar → abre o aviso "Site fora do ar" com o que falhou. Voltou → fecha o aviso.

Para ligar: GitHub → repositório → **Settings → Secrets and variables → Actions → aba Variables → New repository variable**. Nome `SITE_URL`, valor `https://milhasdavez.com.br` (só o endereço, sem barra no fim). Custo: zero (repositório público).

Para testar na hora: aba **Actions → disponibilidade → Run workflow**.

### Site fora do ar: o que fazer

1. Abra o site no celular **pelo 4G** (sem Wi-Fi). Se abrir, pode ser problema só na sua rede.
2. Veja se a Cloudflare está com problema em [cloudflarestatus.com](https://www.cloudflarestatus.com). Se estiver, é esperar.
3. No painel da Cloudflare, abra **Workers & Pages → milhasdavez → Deployments**. Se o último deploy falhou ou o site quebrou depois dele, escolha o deploy anterior que funcionava e use **Rollback**. O site volta em segundos.
4. Se aparecer erro de certificado ou "site não encontrado", confira no [Registro.br](https://registro.br) se o domínio não venceu e se o DNS continua apontando para a Cloudflare.

---

## 2. Logs de erro sem dado pessoal

As partes do site que rodam no servidor (alertas por e-mail, "Explica pra mim", plano pago, "Essa informação está errada?") passam por uma proteção comum (`functions/_middleware.js`). Se uma delas quebrar:

- quem está usando o site recebe só "Algo deu errado do nosso lado. Tente de novo em alguns minutos.", sem detalhe técnico;
- o erro é **limpo** e registrado.

**O que é guardado** (e só isto): quando aconteceu, qual parte do site (ex.: `alertas`), o caminho (ex.: `/api/alertas/inscrever`), o código de resposta (ex.: 500), o tipo do erro, a mensagem curta e o arquivo e a linha do código.

**O que nunca é guardado**: e-mail, CPF, número de cartão, telefone, endereço IP, navegador, o que a pessoa digitou, cookies, chaves e tokens. Antes de gravar, o texto passa por uma limpeza que troca esses dados por marcadores como `[email]`, `[numero]`, `[ip]` e `[segredo]`. A parte depois do `?` dos endereços é apagada. O banco tem uma segunda trava: ele recusa gravar mensagem com e-mail ou com 6 dígitos seguidos.

**Onde ver**:

- **Na hora**: Cloudflare → Workers & Pages → milhasdavez → aba de logs das Functions (Real-time logs). Cada erro aparece como uma linha `erro_operacao`.
- **Histórico de 30 dias**: Supabase → Table Editor → `operacao_erros`. O vigia diário apaga sozinho o que tem mais de 30 dias.

**Para ligar o histórico** (5 minutos):

1. Supabase → projeto milhasdavez → **SQL Editor** → cole o conteúdo de `supabase/migrations/20261124120000_operacao.sql` → **Run**. Ela cria a tabela e duas funções; ninguém de fora consegue ler (mesma proteção das tabelas dos alertas).
2. Na Cloudflare, as variáveis `SUPABASE_URL` e `SUPABASE_SECRET_KEY` já são as dos alertas. Se ainda não existirem, siga a seção "Alertas por e-mail" do README.
3. No GitHub, crie o ambiente **operacao** (Settings → Environments → New environment) com os segredos `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (pode ser a mesma chave secreta que o GitHub usa nos alertas, ou uma terceira, para revogar separado).

Sem o passo 1, os erros vão só para o log da Cloudflare, que não guarda histórico.

### Erros no servidor: o que fazer

O vigia diário abre o aviso **"Erros no servidor"** quando, nas últimas 24 horas, houve **algum erro 500** (erro que o código não esperava) ou **20 erros ou mais** de qualquer tipo.

1. Abra `operacao_erros` no Supabase e ordene por `criado_em`. Veja a coluna `origem` (qual parte) e `mensagem`.
2. Se for sempre a mesma parte e a mesma mensagem, peça a correção numa conversa nova citando a mensagem e o `local` (arquivo e linha).
3. Se a parte estiver quebrando para todo mundo e você não puder corrigir agora, desligue só ela tirando o segredo dela na Cloudflare (ex.: sem `ANTHROPIC_API_KEY`, o "Explica pra mim" some e o resto continua).

**Para quem programa**: não coloque dado pessoal em mensagem de erro, mesmo sabendo da limpeza. A limpeza é a segunda trava, não a primeira. Em código do servidor, use `registrarErro()` de `servidor/operacao/registro.js`.

---

## 3. Atualização de ofertas falhou ou parou

A atualização semanal roda **no seu computador** (`npm run coletar`, `extrair`, `propor` e `aprovar`; ver README). Se um passo falhar, o erro aparece na hora, na tela, com o que fazer. Os mais comuns:

| Mensagem | O que significa | O que fazer |
| --- | --- | --- |
| `FALHOU, a página respondeu 403` (no coletar) | O site da loja ou do programa bloqueou o robô | Abra a página no navegador; se mudou de endereço, atualize `dados/fontes.json` |
| `Falta ANTHROPIC_API_KEY` (no extrair) | A chave da IA não está no `.env` | Coloque a chave no `.env` e rode de novo |
| Muitos campos `A_CONFIRMAR` no relatório | A página mudou e o valor não foi achado | Confira à mão; o que não estiver escrito na página fica `A_CONFIRMAR` |
| `o código não confere` (no aprovar) | A proposta ou o `ofertas.json` mudaram depois do relatório | Rode `npm run propor` de novo e use o código novo |

Mesmo que você esqueça ou não veja o erro, o **robô `vigia`** confere todo dia às 9h (Brasília):

- **"Ofertas sem atualização há N dias"**: a conferência mais recente em `dados/ofertas.json` tem mais de **8 dias** (a semana mais um dia de folga). Fecha sozinho no dia seguinte ao merge da atualização. Para mudar o prazo, crie a variável `OFERTAS_PRAZO_DIAS` (ex.: `10`).
- **"Atualização de ofertas aprovada, mas sem merge"**: existe pull request de ofertas (`ofertas/AAAA-MM-DD`) aberto há mais de 3 dias. A atualização foi aprovada, mas não está no ar. Abra, veja se os testes passaram e faça o merge.
- **"Robô com falha"**: a última rodada de algum robô na main falhou. Inclui o robô dos **alertas por e-mail**, que roda logo depois de cada atualização de ofertas, e o dos **testes**. O aviso traz o link da rodada que falhou.

O vigia já vem ligado. A parte de erros do servidor só liga com os segredos do ambiente `operacao` (parte 2).

---

## 4. Backup diário do banco

**Por que**: o banco do Supabase guarda os e-mails dos alertas e os dados do plano pago. O plano grátis do Supabase **não tem backup**. O plano Pro (a partir de US$ 25/mês) guarda 7 dias, mas dentro do próprio Supabase: se a conta tiver problema, a cópia vai junto. ([preços](https://supabase.com/pricing), conferidos em 24/11/2026)

**O que o robô `backup` faz, todo dia às 3h (Brasília)**:

1. Tira uma "foto" do banco e, nessa mesma foto, faz a cópia (`pg_dump`) e um **manifesto**: quantas linhas cada tabela tem e um resumo (SHA-256) de todo o conteúdo.
2. Fecha a cópia e o manifesto num arquivo **cifrado** com a sua senha do backup (AES-256). Sem a senha, o arquivo é lixo.
3. Envia o arquivo para o **Cloudflare R2**, outra empresa, fora do Supabase.

Se falhar, abre o aviso **"Backup do banco falhou"**. No dia seguinte, se der certo, fecha sozinho.

**No dia 1 de cada mês**, o mesmo robô faz o **teste de restauração**: baixa o backup mais recente do R2, restaura num banco descartável e confere tabela por tabela contra o manifesto. Se algo não bater, abre o aviso **"Teste de restauração do backup falhou"**.

**Custo**: o R2 é grátis até 10 GB por mês ([preços](https://developers.cloudflare.com/r2/pricing/), conferidos em 24/11/2026). Cada backup tem poucos KB ou MB.

**Privacidade**: o backup tem e-mails. Por isso ele sai cifrado, nunca aparece no log e é apagado depois de **30 dias** (regra do R2, passo 2 abaixo). Quem cancela um alerta some dos backups em até 30 dias. Vale citar isso na página de Privacidade ("cópias de segurança cifradas por até 30 dias").

### Para ligar (20 minutos)

1. **Senha do backup.** No terminal, rode `openssl rand -base64 36` e copie o resultado. Guarde no seu gerenciador de senhas, **fora do GitHub**. Sem ela, nenhum backup abre, nem numa emergência.
2. **Balde no R2.** Cloudflare → **R2 Object Storage** → **Create bucket** → nome `milhasdavez-backup` → Create. Dentro do balde: **Settings → Object lifecycle rules → Add rule** → apagar objetos depois de **30 dias**.
3. **Chave do R2.** R2 → **Manage API tokens** → **Create API token** → permissão **Object Read & Write**, só para o balde `milhasdavez-backup`. Copie o **Access Key ID**, o **Secret Access Key** e o **Account ID** (aparece na mesma tela).
4. **Endereço do banco.** Supabase → projeto milhasdavez → botão **Connect** → **Session pooler** → copie o endereço (`postgresql://postgres.xxxx:[SENHA]@...pooler.supabase.com:5432/postgres`) e troque `[SENHA]` pela senha do banco. Use o "Session pooler": o robô do GitHub não alcança o endereço direto.
5. **Segredos no GitHub.** Settings → **Environments → New environment** → nome `backup`. Adicione os segredos:

   | Segredo | Valor |
   | --- | --- |
   | `BACKUP_BANCO_URL` | o endereço do passo 4 |
   | `BACKUP_SENHA` | a senha do passo 1 |
   | `R2_CONTA_ID` | o Account ID |
   | `R2_CHAVE_ID` | o Access Key ID |
   | `R2_CHAVE_SECRETA` | o Secret Access Key |
   | `R2_BALDE` | `milhasdavez-backup` |

6. **Primeiro teste.** Actions → **backup** → **Run workflow** (deixe a caixa desmarcada) → espere ficar verde. Depois, de novo, com **"Em vez de fazer backup, restaurar o mais recente e conferir"** marcado.

Se o Supabase um dia passar para o Postgres 18, crie a variável `BACKUP_PG_VERSAO` com `18`.

### Teste de restauração documentado (feito em 24/11/2026)

O teste foi feito de verdade, num Postgres local (versão 16), **sem tocar no Supabase**, com o script `npm run backup:teste`. Ele:

1. criou um banco "origem" igual ao do Supabase: os papéis `anon`, `authenticated` e `service_role`, as permissões padrão do Supabase e **as três migrações** (alertas por e-mail e plano pago, dos pull requests 27 e 31, e a da operação);
2. encheu com **dados falsos** (e-mails em `exemplo.invalid`): 25 inscrições de alerta, 25 alertas, 60 envios, 42 erros, 5 assinaturas e 5 eventos do Stripe;
3. fez o backup com o **mesmo script do robô**, só que mandando para uma pasta em vez do R2;
4. restaurou num banco vazio com o **mesmo script de restauração** e conferiu.

Resultado (saída do script, resumida):

```
Backup feito: milhas-2026-11-24T1409Z.tar.gpg (12K, cifrado), 6 tabela(s), 162 linha(s)
ok  o arquivo enviado não mostra nenhum e-mail nem nome de tabela (está cifrado)
ok  SHA-256 do arquivo confere
ok  decifrado
ok  pg_restore terminou sem erro
ok  6 tabela(s) e 162 linha(s): contagens e resumos SHA-256 iguais aos do backup
      alertas_email                25 linha(s)
      alertas_envios               60 linha(s)
      alertas_inscricoes           25 linha(s)
      operacao_erros               42 linha(s)
      plano_assinaturas            5 linha(s)
      plano_eventos                5 linha(s)
ok  todas as tabelas com RLS ligada e forçada
ok  o papel anon (chave pública) não lê nenhuma tabela do banco restaurado
ok  as funções do banco voltaram (operacao_resumo responde)
ok  recusa restaurar por cima de um banco com dados
ok  senha errada não abre o backup
ok  arquivo alterado é recusado pelo SHA-256
Teste de restauração: tudo certo.
```

O que isso prova: o backup traz **todas as linhas, idênticas** (o resumo SHA-256 de cada tabela é o mesmo antes e depois), traz junto a **proteção** (ninguém com a chave pública lê nada), **não abre sem a senha**, **acusa arquivo corrompido** e **não escreve por cima** de um banco que já tem dados.

O que ainda não foi testado: o envio e a leitura no R2 de verdade e o endereço real do Supabase, porque dependem das contas. O passo 6 de "Para ligar" e o teste automático de todo dia 1 cobrem isso.

Para repetir no seu computador: `npm run backup:teste` (precisa do Docker; ele sobe um Postgres 17 descartável).

### Restaurar de verdade (emergência)

**Nunca restaure por cima do banco em produção.** O script se recusa a escrever num banco que já tem tabelas.

1. Crie um projeto novo e vazio no Supabase (região São Paulo) e copie o endereço do Session pooler dele, como no passo 4.
2. No seu computador, na pasta do projeto, rode (troque os valores):

   ```
   RESTAURAR_URL='endereço do projeto novo' BACKUP_SENHA='senha do backup' \
   R2_CONTA_ID=... R2_CHAVE_ID=... R2_CHAVE_SECRETA=... R2_BALDE=milhasdavez-backup \
   npm run backup:restaurar -- --ultimo
   ```

   Precisa do `psql`, do `pg_restore` e do `gpg` instalados. Para usar um arquivo baixado à mão do R2, troque `--ultimo` pelo caminho do arquivo `.tar.gpg` (com o `.sha256` ao lado).
3. O script só termina com "Restauração conferida." se tudo bater.
4. Troque `SUPABASE_URL` e as chaves secretas na Cloudflare (Production) e nos ambientes `alertas`, `operacao` e `backup` do GitHub pelos do projeto novo.

### Backup falhou: o que fazer

Abra o link do aviso e veja o passo em vermelho:

- **"Não consegui abrir a foto do banco"**: o endereço ou a senha do banco mudou, ou o projeto Free do Supabase **pausou** (ele pausa depois de 1 semana sem uso). Reative no painel do Supabase e confira `BACKUP_BANCO_URL`.
- **Erro no envio ao R2 (`aws s3 cp`)**: a chave do R2 foi revogada ou o balde mudou de nome. Crie outra chave (passo 3) e atualize os segredos.
- **"server version mismatch" no pg_dump**: o Supabase atualizou o Postgres. Crie a variável `BACKUP_PG_VERSAO` com a versão nova.

Depois de corrigir, rode à mão (Actions → backup → Run workflow).

### Teste de restauração falhou: o que fazer

É sério: o backup pode não servir numa emergência. Veja a mensagem da rodada:

- **"Não consegui decifrar"**: a `BACKUP_SENHA` do GitHub não é a mesma usada no backup. Confira com a cópia do gerenciador de senhas.
- **"A restauração NÃO confere"**: o script lista as tabelas diferentes. Peça ajuda numa conversa nova com essa lista (ela não tem dado pessoal).
- **"Nenhum backup encontrado"**: o backup diário não está rodando. Veja o aviso de backup.

---

## 5. Painel de custos

O robô **`custos`** roda todo dia às 9h30 (Brasília). Para ver o painel: aba **Actions → custos → a rodada mais recente**; a tabela aparece no resumo da página. Para ver no seu computador: `npm run custos`.

Exemplo de como ele aparece:

| Serviço | Plano | O que é medido | Usado | Limite | % | Situação |
| --- | --- | --- | --- | --- | --- | --- |
| IA (Anthropic) | Pago por uso | Gasto no mês | US$ 0,42 | US$ 10,00 | 4% | ok |
| Banco (Supabase) | Free | Tamanho do banco | 9,8 MB | 500,0 MB | 1% | ok |
| E-mail (Resend) | Free | E-mails no mês | 2.450 | 3.000 | 81% | ATENÇÃO |
| E-mail (Resend) | Free | E-mails nas últimas 24 h | 12 | 100 | 12% | ok |

Quando **qualquer linha passa de 80%** do limite, o robô abre o aviso **"Custo passou de 80% do limite"** (ou **"Limite de custo estourado"** a partir de 100%). Enquanto continuar alto, ele comenta uma vez por dia com os números novos. Fecha sozinho quando tudo volta para baixo de 80%.

**Os limites** ficam em `operacao/custos.json`, em centavos de dólar (ex.: `1000` = US$ 10,00). Para mudar o limite ou o ponto de alerta (`alerta_percentual`), edite esse arquivo. Hoje:

| Serviço | Plano hoje | Limite no painel | Fonte |
| --- | --- | --- | --- |
| IA (Anthropic) | pago por uso | US$ 10/mês (US$ 5 do "Explica pra mim" + folga para a extração semanal, que custa menos de US$ 0,01 por página) | [preços](https://platform.claude.com/docs/en/about-claude/pricing) |
| Banco (Supabase) | Free: US$ 0 | 500 MB de banco | [preços](https://supabase.com/pricing) |
| E-mail (Resend) | Free: US$ 0 | 3.000 e-mails/mês e 100/dia | [preços](https://resend.com/pricing) |
| Site e backup (Cloudflare Pages e R2) | Free: US$ 0 | R2 até 10 GB | [preços](https://developers.cloudflare.com/r2/pricing/) |
| Monitor (UptimeRobot) | Free: US$ 0 | 50 monitores | [preços](https://uptimerobot.com/pricing/) |

Quando crescer: Supabase Pro a partir de US$ 25/mês; Resend Pro US$ 20/mês com 50.000 e-mails (e-mail extra a US$ 0,90 por mil). Fora do painel: a anuidade do domínio no Registro.br e, se você ligar as métricas, o Plausible.

### As travas de verdade ficam em cada serviço

O painel **avisa**; quem **corta o gasto** é a configuração de cada serviço. Faça uma vez:

1. **Anthropic (IA)**: Console da Anthropic → **Settings → Limits** → defina um limite mensal de gasto de **US$ 10**. Ao chegar nele, a API para de responder: o "Explica pra mim" mostra a mensagem de indisponível e a extração semanal para. O "Explica pra mim" ainda tem o teto próprio de US$ 5 por mês, no código.
2. **Supabase**: no plano Free não há cobrança. Se passar para o Pro, deixe o **Spend Cap** ligado (vem ligado por padrão).
3. **Resend**: no plano Free, ao chegar no limite os e-mails param de sair; não há cobrança.
4. **Cloudflare**: Pages e R2 no plano grátis não cobram sem cartão cadastrado.

### Para ligar as medições

- **Banco e e-mail**: os mesmos segredos `SUPABASE_URL` e `SUPABASE_SECRET_KEY` do ambiente `operacao` (parte 2), e a migração da operação aplicada.
- **IA (opcional)**: a API da Anthropic só mostra o gasto para uma **chave de administrador** (Console → Settings → Admin keys; só quem é admin da organização cria). Ela é poderosa: além de ler custos, gerencia a organização. Se preferir não guardar essa chave no GitHub, deixe a linha "sem medição" e confira o gasto no Console uma vez por semana; o limite do passo 1 continua protegendo. Se quiser a medição, crie o segredo `ANTHROPIC_ADMIN_KEY` no ambiente `operacao`. Na primeira rodada com a chave, confira se o valor bate com o do Console.

---

## 6. Plano de resposta a incidente

Uma página para ter à mão. Em qualquer caso: **primeiro conter, depois investigar, por último corrigir a causa.** Anote o que fez e a hora.

### A. Vazou uma chave (apareceu no GitHub, num print, num e-mail, num chat)

**1. Revogue na hora** (antes de qualquer outra coisa; apagar do código não basta, a chave continua valendo):

| Chave | Onde revogar e criar outra | Onde trocar a nova |
| --- | --- | --- |
| Anthropic (`ANTHROPIC_API_KEY`, admin) | Console da Anthropic → API keys (ou Admin keys) | Cloudflare (Production), `.env` do seu computador, ambiente `operacao` |
| Supabase chave secreta (`sb_secret_...`) | Supabase → Project Settings → API Keys | Cloudflare e ambientes `alertas`/`operacao` do GitHub (cada lugar tem a sua: revogue só a que vazou) |
| Senha do banco | Supabase → Project Settings → Database → Reset password | `BACKUP_BANCO_URL` no ambiente `backup` |
| Resend (`re_...`) | Resend → API Keys | Cloudflare e ambiente `alertas` |
| Stripe (`rk_...`, `whsec_...`) | Stripe → Developers → API keys / Webhooks (roll secret) | Cloudflare |
| R2 | Cloudflare → R2 → Manage API tokens | ambiente `backup` |
| Senha do backup (`BACKUP_SENHA`) | gere outra (`openssl rand -base64 36`) | ambiente `backup` e gerenciador de senhas; depois **apague do R2 os backups antigos**, que abrem com a senha velha |
| `ALERTAS_SEGREDO` | gere outro | Cloudflare e ambiente `alertas` (os links "cancelar alerta" de e-mails antigos param de funcionar) |
| Token ou senha do GitHub | github.com → Settings → Developer settings / Password | onde ele era usado |

**2. Procure uso indevido** desde a data em que a chave pode ter vazado:

- Anthropic: Console → **Usage**, filtrando pela chave. Gasto que não é seu?
- Supabase: **Logs** (API e Postgres). Leituras ou apagões fora do normal? Tabelas com menos linhas que o último backup?
- Resend: **Emails/Logs**. E-mails que o site não mandou?
- Stripe: **Developers → Logs e Events**. Reembolsos, clientes ou preços que você não criou?
- Cloudflare: **Manage Account → Audit Log**. GitHub: **Settings → Security log**.

**3. Corrija a causa**: tire a chave do arquivo onde apareceu, rode `npm run auditar` e veja por que ela foi parar lá. Chave só em variável de ambiente, nunca no código.

### B. O site foi invadido (página alterada, link estranho, redirecionamento, aviso do navegador)

1. **Volte uma versão boa**: Cloudflare → Workers & Pages → milhasdavez → **Deployments** → escolha um deploy anterior ao problema → **Rollback**. Se nada for confiável, tire o domínio do ar até entender (Custom domains → remover).
2. **Feche as portas**: troque as senhas do GitHub, da Cloudflare, do Supabase e do Registro.br, confirme que todas têm **verificação em duas etapas**, e revogue todas as chaves (tabela A).
3. **Descubra o que mudou**: no GitHub, veja os commits recentes na main (Insights → Network ou a lista de commits) e o Security log; na Cloudflare, o Audit Log e quem fez cada deploy.
4. **Se dados pessoais podem ter vazado** (e-mails dos alertas ou do plano): pela LGPD, é preciso comunicar a **ANPD** e as pessoas afetadas. O prazo da ANPD é de **3 dias úteis** (Resolução CD/ANPD nº 15/2024). Procure um advogado logo no primeiro dia. O backup (parte 4) diz quantas pessoas estavam no banco e em que data.
5. **Só volte ao ar** depois de corrigir a porta de entrada, com os testes e `npm run auditar` passando.

### C. Foi publicada uma oferta errada

1. **Tire do ar rápido**: no GitHub, abra o pull request de ofertas que entrou (`ofertas/AAAA-MM-DD`) e clique em **Revert**; faça o merge do pull request de reversão. O site volta aos dados anteriores em poucos minutos. Se só um campo estava errado, edite `dados/ofertas.json` trocando o valor por `"A_CONFIRMAR"` (não entra no cálculo) e faça o merge.
2. **Avise quem pode ter sido afetado**: se o alerta por e-mail saiu com a oferta errada, mande uma correção. Se alguém reclamou pelo Contato, responda dizendo o que estava errado e quando foi corrigido.
3. **Descubra como passou**: veja no relatório da semana (`coleta/AAAA-MM-DD/relatorio.md`) se o valor estava marcado como suspeito e qual trecho da página o justificava. Se a página da loja estava certa e o erro foi nosso, anote a regra que faltou e peça para ela virar teste.

---

## Onde fica cada coisa (para quem programa)

| Parte | Arquivos |
| --- | --- |
| Alertas (issues) | `scripts/operacao/alerta.js` |
| 1. Monitor | `scripts/operacao/disponibilidade.js`, `.github/workflows/disponibilidade.yml` |
| 2. Logs | `servidor/operacao/registro.js`, `servidor/operacao/middleware.js`, `functions/_middleware.js`, `site/_routes.json`, `supabase/migrations/20261124120000_operacao.sql`, `supabase/testes/operacao.sql` |
| 3. Ofertas | `scripts/operacao/vigia.js`, `.github/workflows/vigia.yml` |
| 4. Backup | `scripts/operacao/backup/` (`fazer-backup.sh`, `restaurar.sh`, `manifesto.sql`, `teste-local.sh`), `supabase/testes/dados-falsos-backup.sql`, `.github/workflows/backup.yml` |
| 5. Custos | `scripts/operacao/custos.js`, `operacao/custos.json`, `.github/workflows/custos.yml` |
| Testes | `testes/operacao.test.mjs` (roda no `npm test`) |

Comandos: `npm run monitor`, `npm run vigia`, `npm run custos`, `npm run backup`, `npm run backup:restaurar`, `npm run backup:teste`.
