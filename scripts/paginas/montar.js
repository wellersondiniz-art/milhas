// Monta as páginas estáticas (uma por loja + ofertas de hoje + institucionais),
// o sitemap e o robots.txt. Funções puras: recebem os dados, a data de hoje e a URL base e
// devolvem a lista de arquivos com o conteúdo. Não leem disco nem relógio.
//
// Os números ("rende X pontos por real", "R$ Y a cada R$ 100") vêm SEMPRE do
// motor (site/js/motor). Aqui só se escolhe o cenário e as palavras.

import {
  calcularJeitosDeComprar, DIAS_DADO_ANTIGO, ESTADOS, formatarData, quandoVence, situacaoDaOferta,
} from '../../site/js/motor/index.js';
import { formatarNumero, pontosPorReal } from '../../site/js/motor/formatar.js';
import { fraseDoJeito } from '../../site/js/tela/textos.js';
import { NOME_DO_SITE } from './config.js';
import { escaparXml, h, juntar, linkExterno } from './html.js';
import { alerta, documento, termosExplicados, urlAbsoluta } from './moldura.js';
import { paginasInstitucionais } from './institucionais.js';

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

/** Por que uma oferta da loja ficou fora da conta de hoje (ciclo de vida em site/js/motor/ciclo.js). */
export function motivoFora(oferta, hoje) {
  const s = situacaoDaOferta(oferta, hoje);
  switch (s.estado) {
    case ESTADOS.EM_CONFERENCIA: return 'ainda em conferência, fica fora da conta';
    case ESTADOS.VENCIDA: return `terminou em ${formatarData(oferta.fim)}`;
    case ESTADOS.FUTURA: return `começa em ${formatarData(oferta.inicio)}`;
    case ESTADOS.RECONFERIR:
      return `conferida pela última vez em ${formatarData(oferta.verificado_em)}, há ${s.dias_desde_conferencia} dias; fica fora da conta até ser conferida de novo`;
    default: return 'fora da conta de hoje';
  }
}

/** Ofertas da loja que não entram na conta hoje: { fora, historico } (vencidas, da que terminou por último). */
export function ofertasForaDaConta(dados, lojaId, hoje, idsAtivas) {
  const fora = [];
  const historico = [];
  for (const o of dados.ofertas) {
    if (o.loja_id !== lojaId || idsAtivas.has(o.id)) continue;
    (situacaoDaOferta(o, hoje).no_historico ? historico : fora).push(o);
  }
  historico.sort((a, b) => (a.fim < b.fim ? 1 : a.fim > b.fim ? -1 : 0));
  return { fora, historico };
}

/** Selos de alerta de uma oferta ativa: vence em até 3 dias; conferida há mais de 14 dias. */
function selosDaOferta(oferta, hoje) {
  const s = situacaoDaOferta(oferta, hoje);
  const selos = [];
  if (s.estado === ESTADOS.VENCE_LOGO) selos.push(h('span', { class: 'selo selo--aviso' }, `Vence ${quandoVence(s.dias_para_vencer)}`));
  if (s.dado_antigo) selos.push(h('span', { class: 'selo selo--aviso' }, `Conferida há ${s.dias_desde_conferencia} dias`));
  return selos;
}

// ---------------------------------------------------------------------------
// Peças de página

