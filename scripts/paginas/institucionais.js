// Páginas institucionais: Como funciona, Sobre os dados, Privacidade,
// Termos de uso e Contato.
//
// ATENÇÃO: estes textos ainda precisam ser revisados por um advogado antes de
// valer de vez. Enquanto REVISAO_JURIDICA_PENDENTE (config.js) for true, cada
// página mostra o aviso "Texto em revisão" no topo, fica fora do sitemap e
// pede aos buscadores para não listar.
//
// Regras para mexer nos textos:
//   - Escreva para o cliente, em português simples: "você" e "a gente".
//     Nada de linguagem de contrato ("o usuário declara", "fica vedado").
//   - Nada de promessa de ganho. Os números são estimativas.
//   - Só diga o que o site faz de verdade. Se o código mudar (métrica, link de
//     afiliado, canal de contato), estes textos mudam junto, e a data
//     TEXTOS_ATUALIZADOS_EM (config.js) também.
//   - Milheiro, clube e bônus são explicados em "Palavras desta página".
//
// Funções puras: recebem a data e a URL base e devolvem os arquivos.

import { formatarData } from '../../site/js/motor/index.js';
import { EMAIL_DE_CONTATO, NOME_DO_SITE, REVISAO_JURIDICA_PENDENTE, TEXTOS_ATUALIZADOS_EM } from './config.js';
import { h, juntar } from './html.js';
import { alerta, documento, termosExplicados, urlAbsoluta } from './moldura.js';

const A_CONFIRMAR = 'A_CONFIRMAR';
const RAIZ = '../';
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

// ---------------------------------------------------------------------------
// Peças de texto

const p = (...filhos) => h('p', {}, ...filhos);
const lista = (itens) => h('ul', { class: 'pagina__lista' }, itens.map((item) => h('li', {}, item)));
const passos = (itens) => h('ol', { class: 'pagina__lista' }, itens.map((item) => h('li', {}, item)));
const forte = (texto) => h('strong', {}, texto);
const link = (pasta, texto) => h('a', { href: `${RAIZ}${pasta}` }, texto);

function secao(id, titulo, ...corpo) {
  return h('section', { class: 'pilha--sm', 'aria-labelledby': id },
    h('h2', { id, class: 'pagina__subtitulo' }, titulo),
    ...corpo);
}

const meuPerfil = () => link('#/perfil', 'Meu perfil');
const contato = (texto = 'Contato') => link('contato/', texto);
const termos = (texto = 'Termos de uso') => link('termos/', texto);
const sobreOsDados = (texto = 'Sobre os dados') => link('sobre-os-dados/', texto);
const privacidade = (texto = 'Privacidade') => link('privacidade/', texto);

// ---------------------------------------------------------------------------
// Como funciona

