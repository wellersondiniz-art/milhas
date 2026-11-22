// Monta as páginas estáticas (uma por loja + ofertas de hoje), o sitemap e o
// robots.txt. Funções puras: recebem os dados, a data de hoje e a URL base e
// devolvem a lista de arquivos com o conteúdo. Não leem disco nem relógio.
//
// Os números ("rende X pontos por real", "R$ Y a cada R$ 100") vêm SEMPRE do
// motor (site/js/motor). Aqui só se escolhe o cenário e as palavras.

import { calcularJeitosDeComprar, formatarData } from '../../site/js/motor/index.js';
import { formatarNumero, pontosPorReal } from '../../site/js/motor/formatar.js';
import { fraseDoJeito } from '../../site/js/tela/textos.js';
import { NOME_DO_SITE } from './config.js';
import { escaparXml, h, jsonLd, juntar, linkExterno } from './html.js';

export const A_CONFIRMAR = 'A_CONFIRMAR';
const ID_SEGURO = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Clube assinado "há muito tempo": cumpre qualquer exigência de horas. */
const CLUBE_DESDE = '2000-01-01';
const UM_REAL = 100;
const CEM_REAIS = 10_000;

// ---------------------------------------------------------------------------
// Pequenos textos

const PREPOSICAO = { a: 'na', o: 'no', as: 'nas', os: 'nos' };

/** "na Magalu", "no Mercado Livre", "nas Casas Bahia". */
export function naLoja(loja) {
  return `${PREPOSICAO[loja.artigo] ?? 'na'} ${loja.nome}`;
}

function maiuscula(texto) {
  return texto[0].toUpperCase() + texto.slice(1);
}

function confirmado(v) {
  return v !== undefined && v !== null && v !== A_CONFIRMAR;
}

/** Texto de pontos que já saiu do motor ("15", "1,5") → "15 pontos por real". */
function porRealTexto(texto) {
  return `${texto} ${texto === '1' ? 'ponto' : 'pontos'} por real`;
}

function plural(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`;
}

// ---------------------------------------------------------------------------
// Conta (sempre pelo motor)

function perfilDoCenario(dados, { clube, cartoes }) {
  return {
    programas: dados.programas.map((p) => (
      clube ? { programa_id: p.id, clube_ativo: true, clube_ativo_desde: CLUBE_DESDE } : { programa_id: p.id, clube_ativo: false }
    )),
    cartoes: cartoes ? dados.cartoes.map((c) => c.id) : [],
    valor_milheiro_brl: {},
  };
}

// Do mais simples ao mais completo. Em empate de pontos, vence o mais simples
// (assim a página não pede clube ou cartão que não muda nada).
const CENARIOS = [
  { clube: false, cartoes: false },
  { clube: false, cartoes: true },
  { clube: true, cartoes: false },
  { clube: true, cartoes: true },
];

const chaveDoJeito = (j) => `${j.tipo}|${j.oferta_id ?? ''}|${j.cartao?.id ?? ''}|${j.programa?.id ?? ''}`;

function contar(dados, lojaId, cenario, hoje) {
  const perfil = perfilDoCenario(dados, cenario);
  const compra = (valor) => ({ loja_id: lojaId, valor_centavos: valor, tipo_vendedor: 'loja' });
  const porReal = calcularJeitosDeComprar(perfil, compra(UM_REAL), dados, hoje);
  const porCem = calcularJeitosDeComprar(perfil, compra(CEM_REAIS), dados, hoje);
  const cem = new Map(porCem.map((j) => [chaveDoJeito(j), j]));
  return porReal.map((j) => ({ porReal: j, porCem: cem.get(chaveDoJeito(j)) }));
}

/** O melhor jeito de comprar na loja hoje, no cenário mais simples que chega ao máximo. */
export function melhorJeito(dados, lojaId, hoje) {
  let melhor = null;
  for (const cenario of CENARIOS) {
    const [primeiro] = contar(dados, lojaId, cenario, hoje);
    if (primeiro && (!melhor || primeiro.porReal.total_pontos > melhor.porReal.total_pontos)) {
      melhor = { ...primeiro, cenario };
    }
  }
  return melhor;
}

/**
 * Ofertas que o motor aceita hoje nesta loja (fora as vencidas, as que não
 * começaram e as A_CONFIRMAR), cada uma com o seu melhor jeito no cenário completo.
 */
export function ofertasAtivasDaLoja(dados, lojaId, hoje) {
  const vistas = new Map();
  for (const jeito of contar(dados, lojaId, { clube: true, cartoes: true }, hoje)) {
    const id = jeito.porReal.oferta_id;
    if (id && !vistas.has(id)) vistas.set(id, jeito);
  }
  return [...vistas].map(([id, jeito]) => ({ oferta: dados.ofertas.find((o) => o.id === id), ...jeito }));
}

/** Por que uma oferta da loja ficou fora da conta de hoje. */
function motivoFora(oferta, hoje) {
  if (oferta.status === A_CONFIRMAR) return 'ainda em conferência, fica fora da conta';
  if (confirmado(oferta.fim) && oferta.fim < hoje) return `terminou em ${formatarData(oferta.fim)}`;
  if (confirmado(oferta.inicio) && oferta.inicio > hoje) return `começa em ${formatarData(oferta.inicio)}`;
  return 'fora da conta de hoje';
}

// ---------------------------------------------------------------------------
// Peças de página

function urlAbsoluta(urlBase, caminho) {
  return urlBase ? `${urlBase}/${caminho}` : null;
}

function cabecalho(raiz, atual) {
  const link = (href, texto, rota) => h('a', { class: 'topo__link', href, 'aria-current': rota === atual ? 'page' : null }, texto);
  return h('header', { class: 'topo' },
    h('div', { class: 'container topo__linha' },
      h('a', { class: 'topo__marca', href: raiz }, NOME_DO_SITE),
      h('nav', { class: 'topo__menu', 'aria-label': 'Principal' },
        link(raiz, 'Comparar', 'inicio'),
        link(`${raiz}ofertas/`, 'Ofertas', 'ofertas'),
        link(`${raiz}#/perfil`, 'Meu perfil', 'perfil'))));
}

