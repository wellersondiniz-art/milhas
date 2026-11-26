# Publicar o Milhas da Vez no Google Play e na App Store

Passo a passo do que **você** precisa fazer. O código do app já está pronto
neste repositório (pasta `app/`). Nada aqui cria conta, paga ou envia nada
sozinho.

Valores e regras conferidos em **23/11/2026** nas páginas oficiais listadas no
fim. Preço e regra mudam: confira de novo na hora de pagar.

> **Para o advogado:** os trechos marcados com ⚖️ precisam de revisão
> jurídica antes de publicar.

---

## 1. Resumo: custo e prazo

| | Google Play (Android) | App Store (iPhone e iPad) |
| --- | --- | --- |
| Conta | **US$ 25, uma vez só** (cartão de crédito ou débito com endereço de cobrança no Brasil; pré-pago não vale) | **US$ 99 por ano** (a Apple cobra na moeda local onde houver; o valor em R$ aparece na hora da compra) |
| Precisa de computador especial? | Não. Windows serve. | **Não precisa de Mac**: o envio é feito pelo GitHub Actions (grátis em repositório público). |
| Verificação da conta | Documento de identidade e telefone; alguns dias | Apple ID com verificação em duas etapas; costuma levar de 1 a poucos dias |
| Teste obrigatório antes de publicar | **Conta pessoal: teste fechado com 12 pessoas por 14 dias seguidos** | Não é obrigatório (TestFlight é opcional, mas recomendado) |
| Revisão | Normalmente horas a poucos dias; **até 7 dias ou mais** em casos excepcionais | **50% em menos de 24 h e 90% em menos de 48 h** |
| Prazo total realista | **3 a 4 semanas** (por causa dos 14 dias de teste) | **1 a 2 semanas** |

Outros custos: nenhum obrigatório. Domínio (`milhasdavez.com.br`) já está nos
seus planos; não é exigido pelas lojas, mas fica melhor na ficha.

---

## 2. Antes de começar: 4 decisões

1. **Identificador do app: `br.com.milhasdavez.app`.** Depois do primeiro envio
   para uma loja, ele **não muda nunca mais**. Se quiser outro, me avise antes
   de enviar.
2. **Conta de pessoa física ou de empresa.**
   - Pessoa física: mais rápida. Na App Store, **o seu nome aparece como
     vendedor**. No Google Play, a conta pessoal exige o teste com 12 pessoas.
   - Empresa (CNPJ): precisa do número **D-U-N-S** (gratuito, pedido pela
     Dun & Bradstreet; pode levar alguns dias). O nome da empresa aparece na
     loja. ⚖️ Escolha com o seu contador/advogado.
3. **E-mail de contato.** As duas lojas exigem um e-mail ou página de suporte.
   Hoje `EMAIL_DE_CONTATO` está `A_CONFIRMAR` em `scripts/paginas/config.js`.
   **Isso bloqueia a publicação.** Crie o e-mail e me passe.
4. **Endereço da política de privacidade:** `https://milhasdavez.pages.dev/privacidade/`
   (ou `https://milhasdavez.com.br/privacidade/` quando o domínio estiver
   ligado; aí troque também `ENDERECO_DO_SITE` em `site/js/nativo/config.js`).
   ⚖️ A página ainda mostra "Texto em revisão" até o advogado aprovar.

---

## 3. Google Play (Android)

### 3.1 Criar a conta (você, uma vez)

1. Entre em <https://play.google.com/console/signup> com uma conta Google
   (de preferência uma criada só para o app).
2. Escolha **pessoal** ou **organização** (ver decisão 2).
3. Pague os **US$ 25** e envie o documento quando pedirem.
4. Confirme o telefone e o e-mail de contato.

Desde **30/09/2026**, no Brasil, todo app Android instalado em aparelho
certificado precisa vir de desenvolvedor verificado. Quem fez a verificação
do Play Console já está coberto: não há passo a mais.

### 3.2 Criar a chave de envio (você, uma vez) 🔑