function comoFunciona() {
  return {
    pasta: 'como-funciona',
    titulo: 'Como funciona',
    descricao: `Como o ${NOME_DO_SITE} calcula quantos pontos e milhas uma compra rende, e o que fica de fora da conta.`,
    abertura: 'Você diz a loja e o valor da compra. A gente faz a conta e mostra qual jeito de pagar rende mais pontos, e quanto esses pontos valem em reais, mais ou menos.',
    corpo: [
      secao('passo-a-passo', 'Passo a passo', passos([
        'Você escolhe a loja e digita quanto vai gastar.',
        'A gente olha as ofertas de pontos que estão valendo hoje nessa loja e os pontos que cada cartão dá.',
        juntar('Se você marcou os seus cartões e programas em ', meuPerfil(), ', a conta usa só o que é seu. Se não marcou, usamos todos os que conhecemos.'),
        'Para cada jeito de pagar (um programa de pontos com um cartão), somamos os pontos que a compra rende.',
        'Mostramos do jeito que rende mais para o que rende menos, com a conta aberta para você conferir.',
      ])),
      secao('de-onde-vem', 'De onde vêm os pontos',
        p('Uma compra pode render pontos de dois lugares:'),
        lista([
          juntar(forte('Da loja.'), ' Algumas lojas dão pontos de um programa para cada real gasto, durante uma oferta. Às vezes a oferta dá mais pontos para quem assina o clube do programa ou para quem paga com um cartão específico.'),
          juntar(forte('Do cartão.'), ' O cartão de crédito dá pontos pelo que você gasta nele. Muitos bancos contam isso em pontos por dólar, mesmo em compra no Brasil. Aí convertemos o valor da compra pela cotação do dólar.'),
        ]),
        p('Quando a regra da oferta diz que os pontos da loja e os do cartão se somam, a gente soma. Quando diz que não, ou quando não conseguimos confirmar, contamos só o maior dos dois. Assim a conta não mostra pontos a mais.')),
      secao('valor-em-reais', 'Quanto os pontos valem em reais',
        p('Pontos não são dinheiro. Para comparar, usamos o valor do milheiro, que é quanto valem 1.000 pontos, em média. Um exemplo com números inventados: se 1.000 pontos valessem R$ 20,00, uma compra que rende 2.000 pontos daria cerca de R$ 40,00 em pontos.'),
        p('Esse valor é uma estimativa. Na hora de usar, os pontos podem valer mais ou menos, dependendo do que você troca. Se você sabe quanto valem os seus pontos, troque o valor em ', meuPerfil(), '. Quando não temos o valor do milheiro de um programa, mostramos só os pontos.')),
      secao('fora-da-conta', 'O que fica fora da conta', lista([
        'Regras que ainda não conseguimos confirmar numa fonte oficial.',
        'Ofertas que já acabaram ou que ainda não começaram.',
        'Ofertas que a gente ainda não conhece.',
        'Bônus na transferência de pontos entre programas, cashback, frete, anuidade do cartão e o preço do produto em outras lojas.',
      ]), p('Mais detalhes em ', sobreOsDados(), '.')),
      secao('mesma-conta', 'A conta é sempre a mesma',
        p('A conta segue regras fixas, escritas no código do site, sem inteligência artificial e sem palpite. A mesma compra, no mesmo dia, dá sempre o mesmo resultado.'),
        p('E a conta é feita no seu próprio aparelho: o valor que você digita e os cartões que você marca não vão para nenhum servidor. Veja ', privacidade(), '.')),
      secao('nao-fazemos', 'O que a gente não faz', lista([
        'Não vendemos nada e não cobramos nada.',
        'Não entramos na sua conta do banco, da loja ou do programa de pontos.',
        'Não creditamos pontos: quem credita é o programa, depois que a loja confirma a compra.',
        juntar('Não garantimos que os pontos vão cair. Confira as regras na loja antes de comprar (veja os ', termos(), ').'),
      ])),
    ],
  };
}

// ---------------------------------------------------------------------------
// Sobre os dados