function rodape() {
  return h('footer', { class: 'container rodape' },
    h('p', { class: 'texto-suave texto-pequeno' },
      'Não pedimos número de cartão nem CPF. Os números são estimativas a partir das regras publicadas pelas lojas e programas: confira sempre antes de comprar.'));
}

function documento({ titulo, descricao, caminho, raiz, urlBase, atual, dadosEstruturados, principal }) {
  const url = urlAbsoluta(urlBase, caminho);
  const og = (prop, valor) => h('meta', { property: prop, content: valor });
  return `<!doctype html>\n${h('html', { lang: 'pt-BR' },
    h('head', {},
      h('meta', { charset: 'utf-8' }),
      h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      h('title', {}, titulo),
      h('meta', { name: 'description', content: descricao }),
      h('meta', { name: 'theme-color', content: '#1f6b3a' }),
      h('link', { rel: 'manifest', href: `${raiz}manifest.webmanifest` }),
      h('link', { rel: 'icon', href: `${raiz}img/icones/icone.svg`, type: 'image/svg+xml' }),
      h('link', { rel: 'apple-touch-icon', href: `${raiz}img/icones/apple-touch-icon.png` }),
      url ? h('link', { rel: 'canonical', href: url }) : null,
      og('og:type', 'website'),
      og('og:locale', 'pt_BR'),
      og('og:site_name', NOME_DO_SITE),
      og('og:title', titulo),
      og('og:description', descricao),
      url ? og('og:url', url) : null,
      h('meta', { name: 'twitter:card', content: 'summary' }),
      h('link', { rel: 'stylesheet', href: `${raiz}css/base.css` }),
      h('link', { rel: 'stylesheet', href: `${raiz}css/estilo.css` }),
      h('link', { rel: 'stylesheet', href: `${raiz}css/paginas.css` }),
      dadosEstruturados ? jsonLd(dadosEstruturados) : null),
    h('body', {},
      h('a', { class: 'pular-para-conteudo', href: '#conteudo' }, 'Pular para o conteúdo'),
      cabecalho(raiz, atual),
      h('main', { id: 'conteudo', class: 'container pilha--lg' }, principal),
      rodape()))}\n`;
}

function alerta(tipo, icone, titulo, ...corpo) {
  return h('div', { class: `alerta alerta--${tipo}`, role: 'note' },
    h('span', { class: 'alerta__icone', 'aria-hidden': 'true' }, icone),
    h('div', { class: 'alerta__corpo' }, h('strong', { class: 'alerta__titulo' }, titulo), ...corpo));
}

