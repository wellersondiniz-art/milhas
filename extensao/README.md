# Extensão de navegador (Manifest V3)

Na página de produto de uma loja cadastrada, a extensão lê o preço visível e mostra um selo discreto no canto da tela:

> **Melhor jeito: 2.598 pontos com Cartão X Platinum**
> no Programa Y · vale cerca de R$ 51,96

A conta é a mesma do site: o motor de `site/js/motor/` roda dentro da extensão.

## Como as peças se encaixam

```
extensao/
  fonte/            código da extensão (o que é só dela)
    manifest.json   modelo do manifesto (a lista de sites é preenchida no build)
    conteudo.js     script de conteúdo: acha o texto do preço e desenha o selo (Shadow DOM fechado)
    servico.js      service worker: recebe o texto, faz a conta, devolve o texto do selo
    nucleo.js       a parte do service worker que não usa API do Chrome (testada no Node)
    preco.js        valida o texto do preço (não confiável) e converte em centavos
    selo-texto.js   monta "Melhor jeito: X pontos com [cartão]"
    relogio.js      "agora" no horário de São Paulo
    opcoes.*        página de opções: escolher cartões e programas, ou trazer o perfil do site
    icones/
  seletores.json    ONDE está o preço em cada loja (dado, fácil de corrigir)
  PRIVACIDADE.md    política de privacidade para a Chrome Web Store
  PERMISSOES.md     permissões pedidas, com justificativa
  pacote/           GERADA por npm run extensao (fora do Git): é esta pasta que se carrega no Chrome
```

### Motor compartilhado, sem cópia no Git

Extensão não consegue carregar arquivo de fora da própria pasta. Então o build (`scripts/extensao/montar.js`) copia, a cada `npm run extensao`, a pasta `site/js/motor/` e o arquivo `site/js/perfil/formato.js` para dentro de `extensao/pacote/`, sem mudar nada. A fonte da verdade continua uma só: corrigiu o motor do site, a próxima montagem da extensão já leva a correção. Um teste confere que os arquivos do pacote são idênticos aos do site.

### Dados dentro do pacote

Lojas, cartões, programas, ofertas e câmbio (`dados/*.json`) entram no pacote, num `dados.js` gerado. A extensão não baixa nada depois de instalada: é isso que permite a CSP com `connect-src 'none'`. O custo: oferta nova só chega com uma versão nova da extensão. Na Fase 2, depois de cada atualização semanal de ofertas, rode `npm run extensao` e publique a versão nova (suba `version` em `fonte/manifest.json`).

### O perfil

Fica em `chrome.storage.local`, separado do `localStorage` do site (navegador não deixa um ler o do outro). Para não preencher duas vezes, a página de opções aceita o arquivo que o site gera em **Meu perfil → Exportar perfil** (formato versão 2), validado pelo mesmo código do site. Sem perfil, o selo conta com todos os cartões e avisa.

## Comandos

| Para quê | Comando |
| --- | --- |
| Montar a extensão | `npm run extensao` (gera `extensao/pacote/`) |
| Montar para conferir seletores novos | `npm run extensao:conferir` (inclui seletores `A_CONFIRMAR`; não publique) |
| Testar | `npm run test:extensao` (Playwright, páginas de exemplo locais) e `npm run test:unidade` |

## Testar no seu Chrome

1. `npm run extensao` (ou `npm run extensao:conferir`, veja abaixo).
2. Abra `chrome://extensions`, ligue o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e escolha a pasta `extensao/pacote`.
3. A página de opções abre sozinha. Marque seus cartões e programas (ou traga o arquivo do site).
4. Abra uma página de produto de uma loja ativa.

Depois de rodar o build de novo, clique em **Recarregar** (ícone de seta) no cartão da extensão em `chrome://extensions`.

## Quando a loja muda o layout (ou para ativar uma loja nova)

Tudo é em `extensao/seletores.json`, sem mexer em código:

```jsonc
{
  "loja_id": "magalu",                       // id de dados/lojas.json
  "status": "verificado",                    // ou "A_CONFIRMAR" (não entra no pacote)
  "hosts": ["www.magazineluiza.com.br"],     // endereço exato; precisa ser do domínio da loja
  "caminho_produto": "/p/[a-z0-9]+/",        // expressão regular: o que é página de produto
  "seletores_preco": [                       // tenta em ordem; o primeiro que achar vale
    { "css": "[data-testid=\"price-value\"]", "formato": "texto" },
    { "css": "meta[itemprop=\"price\"]", "atributo": "content", "formato": "decimal" }
  ],
  "fonte_url": "https://www.magazineluiza.com.br/.../p/abc123/",  // página onde você conferiu
  "verificado_em": "2026-11-22"
}
```

- `formato: "texto"` lê o texto visível ("R$ 1.299,00"); `"decimal"` lê um atributo com ponto decimal ("1299.00").
- `atributo` só aceita `content`, `aria-label` ou `data-*`.
- Para achar o seletor: na página do produto, clique com o botão direito no preço → **Inspecionar**. Prefira atributos estáveis (`data-testid`, `itemprop`) a classes com letras aleatórias.
- Para conferir: deixe `status: "A_CONFIRMAR"`, rode `npm run extensao:conferir`, carregue o pacote e abra 2 ou 3 produtos da loja. Se o selo aparecer com a conta do preço certo, troque para `"verificado"` com `fonte_url` e `verificado_em`, e rode `npm run extensao`.
- `npm run extensao` recusa o arquivo se algo estiver fora do formato (host de outro domínio, regex inválida, loja verificada sem fonte).

Se o seletor parar de funcionar, a extensão simplesmente não mostra o selo naquela loja: ela nunca quebra a página.

**Situação em 23/11/2026:**

- **Magalu: verificada.** O preço em destaque na Magalu costuma ser o do Pix, e Pix não rende pontos do cartão. Por isso a extensão lê o preço **no cartão**, na linha das parcelas ("ou R$ 3.699,00 em 10x", ou "ou 1x de R$ 39,99"), recortado pela expressão em `extrair`. Se a linha não aparecer, não há selo.
- **Amazon e Mercado Livre: ainda `A_CONFIRMAR`.** A Amazon mostrou uma tela anti-robô e depois deu erro 503, e o Mercado Livre pediu login antes de mostrar produtos. Os seletores dessas duas lojas continuam como candidatos.

`extrair` (opcional) é uma expressão regular com um grupo de captura: ela só escolhe o pedaço do texto, e o pedaço ainda passa pela validação do preço.

## Publicar na Chrome Web Store

É com você (conta de desenvolvedor do Google, taxa única). Passos:

1. Verifique ao menos uma loja em `seletores.json`.
2. `npm run extensao` e compacte o **conteúdo** de `extensao/pacote/` num .zip (o `manifest.json` na raiz do zip).
3. No painel da Chrome Web Store: envie o zip, preencha as permissões com o texto de `PERMISSOES.md` e informe a URL pública da política de privacidade (o conteúdo está em `PRIVACIDADE.md`; ele precisa estar publicado num endereço, por exemplo uma página do site).