function sobreDados() {
  return {
    pasta: 'sobre-os-dados',
    titulo: 'Sobre os dados',
    descricao: `De onde vêm as ofertas, os cartões e os programas do ${NOME_DO_SITE}, com que frequência conferimos e o que é estimativa.`,
    abertura: 'Tudo o que entra na conta vem de páginas oficiais das lojas, dos bancos e dos programas de pontos. Cada dado tem o link da fonte e a data em que foi conferido.',
    corpo: [
      secao('origem', 'De onde vêm',
        p('A gente confere à mão, uma por uma, as páginas oficiais: o regulamento da oferta na loja ou no programa, a página do cartão no site do banco e a página do programa de pontos.'),
        p('Guardamos só os fatos: quantos pontos por real, de quando a quando, para quem vale, se precisa de cupom e quando os pontos caem. Não copiamos textos de outros sites.'),
        p('Na página de cada loja, cada oferta mostra a data em que foi conferida e o link "Ver a fonte". Assim você confere direto na origem.')),
      secao('nao-confirmado', 'O que ainda não confirmamos',
        p('Quando não achamos um dado numa fonte oficial, ele fica marcado como "não confirmado" e não entra na conta. Preferimos mostrar menos pontos a mostrar um número que não sabemos se é verdade.'),
        p('Por exemplo: se não sabemos se os pontos da loja se somam aos do cartão, contamos só o maior dos dois.')),
      secao('frequencia', 'Com que frequência atualizamos',
        p('Hoje a conferência é feita à mão e ainda não tem dia fixo. Por isso cada oferta mostra a data em que foi conferida.'),
        p('A lista de ofertas e as páginas das lojas são montadas de novo cada vez que o site é atualizado, e cada página diz a data da situação que mostra. Para não depender disso, a calculadora usa a data de hoje no horário de Brasília (o dia vira à meia-noite de Brasília):'),
        lista([
          'Oferta que já acabou sai da conta depois do último dia e fica no histórico da loja.',
          'Quando faltam 3 dias ou menos para a oferta acabar, ela ganha um selo de alerta.',
          'Quando um dado foi conferido há mais de 14 dias, a conta avisa que ele pode estar desatualizado.',
          'Oferta conferida há mais de 30 dias sai da conta até ser conferida de novo.',
        ])),
      secao('estimativas', 'O que é estimativa',
        p('Alguns números não são regra da loja nem do banco. São estimativas, e você pode trocar pelos seus em ', meuPerfil(), ':'),
        lista([
          juntar(forte('Valor do milheiro.'), ' É quanto valem 1.000 pontos em reais. Usamos um valor médio, com a fonte indicada. Na prática, depende de como você usa os pontos. Para alguns programas ainda não temos esse valor; nesses casos, mostramos só os pontos.'),
          juntar(forte('Cotação do dólar.'), ' Muitos cartões dão pontos por dólar gasto, mesmo em compra no Brasil. Para converter, usamos a cotação oficial do Banco Central (PTAX de venda) quando ela já foi conferida, ou a cotação que você informar. O banco do seu cartão pode usar outra cotação, então os pontos do cartão podem mudar um pouco. Sem nenhuma cotação, os pontos desse cartão ficam fora da conta, com um aviso.'),
          juntar(forte('Prazo para os pontos caírem.'), ' Mostramos o prazo que a regra da oferta informa. Quem credita os pontos é o programa.'),
        ]),
        p('Como a conta depende dessas estimativas e de regras que mudam, o resultado é uma ajuda para decidir, não uma garantia. Veja os ', termos(), '.')),
      secao('achou-erro', 'Achou um erro?',
        p('Se uma oferta estiver errada, vencida ou faltando, avise pela página de ', contato(), '. Se puder, mande o link da página oficial.')),
    ],
  };
}

// ---------------------------------------------------------------------------
// Privacidade