function linhaConta(rotulo, ...valor) {
  return h('div', {}, h('dt', {}, rotulo), h('dd', {}, ...valor));
}

const TERMOS = {
  milheiro: ['O que é milheiro?', 'É quanto valem 1.000 pontos ou milhas, em reais. Usamos uma estimativa média para dizer quanto os pontos valem; você pode trocar pelo seu valor em "Meu perfil".'],
  clube: ['O que é clube?', 'É uma assinatura mensal do programa de pontos. Quem assina costuma ganhar mais pontos por real nas lojas parceiras, às vezes só depois de algumas horas de assinatura.'],
  bonus: ['O que é bônus?', 'É uma porcentagem a mais de pontos que o programa dá por um tempo, por cima dos pontos normais.'],
};

/** Explica milheiro, clube e bônus quando a palavra aparece no texto da página. */
function termosExplicados(htmlDaPagina) {
  const texto = htmlDaPagina.toString();
  const usados = [
    /milheiro/i.test(texto) && 'milheiro',
    /clube/i.test(texto) && 'clube',
    /bônus/i.test(texto) && 'bonus',
  ].filter(Boolean);
  if (!usados.length) return null;
  return h('section', { class: 'pilha--sm', 'aria-labelledby': 'termos-titulo' },
    h('h2', { id: 'termos-titulo', class: 'pagina__subtitulo' }, 'Palavras desta página'),
    usados.map((t) => h('details', { class: 'termo' },
      h('summary', {}, TERMOS[t][0]),
      h('p', { class: 'termo__texto' }, TERMOS[t][1]))));
}

function conferido(registro) {
  return juntar(
    `${formatarData(registro.verificado_em)}. `,
    linkExterno(registro.fonte_url, 'Ver a fonte'),
  );
}

// ---------------------------------------------------------------------------
// Página da loja

function descreverCondicao(regra, oferta, dados) {
  const nomePrograma = dados.programas.find((p) => p.id === oferta.programa_id)?.nome ?? oferta.programa_id;
  const partes = [];
  if (regra.condicao?.clube_ativo === true) {
    const horas = oferta.clube_ativo_ha_horas;
    partes.push(`com o clube ${nomePrograma} ativo${Number.isInteger(horas) && horas > 0 ? ` há pelo menos ${horas} horas` : ''}`);
  }
  if (regra.condicao?.cartao_id) {
    const cartao = dados.cartoes.find((c) => c.id === regra.condicao.cartao_id);
    partes.push(`pagando com o cartão ${cartao?.nome ?? regra.condicao.cartao_id}`);
  }
  return partes.length ? maiuscula(partes.join(' e ')) : 'Qualquer pessoa, sem clube e sem cartão específico';
}

function textoEscopo(oferta) {
  let texto = {
    vendido_e_entregue_pela_loja: 'Produtos vendidos e entregues pela própria loja (não vale para parceiros)',
    todos_os_produtos: 'Todos os produtos',
    categorias_selecionadas: `Só estas categorias: ${(oferta.categorias_incluidas ?? []).join(', ')}`,
  }[oferta.escopo] ?? 'Não confirmado';
  if (oferta.categorias_excluidas?.length) texto += `. Fora: ${oferta.categorias_excluidas.join(', ')}`;
  return `${texto}.`;
}

function textoFora(oferta) {
  const v = oferta.pontos_fora_do_escopo_por_real;
  return typeof v === 'number' ? `${pontosPorReal(v)}.` : 'Não confirmado.';
}

function textoAcumula(v) {
  if (v === true) return 'Sim, os pontos do cartão somam com os da oferta.';
  if (v === false) return 'Não. Vale o maior dos dois.';
  return 'Não confirmado. Na conta, usamos só o maior dos dois.';
}

function textoCupom(oferta) {
  if (oferta.exige_cupom === true) return `Sim: ${oferta.cupom ?? 'cupom não informado'}.`;
  if (oferta.exige_cupom === false) return 'Não precisa.';
  return 'Não confirmado.';
}