function linhaConta(rotulo, ...valor) {
  return h('div', {}, h('dt', {}, rotulo), h('dd', {}, ...valor));
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

function secaoDaOferta(ativa, dados, indice, hoje) {
  const { oferta, porReal } = ativa;
  const nomePrograma = porReal.programa?.nome ?? oferta.programa_id;
  const idTitulo = `oferta-${indice}`;
  const regras = [...oferta.regras].sort((a, b) => b.pontos_por_real - a.pontos_por_real);
  const selos = selosDaOferta(oferta, hoje);
  return h('section', { class: 'card pilha', 'aria-labelledby': idTitulo },
    h('h3', { id: idTitulo, class: 'card__titulo' }, `Oferta ${nomePrograma}`),
    selos.length ? h('div', { class: 'card__topo' }, selos) : null,
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
  const { fora: foraDaConta, historico } = ofertasForaDaConta(dados, loja.id, hoje, idsAtivas);
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
        ? ativas.map((a, i) => secaoDaOferta(a, dados, i + 1, hoje))
        : h('p', {}, `Nenhuma oferta de pontos ativa ${naLoja(loja)} hoje.`)),
    foraDaConta.length
      ? h('section', { class: 'pilha--sm', 'aria-labelledby': 'fora-titulo' },
        h('h2', { id: 'fora-titulo', class: 'pagina__subtitulo' }, 'Ofertas fora da conta hoje'),
        h('ul', { class: 'pagina__lista' }, foraDaConta.map((o) => h('li', {},
          `Oferta ${nomeProg(o.programa_id)}: ${motivoFora(o, hoje)}. `,
          linkExterno(o.fonte_url, 'Fonte')))))
      : null,
    historico.length
      ? h('section', { class: 'pilha--sm', 'aria-labelledby': 'historico-titulo' },
        h('h2', { id: 'historico-titulo', class: 'pagina__subtitulo' }, 'Histórico: ofertas que já acabaram'),
        h('ul', { class: 'pagina__lista' }, historico.map((o) => h('li', {},
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
      h('p', { class: 'texto-suave texto-pequeno' }, `Ofertas vencidas saem desta lista e vão para o histórico. Oferta conferida há mais de ${DIAS_DADO_ANTIGO} dias ganha um aviso; há mais de 30 dias, sai da lista até ser conferida de novo. "Até" é o máximo da oferta, que pode pedir clube ou um cartão específico: veja as regras na página da loja.`)),
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
          h('td', { 'data-rotulo': 'Validade' }, confirmado(oferta.fim) ? `até ${formatarData(oferta.fim)}` : 'fim não confirmado',
            ...selosDaOferta(oferta, hoje).slice(0, 1).map((selo) => juntar(' ', selo))),
          h('td', { 'data-rotulo': 'Conferido' }, formatarData(oferta.verificado_em),
            situacaoDaOferta(oferta, hoje).dado_antigo ? juntar(' ', h('span', { class: 'selo selo--aviso' }, 'dado antigo')) : null,
            ' · ', linkExterno(oferta.fonte_url, 'fonte', h('span', { class: 'visualmente-oculto' }, ` da oferta ${naLoja(loja)}`)))))))
      : null,
    listaForaDoRanking(dados, hoje, raiz),
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

/** Na página de ofertas: as que saíram por falta de conferência e o histórico das vencidas. */
function listaForaDoRanking(dados, hoje, raiz) {
  const lojas = new Map(dados.lojas.map((l) => [l.id, l]));
  const nomeProg = (id) => dados.programas.find((p) => p.id === id)?.nome ?? id;
  const reconferir = [];
  const historico = [];
  for (const o of dados.ofertas) {
    const s = situacaoDaOferta(o, hoje);
    if (s.estado === ESTADOS.RECONFERIR) reconferir.push(o);
    else if (s.no_historico) historico.push(o);
  }
  historico.sort((a, b) => (a.fim < b.fim ? 1 : a.fim > b.fim ? -1 : 0));
  const item = (o) => {
    const loja = lojas.get(o.loja_id);
    return h('li', {},
      loja ? h('a', { href: `${raiz}loja/${loja.id}/` }, loja.nome) : o.loja_id,
      ` · ${nomeProg(o.programa_id)}: ${motivoFora(o, hoje)}.`);
  };
  return juntar(
    reconferir.length
      ? h('section', { class: 'pilha--sm', 'aria-labelledby': 'reconferir-titulo' },
        h('h2', { id: 'reconferir-titulo', class: 'pagina__subtitulo' }, 'Fora da lista até a gente conferir de novo'),
        h('ul', { class: 'pagina__lista' }, reconferir.map(item)))
      : null,
    historico.length
      ? h('section', { class: 'pilha--sm', 'aria-labelledby': 'historico-titulo' },
        h('h2', { id: 'historico-titulo', class: 'pagina__subtitulo' }, 'Histórico: ofertas que já acabaram'),
        h('ul', { class: 'pagina__lista' }, historico.map(item)))
      : null,
  );
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
  const institucionais = paginasInstitucionais({ hoje, urlBase: base });
  const arquivos = [ofertas, ...lojas, ...institucionais.paginas].map(({ caminho, conteudo }) => ({ caminho, conteudo }));
  const avisos = [...institucionais.avisos];
  if (base) {
    const caminhos = ['', 'ofertas/', ...dados.lojas.map((l) => `loja/${l.id}/`), ...institucionais.indexaveis];
    arquivos.push({ caminho: 'sitemap.xml', conteudo: sitemap(base, caminhos, hoje) });
  } else {
    avisos.push('URL base do site A_CONFIRMAR: sem link canônico, sem og:url e sem sitemap.xml. Defina em scripts/paginas/config.js, ou use URL_DO_SITE / --url-base.');
  }
  arquivos.push({ caminho: 'robots.txt', conteudo: robots(base) });
  return { arquivos, resumo: { ofertas: ofertas.resumo, lojas: lojas.map((l) => l.resumo) }, avisos };
}