function paginaPrivacidade() {
  return {
    pasta: 'privacidade',
    titulo: 'Privacidade',
    descricao: `O que o ${NOME_DO_SITE} guarda, onde guarda e o que nunca pede: sem número de cartão, sem CPF e sem cadastro.`,
    abertura: 'Resumo: não pedimos número de cartão, CPF nem cadastro. O que você marca fica só no seu aparelho.',
    corpo: [
      secao('nunca-pedimos', 'O que a gente nunca pede',
        lista([
          'Número do cartão, validade ou código de segurança.',
          'CPF, RG ou qualquer documento.',
          'Nome, e-mail, telefone ou endereço para usar o site.',
          'Senha ou login de banco, loja ou programa de pontos.',
        ]),
        p('Não há cadastro nem login. Você escolhe os cartões pelo nome, como "Cartão X Platinum", nunca pelo número. Se alguém pedir esses dados em nome do ', NOME_DO_SITE, ', não é a gente.')),
      secao('no-aparelho', 'O que fica no seu aparelho',
        p('Quando você usa ', meuPerfil(), ', o navegador guarda no próprio aparelho (no armazenamento local do navegador) só isto:'),
        lista([
          'os programas de pontos que você marcou, se você assina o clube de cada um e desde quando;',
          'os cartões que você marcou, pelo nome;',
          'o valor do milheiro, se você trocou o nosso pelo seu;',
          'a cotação do dólar, se você informou uma.',
        ]),
        p('Esses dados não vão para nenhum servidor, nem para a gente. A conta é feita no seu aparelho. Por isso, se você trocar de celular ou de navegador, o perfil não vai junto (veja abaixo como levar).'),
        p('Em janela anônima, o perfil some quando você fecha a janela.')),
      secao('sem-internet', 'Para funcionar sem internet',
        p('O site guarda no aparelho uma cópia das próprias páginas e da lista de ofertas, para a calculadora funcionar sem internet. Essa cópia não tem nada seu.')),
      secao('levar', 'Levar para outro aparelho',
        p('Em ', meuPerfil(), ', o botão "Exportar perfil" cria um arquivo com o que você marcou. O arquivo fica onde você salvar, e só você decide com quem compartilha. Ele tem só a lista do que você marcou e os valores que você informou, nada de número de cartão ou documento.'),
        p('"Importar perfil" lê esse arquivo no outro aparelho. A leitura também acontece só no aparelho.')),
      secao('apagar', 'Como apagar', lista([
        juntar('Em ', meuPerfil(), ', toque em "Apagar tudo". Some tudo o que você marcou neste aparelho.'),
        'Ou apague os dados do site nas configurações do navegador. Isso também tira a cópia usada sem internet.',
      ])),
      secao('cookies', 'Cookies, métricas e anúncios',
        p('O site não cria cookies. Hoje não usamos nenhuma ferramenta de métrica de visitas e não mostramos anúncios.'),
        p('Se um dia a gente passar a contar visitas, vai ser com uma ferramenta que não usa cookie e não identifica você, como a Cloudflare Web Analytics. Antes disso, esta página vai dizer qual ferramenta é e o que ela conta.')),
      secao('hospedagem', 'Quem hospeda o site',
        p('O site fica hospedado na Cloudflare. Como em qualquer site, para entregar as páginas o servidor recebe dados técnicos de cada acesso, como o endereço de internet (IP) e o tipo de navegador. A gente não usa esses dados para saber quem você é. Veja também a ',
          h('a', { href: 'https://www.cloudflare.com/privacypolicy/', rel: 'noopener noreferrer' }, 'política de privacidade da Cloudflare'), '.')),
      secao('links-fora', 'Links para outros sites',
        p('Quando você abre a fonte de uma oferta ou a página de uma loja, vai para outro site, com regras de privacidade próprias. Os nossos links não contam para o outro site de qual página você veio.')),
      secao('falar', 'Se você falar com a gente',
        p('Se você escrever pela página de ', contato(), ', a gente recebe o que você mandar, como o seu endereço de e-mail, e usa só para responder.')),
    ],
  };
}

// ---------------------------------------------------------------------------
// Termos de uso