function secaoDaOferta(ativa, dados, indice) {
  const { oferta, porReal } = ativa;
  const nomePrograma = porReal.programa?.nome ?? oferta.programa_id;
  const idTitulo = `oferta-${indice}`;
  const regras = [...oferta.regras].sort((a, b) => b.pontos_por_real - a.pontos_por_real);
  return h('section', { class: 'card pilha', 'aria-labelledby': idTitulo },
    h('h3', { id: idTitulo, class: 'card__titulo' }, `Oferta ${nomePrograma}`),
    h('table', { class: 'tabela' },
      h('caption', {}, 'Pontos por real em cada caso'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Quem compra'), h('th', { scope: 'col', class: 'numero' }, 'Pontos por real'))),
      h('tbody', {}, regras.map((regra) => h('tr', {},
        h('td', { 'data-rotulo': 'Quem compra' }, descreverCondicao(regra, oferta, dados)),
        h('td', { 'data-rotulo': 'Pontos por real', class: 'numero' }, formatarNumero(regra.pontos_por_real)))))),
    h('dl', { class: 'lista-conta' },
      linhaConta('Validade', porReal.validade_da_oferta?.texto ?? 'Não confirmada.'),
      linhaConta('Vale para', textoEscopo(oferta)),
      linhaConta('Fora da oferta', textoFora(oferta)),
      linhaConta('Soma com o cartão?', textoAcumula(oferta.acumula_com_cartao)),
      linhaConta('Precisa de cupom?', textoCupom(oferta)),
      linhaConta('Quando os pontos caem', porReal.prazo_de_credito?.texto ?? 'Não confirmado.'),
      linhaConta('Conferido em', conferido(oferta)),
      confirmado(oferta.link_oferta) ? linhaConta('Página da oferta', linkExterno(oferta.link_oferta, 'Abrir na loja')) : null));
}

function respostaDaLoja(loja, melhor, ativas) {
  const na = naLoja(loja);
  const j = melhor?.porReal;
  if (j && j.total_pontos > 0 && !ativas.length) {
    const frase = `${maiuscula(na)}, hoje não há oferta de pontos ativa que a gente conheça. Só com o cartão, o melhor jeito rende ${porRealTexto(j.total_pontos_texto)}.`;
    return { frase, rende: true, comOferta: false };
  }
  if (j && j.total_pontos > 0) {
    const frase = `${maiuscula(na)}, o melhor jeito hoje rende ${porRealTexto(j.total_pontos_texto)}.`;
    return { frase, rende: true, comOferta: j.tipo === 'oferta' };
  }
  if (!ativas.length) {
    return {
      frase: `${maiuscula(na)}, hoje não há oferta de pontos ativa que a gente conheça, então não dá para prometer pontos extras.`,
      rende: false,
      comOferta: false,
    };
  }
  return { frase: `${maiuscula(na)}, as ofertas de hoje não rendem pontos com o que sabemos até agora.`, rende: false, comOferta: true };
}

function cartaoDaResposta(dados, loja, melhor, resposta, raiz) {
  const j = melhor?.porReal;
  const cem = melhor?.porCem;
  const botao = h('a', { class: 'botao botao--bloco', href: `${raiz}?loja=${encodeURIComponent(loja.id)}` },
    `Calcular a minha compra ${naLoja(loja)}`);
  if (!resposta.rende) {
    return h('section', { class: 'card pilha', 'aria-label': 'Resposta' },
      h('p', { class: 'resposta' }, resposta.frase),
      h('p', {}, dados.cartoes.some((c) => typeof c.pontos_por_real === 'number' && c.status !== A_CONFIRMAR)
        ? 'Sem oferta, ficam só os pontos de sempre do seu cartão. Na calculadora, você vê o resultado com os seus cartões.'
        : 'Sem oferta, ficam só os pontos de sempre do seu cartão. Os pontos por real dos cartões que cadastramos ainda não estão confirmados, por isso não entram na conta. Na calculadora, você vê o resultado com os seus cartões.'),
      botao);
  }
  const valor = cem?.valor_estimado_em_reais;
  const avisos = j.avisos ?? [];
  return h('section', { class: 'card card--destaque pilha', 'aria-label': 'Resposta' },
    h('p', { class: 'resposta' }, resposta.frase, ' ', fraseDoJeito(j, loja.nome).replace(` na ${loja.nome}`, ` ${naLoja(loja)}`)),
    valor
      ? juntar(
        h('p', { class: 'card__valor' }, valor.texto),
        h('p', { class: 'card__legenda' }, `é quanto valem, em média, os ${cem.total_pontos_texto} pontos de uma compra de R$ 100,00 (pelo valor estimado do milheiro).`))
      : h('p', { class: 'card__legenda' }, `Ainda não dá para dizer quanto isso vale em reais: falta o valor do milheiro do ${j.programa?.nome ?? 'programa'}.`),
    j.condicoes_a_cumprir.length
      ? juntar(h('p', { class: 'pagina__rotulo' }, 'Para valer:'), h('ul', { class: 'pagina__lista' }, j.condicoes_a_cumprir.map((c) => h('li', {}, c))))
      : null,
    avisos.length ? alerta('aviso', '!', 'Antes de comprar', h('ul', { class: 'pagina__lista' }, avisos.map((a) => h('li', {}, a)))) : null,
    botao);
}

export function paginaDaLoja(dados, loja, { hoje, urlBase }) {
  const raiz = '../../';
  const caminho = `loja/${loja.id}/`;
  const ativas = ofertasAtivasDaLoja(dados, loja.id, hoje);
  const melhor = melhorJeito(dados, loja.id, hoje);
  const resposta = respostaDaLoja(loja, melhor, ativas);
  const idsAtivas = new Set(ativas.map((a) => a.oferta.id));
  const foraDaConta = dados.ofertas.filter((o) => o.loja_id === loja.id && !idsAtivas.has(o.id));
  const nomeProg = (id) => dados.programas.find((p) => p.id === id)?.nome ?? id;

  const titulo = `${loja.nome}: pontos e milhas hoje | ${NOME_DO_SITE}`;
  const descricao = resposta.comOferta
    ? `${resposta.frase} Veja as regras da oferta, a validade, quando foi conferida e a fonte.`
    : `Hoje não há oferta de pontos ativa conhecida ${naLoja(loja)}. Veja o que já acabou, quando conferimos e a fonte.`;

  const conteudo = juntar(
    h('section', { class: 'pilha--sm' },
      h('nav', { class: 'texto-suave texto-pequeno', 'aria-label': 'Você está em' },
        h('a', { class: 'alvo-toque', href: `${raiz}ofertas/` }, 'Ofertas de hoje'), h('span', { 'aria-hidden': 'true' }, ' › '), loja.nome),
      h('h1', {}, `Pontos e milhas ${naLoja(loja)} hoje`),
      h('p', { class: 'texto-suave texto-pequeno' }, `Situação em ${formatarData(hoje)}, com os dados conferidos até agora.`)),
    cartaoDaResposta(dados, loja, melhor, resposta, raiz),
    h('section', { class: 'pilha', 'aria-labelledby': 'regras-titulo' },
      h('h2', { id: 'regras-titulo', class: 'pagina__subtitulo' }, ativas.length ? 'Regras das ofertas ativas' : 'Ofertas ativas'),
      ativas.length
        ? ativas.map((a, i) => secaoDaOferta(a, dados, i + 1))
        : h('p', {}, `Nenhuma oferta de pontos ativa ${naLoja(loja)} hoje.`)),
    foraDaConta.length
      ? h('section', { class: 'pilha--sm', 'aria-labelledby': 'fora-titulo' },
        h('h2', { id: 'fora-titulo', class: 'pagina__subtitulo' }, 'Ofertas que não valem hoje'),
        h('ul', { class: 'pagina__lista' }, foraDaConta.map((o) => h('li', {},
          `Oferta ${nomeProg(o.programa_id)}: ${motivoFora(o, hoje)}. `,
          linkExterno(o.fonte_url, 'Fonte')))))
      : null,
    h('section', { class: 'pilha--sm', 'aria-labelledby': 'loja-titulo' },
      h('h2', { id: 'loja-titulo', class: 'pagina__subtitulo' }, 'Sobre a loja'),
      h('dl', { class: 'lista-conta' },
        confirmado(loja.dominio) ? linhaConta('Site', loja.dominio) : null,
        linhaConta('Conferido em', conferido(loja)))),
  );

  const url = urlAbsoluta(urlBase, caminho);
  const estruturados = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: titulo,
    description: descricao,
    inLanguage: 'pt-BR',
    dateModified: hoje,
    ...(url ? { url } : {}),
    about: { '@type': 'Organization', name: loja.nome, ...(confirmado(loja.dominio) ? { url: `https://${loja.dominio}` } : {}) },
    ...(urlBase ? {
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Ofertas de hoje', item: urlAbsoluta(urlBase, 'ofertas/') },
          { '@type': 'ListItem', position: 2, name: loja.nome, item: url },
        ],
      },
    } : {}),
  };

  return {
    caminho: `${caminho}index.html`,
    conteudo: documento({
      titulo, descricao, caminho, raiz, urlBase, atual: null,
      dadosEstruturados: estruturados,
      principal: juntar(conteudo, termosExplicados(conteudo)),
    }),
    resumo: { loja: loja.id, ofertasAtivas: ativas.length, rende: resposta.rende, frase: resposta.frase },
  };
}