A chave prova que é você quem envia o app. **Nunca** coloque no repositório
(o `.gitignore` e um teste barram `.jks`, `.keystore`, `.p8` etc.).

No Windows, com o Android Studio instalado, abra o PowerShell:

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v `
  -keystore "$HOME\Documents\milhasdavez-envio.jks" -alias envio `
  -keyalg RSA -keysize 4096 -validity 10000
```

- Ele pede uma senha (use um gerenciador de senhas) e seus dados.
- Guarde o arquivo `.jks` e a senha **em dois lugares fora do computador**
  (por exemplo, um pendrive guardado e o gerenciador de senhas).
- No Play Console, deixe ligado o **Play App Signing** (padrão): o Google guarda
  a chave final do app e a sua vira só a "chave de envio". Se você perder a
  sua, o Google consegue trocar; sem o Play App Signing, perder a chave é
  perder o app.

### 3.3 Gerar o arquivo para enviar (.aab)

Escolha **um** dos dois jeitos.

**A) No seu Windows, com o Android Studio**

1. Instale o Node 22 e o Android Studio.
2. No terminal, na pasta do projeto: `npm ci` e depois `npm run app:android`.
   O Android Studio abre a pasta `app/android`.
3. Menu **Build > Generate Signed App Bundle or APK > Android App Bundle**,
   escolha o `.jks`, o apelido `envio` e as senhas, variante **release**.
4. O arquivo sai em `app/android/app/release/app-release.aab`.
5. A cada versão nova, aumente `versionCode` em `app/android/app/build.gradle`.

**B) No GitHub Actions (sem instalar nada)**

1. Converta a chave em texto (PowerShell):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Documents\milhasdavez-envio.jks")) | Set-Clipboard
   ```
2. No GitHub: **Settings > Environments > New environment** com o nome `lojas`.
   Marque **Required reviewers** com você mesmo (assim nada roda sem o seu clique).
3. Em **Environment secrets**, crie:
   - `ANDROID_CHAVE_BASE64` (cole o texto copiado),
   - `ANDROID_CHAVE_SENHA_ARQUIVO`, `ANDROID_CHAVE_APELIDO` (`envio`),
     `ANDROID_CHAVE_SENHA`.
4. **Actions > app-publicar > Run workflow**, escolha `android`.
5. No fim, baixe o artefato `milhas-da-vez-play-aab-N` (fica 7 dias).

### 3.4 Preencher a ficha no Play Console

Em **Criar app**: nome "Milhas da Vez", idioma português (Brasil), **App**,
**Gratuito**.

Em **Conteúdo do app** (Política e programas):

| Pergunta | Resposta | Por quê |
| --- | --- | --- |
| Política de privacidade | URL do item 2.4 | ⚖️ |
| Acesso ao app | Todo o app está disponível sem acesso especial | não tem login |
| Anúncios | **Não** contém anúncios | |
| Classificação do conteúdo | Categoria "Utilitário/Produtividade/Comunicação/Outro"; responder **não** a violência, sexo, linguagem, drogas, apostas; **não** compartilha local; **não** permite interação entre usuários | |
| Público-alvo | **18 anos ou mais** | fala de cartão de crédito |
| Segurança dos dados | ver item 3.5 | ⚖️ |
| Recursos financeiros | "Meu app **não** oferece recursos financeiros" | ⚖️ ver nota |
| App de governo / saúde / notícias | Não | |

> **Nota sobre "Recursos financeiros":** o app não empresta, não abre conta,
> não processa pagamento, não faz análise de crédito nem dá conselho
> individual. Ele compara pontos de programas de fidelidade. Por isso a
> resposta indicada é "não oferece". O Google pode discordar; se pedir, a
> categoria mais perto é "Outro". ⚖️