function paginaTermos() {
  return {
    pasta: 'termos',
    titulo: 'Termos de uso',
    descricao: `As regras de uso do ${NOME_DO_SITE} em palavras simples: os números são estimativas, as regras mudam e vale o que a loja disser.`,
    abertura: `Em poucas palavras: o ${NOME_DO_SITE} faz uma conta para ajudar você a decidir. Quem decide as regras dos pontos são as lojas, os bancos e os programas. Confira sempre na loja antes de comprar.`,
    corpo: [
      secao('o-que-faz', 'O que o site faz',
        p('É uma calculadora gratuita. Você diz a loja e o valor, e o site estima quantos pontos a compra pode render em cada jeito de pagar e quanto isso vale em reais, em média. Não precisa de cadastro. Veja ', link('como-funciona/', 'Como funciona'), '.')),
      secao('estimativas', 'Os números são estimativas',
        p('A conta usa as regras que as lojas, os bancos e os programas publicaram, mais algumas estimativas, como o valor do milheiro e a cotação do dólar (veja ', sobreOsDados(), ').'),
        p('Por isso o resultado é uma estimativa. Os pontos que você vai receber de verdade podem ser diferentes, e o valor em reais depende de como você usar os pontos. Não prometemos ganho nenhum.')),
      secao('regras-mudam', 'As regras mudam',
        p('Lojas e programas mudam ofertas a qualquer hora: a oferta acaba antes, os pontos mudam, aparece uma exigência nova. A gente confere à mão e mostra a data da última conferência, mas pode acontecer de uma mudança ainda não estar aqui.')),
      secao('confira', 'Confira na loja antes de comprar',
        lista([
          'Abra a página da oferta na loja ou no programa e veja se ela ainda vale.',
          'Veja se precisa ativar a oferta, usar cupom, assinar o clube ou pagar com um cartão específico.',
          'Veja se o produto entra na oferta: às vezes ela só vale para o que a própria loja vende e entrega.',
        ]),
        p(forte('Se a loja ou o programa disserem uma coisa e o site disser outra, vale o que a loja e o programa disserem.'))),
      secao('quem-responde', 'Quem cuida dos seus pontos',
        p(`O ${NOME_DO_SITE} não é loja, banco nem programa de pontos. Não vendemos produtos, não emitimos cartão e não creditamos pontos. Se os pontos não caírem, quem resolve é o programa ou a loja. Se quiser, avise a gente também, para corrigirmos a informação.`)),
      secao('nao-e-conselho', 'Não é conselho financeiro',
        p('O site não diz se vale a pena fazer um cartão, assinar um clube ou comprar alguma coisa. Ele só compara pontos. Anuidade, juros e o preço do produto em outras lojas ficam por sua conta.')),
      secao('como-se-mantem', 'Como o site se mantém',
        p('Hoje o site não ganha nada quando você compra: não usamos link de afiliado e não recebemos de lojas, bancos ou programas. Os nomes deles aparecem só para identificar cada um.'),
        p('Se um dia isso mudar, vamos avisar de forma clara, perto de cada link, que podemos ganhar uma comissão sem custo extra para você. E a ordem do resultado vai continuar sendo só pelos pontos.')),
      secao('mudancas', 'Mudanças neste texto',
        p('Se este texto mudar, a data no começo da página muda junto. Dúvidas? Fale com a gente em ', contato(), '.')),
    ],
  };
}

// ---------------------------------------------------------------------------
// Contato

function paginaContato(email) {
  const temEmail = typeof email === 'string' && EMAIL.test(email);
  return {
    pasta: 'contato',
    titulo: 'Contato',
    descricao: `Como falar com o ${NOME_DO_SITE} para avisar de um erro, sugerir uma loja ou tirar uma dúvida.`,
    abertura: 'Achou um erro, quer sugerir uma loja ou tem uma dúvida? Fale com a gente.',
    corpo: [
      secao('canal', 'Como falar com a gente',
        temEmail
          ? p('Escreva para ', h('a', { href: `mailto:${email}` }, email), '.')
          : alerta('info', 'i', 'Canal de contato em preparação', p('Ainda estamos preparando o canal de contato. Assim que ele estiver pronto, o endereço aparece aqui.'))),
      secao('o-que-mandar', 'O que ajuda na mensagem', lista([
        'Erro numa oferta: diga a loja e, se tiver, mande o link da página oficial.',
        'Loja, cartão ou programa que falta: diga o nome.',
        'Dúvida sobre a conta: diga a loja e o valor que você usou.',
      ])),
      secao('nunca-mande', 'Nunca mande',
        p('Número de cartão, CPF, senha ou foto de documento. A gente nunca pede isso. Veja ', privacidade(), '.')),
      secao('pontos-nao-cairam', 'Os pontos não caíram?',
        p('A gente não tem acesso à sua conta no programa nem na loja. Se os pontos de uma compra não caíram, fale com o programa de pontos ou com a loja: só eles conseguem resolver.')),
    ],
    temEmail,
  };
}

// ---------------------------------------------------------------------------
// Montagem