// ---------------------------------------------------------------------------
// Página de ofertas de hoje

export function paginaDeOfertas(dados, { hoje, urlBase }) {
  const raiz = '../';
  const caminho = 'ofertas/';
  const porLoja = dados.lojas.map((loja) => ({ loja, ativas: ofertasAtivasDaLoja(dados, loja.id, hoje) }));
  const linhas = porLoja
    .flatMap(({ loja, ativas }) => ativas.map((a) => ({ loja, ...a })))
    .sort((a, b) => b.porReal.total_pontos - a.porReal.total_pontos || a.loja.nome.localeCompare(b.loja.nome, 'pt-BR'));
  const lojasComOferta = new Set(linhas.map((l) => l.loja.id)).size;

  let frase;
  if (linhas.length) {
    const [topo] = linhas;
    frase = `Hoje, ${formatarData(hoje)}, há ${plural(linhas.length, 'oferta de pontos ativa', 'ofertas de pontos ativas')} em ${plural(lojasComOferta, 'loja', 'lojas')}. ` +
      `A que mais rende é a do ${topo.porReal.programa?.nome} ${naLoja(topo.loja)}: até ${porRealTexto(topo.porReal.total_pontos_texto)}.`;
  } else {
    frase = `Hoje, ${formatarData(hoje)}, não há nenhuma oferta de pontos ativa que a gente conheça. Quando uma oferta nova for conferida, ela aparece aqui.`;
  }
  const titulo = `Ofertas de pontos e milhas ativas hoje | ${NOME_DO_SITE}`;
  const descricao = linhas.length
    ? `${plural(linhas.length, 'oferta ativa', 'ofertas ativas')} de pontos e milhas em lojas brasileiras, com regras, validade, data de conferência e fonte.`
    : 'Lista das ofertas de pontos e milhas ativas hoje em lojas brasileiras, com regras, validade, data de conferência e fonte.';

  const conteudo = juntar(
    h('section', { class: 'pilha--sm' },
      h('h1', {}, 'Ofertas de pontos ativas hoje'),
      h('p', { class: 'resposta' }, frase),
      h('p', { class: 'texto-suave texto-pequeno' }, 'Ofertas vencidas saem desta lista. "Até" é o máximo da oferta, que pode pedir clube ou um cartão específico: veja as regras na página da loja.')),
    linhas.length
      ? h('table', { class: 'tabela' },
        h('caption', {}, 'Ofertas ativas, da que mais rende para a que menos rende'),
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, 'Loja'),
          h('th', { scope: 'col' }, 'Programa'),
          h('th', { scope: 'col', class: 'numero' }, 'Até (pontos por real)'),
          h('th', { scope: 'col' }, 'Validade'),
          h('th', { scope: 'col' }, 'Conferido'))),
        h('tbody', {}, linhas.map(({ loja, oferta, porReal }) => h('tr', {},
          h('td', { 'data-rotulo': 'Loja' }, h('a', { class: 'alvo-toque', href: `${raiz}loja/${loja.id}/` }, loja.nome)),
          h('td', { 'data-rotulo': 'Programa' }, porReal.programa?.nome ?? oferta.programa_id),
          h('td', { 'data-rotulo': 'Até (pontos por real)', class: 'numero' }, porReal.total_pontos_texto),
          h('td', { 'data-rotulo': 'Validade' }, confirmado(oferta.fim) ? `até ${formatarData(oferta.fim)}` : 'fim não confirmado'),
          h('td', { 'data-rotulo': 'Conferido' }, formatarData(oferta.verificado_em), ' · ', linkExterno(oferta.fonte_url, 'fonte', h('span', { class: 'visualmente-oculto' }, ` da oferta ${naLoja(loja)}`)))))))
      : null,
    h('section', { class: 'pilha--sm', 'aria-labelledby': 'lojas-titulo' },
      h('h2', { id: 'lojas-titulo', class: 'pagina__subtitulo' }, 'Todas as lojas'),
      h('ul', { class: 'pagina__lojas' }, [...porLoja]
        .sort((a, b) => a.loja.nome.localeCompare(b.loja.nome, 'pt-BR'))
        .map(({ loja, ativas }) => h('li', {},
          h('a', { href: `${raiz}loja/${loja.id}/` }, loja.nome),
          h('span', { class: 'texto-suave' }, ativas.length ? ` · ${plural(ativas.length, 'oferta ativa', 'ofertas ativas')}` : ' · sem oferta ativa hoje'))))),
    h('p', {}, h('a', { class: 'botao botao--secundario', href: raiz }, 'Calcular a minha compra')),
  );

  const url = urlAbsoluta(urlBase, caminho);
  const estruturados = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: titulo,
    description: descricao,
    inLanguage: 'pt-BR',
    dateModified: hoje,
    ...(url ? { url } : {}),
    mainEntity: {
      '@type': 'ItemList',
      name: 'Ofertas de pontos ativas hoje',
      numberOfItems: linhas.length,
      itemListElement: linhas.map(({ loja, porReal }, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${porReal.programa?.nome} ${naLoja(loja)}: até ${porRealTexto(porReal.total_pontos_texto)}`,
        ...(urlBase ? { url: urlAbsoluta(urlBase, `loja/${loja.id}/`) } : {}),
      })),
    },
  };

  return {
    caminho: `${caminho}index.html`,
    conteudo: documento({
      titulo, descricao, caminho, raiz, urlBase, atual: 'ofertas',
      dadosEstruturados: estruturados,
      principal: juntar(conteudo, termosExplicados(conteudo)),
    }),
    resumo: { ofertasAtivas: linhas.length, lojasComOferta },
  };
}

// ---------------------------------------------------------------------------
// sitemap.xml e robots.txt

function sitemap(urlBase, caminhos, hoje) {
  const urls = caminhos.map((c) => `  <url><loc>${escaparXml(urlAbsoluta(urlBase, c))}</loc><lastmod>${hoje}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function robots(urlBase) {
  const linhas = ['User-agent: *', 'Allow: /'];
  if (urlBase) linhas.push('', `Sitemap: ${urlBase}/sitemap.xml`);
  return `${linhas.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Tudo junto

/** "https://exemplo.com.br/" → "https://exemplo.com.br". A_CONFIRMAR ou vazio → null. */
export function normalizarUrlBase(url) {
  if (!url || url === A_CONFIRMAR) return null;
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(url)) throw new Error(`URL base inválida: ${url} (use algo como https://www.exemplo.com.br)`);
  return url.replace(/\/+$/, '');
}

/**
 * @param {object} dados  { programas, cartoes, lojas, ofertas } já validados
 * @param {object} opcoes { hoje: "AAAA-MM-DD", urlBase: string|null }
 * @returns {{ arquivos: {caminho, conteudo}[], resumo: object, avisos: string[] }}
 */
export function gerarPaginas(dados, { hoje, urlBase = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje ?? '')) throw new Error(`hoje precisa ser AAAA-MM-DD (recebido: ${hoje})`);
  const base = normalizarUrlBase(urlBase);
  for (const loja of dados.lojas) {
    if (!ID_SEGURO.test(loja.id)) throw new Error(`id de loja inválido para virar pasta: ${JSON.stringify(loja.id)}`);
  }
  const lojas = dados.lojas.map((loja) => paginaDaLoja(dados, loja, { hoje, urlBase: base }));
  const ofertas = paginaDeOfertas(dados, { hoje, urlBase: base });
  const arquivos = [ofertas, ...lojas].map(({ caminho, conteudo }) => ({ caminho, conteudo }));
  const avisos = [];
  if (base) {
    arquivos.push({ caminho: 'sitemap.xml', conteudo: sitemap(base, ['', 'ofertas/', ...dados.lojas.map((l) => `loja/${l.id}/`)], hoje) });
  } else {
    avisos.push('URL base do site A_CONFIRMAR: sem link canônico, sem og:url e sem sitemap.xml. Defina em scripts/paginas/config.js, ou use URL_DO_SITE / --url-base.');
  }
  arquivos.push({ caminho: 'robots.txt', conteudo: robots(base) });
  return { arquivos, resumo: { ofertas: ofertas.resumo, lojas: lojas.map((l) => l.resumo) }, avisos };
}