Em **Presença na loja > Ficha principal**:
- Descrição curta (até 80 caracteres): "Descubra onde comprar e com qual cartão para ganhar mais milhas."
- Descrição completa: ver item 6.
- Ícone 512 × 512: `site/img/icones/icone-512.png`.
- Gráfico de destaque 1024 × 500: ainda **não** existe (posso fazer).
- Pelo menos 2 capturas de tela do celular: ver a pasta de fotos que mandei.
- Categoria: **Compras**. E-mail de contato: o da decisão 3.

### 3.5 Segurança dos dados (Google Play) ⚖️

Respostas para o que o app faz **hoje**:

1. *O app coleta ou compartilha algum dos tipos de dados do usuário exigidos?*
   **Não.**
   - O perfil (programas, clubes, cartões pelo nome, milheiro, dólar) fica só
     no aparelho, no cofre do sistema. Pela regra do Google, dado processado
     só no aparelho não conta como coleta.
   - O app baixa do site a lista pública de lojas e ofertas. Esse pedido não
     leva nada do perfil nem cookie. A Cloudflare recebe o IP para entregar o
     arquivo, como em qualquer acesso, e a gente não guarda nem usa esse dado
     (processamento efêmero, que não precisa ser declarado).
   - Não há métrica, anúncio, login, push, câmera, localização ou contatos.
2. Com "Não", o Play não pergunta o resto; a ficha mostra
   "Nenhum dado coletado" e "Nenhum dado compartilhado".

**Quando isto muda:** se o app passar a ter reporte de erro (PR 24), alertas
por e-mail (PR 27), contas (Supabase) ou métrica dentro do app, a resposta
vira "Sim" e precisa listar e-mail, mensagens etc. Hoje esses recursos
**não** funcionam dentro do app (ver item 7).

### 3.6 Teste fechado (conta pessoal) e produção

1. **Testes > Teste fechado > Criar faixa**, envie o `.aab`.
2. Adicione **pelo menos 12 testadores** (e-mails de contas Google) e mande o
   link de participação. Eles precisam **aceitar** e ficar no teste.
3. Espere **14 dias seguidos** com 12 pessoas inscritas.
4. **Painel > Solicitar acesso à produção**, responda o questionário sobre o
   teste. Depois envie a versão para **Produção**.
5. Revisão: normalmente horas a poucos dias; o Google avisa que pode passar de 7 dias.

---

## 4. App Store (iPhone e iPad)

### 4.1 Criar a conta (você, uma vez)

1. Ative a verificação em duas etapas no seu Apple ID.
2. Baixe o app **Apple Developer** no iPhone (é o jeito mais rápido de se
   inscrever) ou use <https://developer.apple.com/programs/enroll/>.
3. Inscreva-se como **pessoa física** ou **organização** (D-U-N-S) e pague os
   **US$ 99/ano**.
4. Aceite o contrato e, em **App Store Connect > Negócios**, o acordo de
   apps gratuitos (não pede conta bancária para app grátis).

### 4.2 Registrar o app (você, uma vez)

1. <https://developer.apple.com/account/resources/identifiers/list> >
   **+** > App IDs > App > Bundle ID **explícito** `br.com.milhasdavez.app`.
   Nenhuma capability extra.
2. <https://appstoreconnect.apple.com> > **Apps > + > Novo app**: plataforma
   iOS, nome "Milhas da Vez", idioma Português (Brasil), Bundle ID acima,
   SKU `milhasdavez`.
3. Anote o **Team ID** (Membership details, 10 letras/números).

### 4.3 Enviar sem Mac, pelo GitHub Actions 🔑

1. **App Store Connect > Usuários e acesso > Integrações > Chaves da API do
   App Store Connect** > gerar chave com acesso **Admin**.
   - Por que Admin: com essa chave o Xcode da nuvem cria sozinho o
     certificado de distribuição. Com acesso menor, o envio falha.
   - Baixe o arquivo `AuthKey_XXXX.p8` (**só dá para baixar uma vez**) e
     anote o **Key ID** e o **Issuer ID**. Guarde o `.p8` como a chave do Android.