function montar(pagina, { revisaoPendente, urlBase, atualizadoEm }) {
  const caminho = `${pagina.pasta}/`;
  const tituloCompleto = `${pagina.titulo} | ${NOME_DO_SITE}`;
  const aviso = revisaoPendente
    ? alerta('aviso', '!', 'Texto em revisão',
      p('Este texto ainda vai ser revisado por um advogado e pode mudar.'))
    : null;
  const conteudo = juntar(
    h('section', { class: 'pilha--sm' },
      h('h1', {}, pagina.titulo),
      h('p', { class: 'texto-suave texto-pequeno' }, `Texto de ${formatarData(atualizadoEm)}.`),
      aviso,
      h('p', { class: 'resposta' }, pagina.abertura)),
    ...pagina.corpo,
  );
  const url = urlAbsoluta(urlBase, caminho);
  const estruturados = {
    '@context': 'https://schema.org',
    '@type': pagina.pasta === 'contato' ? 'ContactPage' : 'WebPage',
    name: tituloCompleto,
    description: pagina.descricao,
    inLanguage: 'pt-BR',
    dateModified: atualizadoEm,
    ...(url ? { url } : {}),
  };
  return {
    caminho: `${caminho}index.html`,
    conteudo: documento({
      titulo: tituloCompleto,
      descricao: pagina.descricao,
      caminho,
      raiz: RAIZ,
      urlBase,
      atual: pagina.pasta,
      dadosEstruturados: estruturados,
      semIndexar: revisaoPendente,
      principal: juntar(conteudo, termosExplicados(conteudo)),
    }),
  };
}

/** Pastas das páginas institucionais (cada uma vira <pasta>/index.html). */
export const PASTAS_INSTITUCIONAIS = ['como-funciona', 'sobre-os-dados', 'privacidade', 'termos', 'contato'];

/**
 * @param {object} opcoes
 *   urlBase          URL base já normalizada, ou null
 *   revisaoPendente  padrão: REVISAO_JURIDICA_PENDENTE (config.js)
 *   email            padrão: EMAIL_DE_CONTATO (config.js)
 *   atualizadoEm     padrão: TEXTOS_ATUALIZADOS_EM (config.js)
 * @returns {{ paginas: {caminho, conteudo}[], indexaveis: string[], avisos: string[] }}
 *   indexaveis: caminhos que entram no sitemap (nenhum enquanto a revisão estiver pendente).
 */
export function paginasInstitucionais({
  urlBase = null,
  revisaoPendente = REVISAO_JURIDICA_PENDENTE,
  email = EMAIL_DE_CONTATO,
  atualizadoEm = TEXTOS_ATUALIZADOS_EM,
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(atualizadoEm ?? '')) throw new Error(`TEXTOS_ATUALIZADOS_EM precisa ser AAAA-MM-DD (recebido: ${atualizadoEm})`);
  const contatoPagina = paginaContato(email);
  const todas = [comoFunciona(), sobreDados(), paginaPrivacidade(), paginaTermos(), contatoPagina];
  const opcoes = { revisaoPendente, urlBase, atualizadoEm };
  const avisos = [];
  if (revisaoPendente) {
    avisos.push('Páginas institucionais com REVISAO_JURIDICA_PENDENTE = true: aviso "Texto em revisão", noindex e fora do sitemap. Troque em scripts/paginas/config.js depois que um advogado revisar.');
  }
  if (email !== A_CONFIRMAR && !contatoPagina.temEmail) throw new Error(`EMAIL_DE_CONTATO inválido: ${email}`);
  if (!contatoPagina.temEmail) avisos.push('EMAIL_DE_CONTATO A_CONFIRMAR: a página Contato diz que o canal está em preparação. Defina em scripts/paginas/config.js.');
  return {
    paginas: todas.map((pagina) => montar(pagina, opcoes)),
    indexaveis: revisaoPendente ? [] : todas.map((pagina) => `${pagina.pasta}/`),
    avisos,
  };
}