2. Converta o `.p8` em texto (PowerShell):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\AuthKey_XXXX.p8")) | Set-Clipboard
   ```
3. No ambiente `lojas` do GitHub, crie os segredos `APPLE_TEAM_ID`,
   `ASC_KEY_ID`, `ASC_ISSUER_ID` e `ASC_KEY_P8_BASE64`.
4. **Actions > app-publicar > Run workflow**, escolha `ios`. O build vai para
   o **TestFlight** em uns 15 a 30 minutos.
5. Instale o **TestFlight** no seu iPhone e teste (teste interno não passa por
   revisão).

> Este workflow ainda não rodou de verdade, porque depende das suas chaves.
> Na primeira vez, me chame: se algo falhar, eu corrijo pelo log.

### 4.4 Ficha na App Store Connect

- **Privacidade do app** ⚖️: "Coletamos dados deste app?" → **Não, não
  coletamos dados**. Rastreamento: **não**. (Mesmos motivos do item 3.5.)
- URL da política de privacidade e **URL de suporte** (página Contato, depois
  da decisão 3).
- **Classificação etária**: responder "nenhum" a tudo → deve sair **4+**. O
  app não tem navegador dentro dele (os links abrem no Safari).
- Categoria: **Compras** (secundária: Utilitários).
- Capturas: iPhone 6,9" (1320 × 2868) e iPad 13" (2064 × 2752), porque o app
  também roda em iPad. Mandei as do iPhone; as do iPad posso gerar.
- **Criptografia**: já respondido no app (`ITSAppUsesNonExemptEncryption = false`,
  só usa a do sistema).
- Notas para o revisor (sugestão): "Calculadora de pontos e milhas. Não
  precisa de login. O perfil fica no Keychain do aparelho. A lista de ofertas
  é atualizada semanalmente a partir do nosso site; sem internet, o app usa a
  cópia embutida."

### 4.5 Risco de recusa na Apple (regra 4.2)

A Apple recusa app que é "só um site empacotado" (regra 4.2) ou que é
principalmente "coleção de links" (4.2.2). O que joga a favor do nosso app:
calculadora que funciona sem internet, perfil no cofre do sistema, sem login,
links abrindo fora. Mesmo assim, **é o maior risco do projeto**. Se recusarem,
as saídas são: (a) responder ao revisor explicando o que o app faz sem
internet; (b) acrescentar recursos nativos (widget, avisos de oferta, que já
estão na Fase 3); (c) manter o iPhone só com o site instalável.

---

## 5. Regras das lojas para comparador e afiliados

| Regra | Como o app cumpre |
| --- | --- |
| Apple 4.2 / Google "webview spam": não pode ser só um site empacotado nem servir só para mandar tráfego | O conteúdo é nosso, a conta é feita no aparelho, funciona sem internet. Ver risco no item 4.5. |
| Apple 4.2.2: não pode ser principalmente propaganda ou lista de links | O app é uma calculadora; os links de loja são consequência do resultado. |
| Apple 3.1.3(e): compra de produto físico usa outro meio que não a compra dentro do app | O app não vende nada; a compra acontece no site da loja, no navegador. |
| Link de afiliado: tem de estar identificado, sem enganar | Quando houver afiliado, cada link mostra "Podemos ganhar uma comissão se você comprar por aqui, sem custo extra para você." e o resultado continua ordenado só por pontos (PR 22). ⚖️ |
| Apple 5.1.1(i): link da política de privacidade na ficha **e dentro do app** | A página Privacidade vem dentro do app (rodapé). |
| Apple 5.1.1(v): apagar conta dentro do app | Não se aplica: não há conta. "Apagar tudo" apaga o perfil. |
| Apple 2.3.3: capturas mostram o app em uso | Capturas da calculadora com resultado. |
| Google "Recursos financeiros" | Declarar que não oferece (ver nota do item 3.4). ⚖️ |
| Google: nível de API alvo | App mira Android 16 (API 36), exigido desde 31/08/2026. |
| Não usar marcas de bancos/programas como se fossem nossas | Nomes aparecem só para identificar (Termos de uso). Não usar logos de terceiros nas capturas e no ícone. ⚖️ |

---

## 6. Textos da ficha (sugestão) ⚖️

**Nome:** Milhas da Vez

**Subtítulo (Apple, 30 caracteres):** Mais pontos em cada compra

**Descrição:**

> Vai comprar? Veja antes onde e com qual cartão você ganha mais pontos e
> milhas.
>
> Escolha a loja e o valor. O Milhas da Vez compara as ofertas de pontos por
> real dos programas de fidelidade com os seus cartões e mostra quanto cada
> jeito de pagar rende, em pontos e em reais.
>
> • Sem cadastro e sem login
> • Nunca pedimos número de cartão nem CPF: você marca os cartões pelo nome
> • O seu perfil fica só no seu celular
> • Funciona sem internet com a última lista de ofertas
> • Ofertas conferidas toda semana, com a data e o link da fonte
>
> Os números são estimativas. Confira sempre a oferta na loja antes de comprar.

---

## 7. O que muda quando outros PRs entrarem

- **Reporte de erro (PR 24)** e **alertas por e-mail (PR 27)** chamam
  `/api/...` no mesmo endereço da página. Dentro do app esse endereço é o
  próprio aparelho, então **não funcionariam**. Enquanto estiverem desligados
  no site (como hoje), nada muda. Antes de ligar, decidir: esconder no app ou
  apontar para o site; e atualizar a Segurança dos dados e a Privacidade.
- **Métricas (PR 23)**: só contam quando o endereço é o domínio do site; no
  app nunca contam. Se um dia quiser métrica no app, a ficha muda.
- **Formato dos dados**: o app baixa `dados/*.json` do site. Uma versão velha
  do app vai ler os dados novos. Se o formato dos JSON mudar de um jeito que
  o código antigo não entende, o app instalado quebra. Mudança de formato =
  publicar o app antes ou manter compatível.

## 8. Atualizar o app depois

- **Ofertas da semana:** não precisa publicar nada; o app busca no site.
- **Mudança no código ou nas telas:** gerar versão nova (`versionCode` no
  Android sobe sozinho no GitHub Actions; no iOS, o número do build também) e
  mandar para revisão.

## Fontes (conferidas em 23/11/2026)

- Google Play: taxa de inscrição e documentos — <https://support.google.com/googleplay/android-developer/answer/6112435?hl=pt-BR>
- Google Play: pagamento com forma de pagamento e endereço no Brasil — <https://support.google.com/googleplay/android-developer/answer/6106161?hl=pt-BR>
- Google Play: teste com 12 testadores por 14 dias — <https://support.google.com/googleplay/android-developer/answer/14151465>
- Google Play: prazo de revisão — <https://support.google.com/googleplay/android-developer/answer/9859751>
- Google Play: Segurança dos dados — <https://support.google.com/googleplay/android-developer/answer/10787469>
- Google Play: Recursos financeiros — <https://support.google.com/googleplay/android-developer/answer/13849271>
- Google Play: nível de API alvo — <https://developer.android.com/google/play/requirements/target-sdk>
- Verificação de desenvolvedor Android no Brasil — <https://android-developers.googleblog.com/2026/03/android-developer-verification-rolling-out-to-all-developers.html>
- Google: webview e tráfego — <https://android-developers.googleblog.com/2020/10/developer-tips-and-guides-common-policy.html>
- Apple: preço do programa — <https://developer.apple.com/programs/>
- Apple: diretrizes de revisão (4.2, 4.2.2, 3.1.3(e), 5.1.1, 2.3.3) — <https://developer.apple.com/app-store/review/guidelines/>
- Apple: tempo de revisão — <https://developer.apple.com/distribute/app-review/>
- Apple: mudanças no iOS no Brasil (junho de 2026) — <https://developer.apple.com/news/?id=dhwadr2x>

As páginas de ajuda do Google não abriram direto na rede da nuvem; os dados
delas vieram dos trechos oficiais mostrados na busca. Confira na hora.
