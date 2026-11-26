// Página "Onde rende mais hoje" e o bloco "O que mais rende aqui" das páginas
// de loja. Funções puras.
//
// A ordem e os números vêm SEMPRE do motor (rankearOportunidades). Aqui só se
// escolhem as palavras. Sem preço de produto: numa mesma oferta todo produto
// que entra rende os mesmos pontos por real.

import { formatarData, rankearOportunidades } from '../../site/js/motor/index.js';
import { pontosPorReal } from '../../site/js/motor/formatar.js';
import { NOME_DO_SITE } from './config.js';
import { h, juntar, linkExterno } from './html.js';
import { documento, termosExplicados, urlAbsoluta } from './moldura.js';
import { naLoja } from './montar.js';
import { SCRIPT_VALIDADE, secaoQueMaisRende } from './produtos.js';

export const PASTA_ONDE_RENDE_MAIS = 'onde-rende-mais';

function linha(rotulo, ...valor) {
  return h('div', {}, h('dt', {}, rotulo), h('dd', {}, ...valor));
}

/** "Eletrônicos e Celulares", "qualquer produto", "produtos da própria loja". */
function alvoCurto(alvo) {
  if (alvo.escopo === 'categorias_selecionadas') {
    return emLista(alvo.categorias_incluidas);
  }
  const texto = alvo.escopo === 'vendido_e_entregue_pela_loja' ? 'produtos vendidos e entregues pela própria loja' : 'qualquer produto';
  return alvo.categorias_excluidas.length ? `${texto}, menos ${emLista(alvo.categorias_excluidas)}` : texto;
}

/** ["a"] → "a"; ["a", "b", "c"] → "a, b e c". */
function emLista(itens) {
  return itens.length > 1 ? `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}` : itens[0];
}

function textoParaQualquerPessoa(o) {
  return o.pontos_por_real_sem_exigencia > 0
    ? `${pontosPorReal(o.pontos_por_real_sem_exigencia)}.`
    : 'Nenhum ponto extra sem clube ou cartão específico.';
}

function textoMaximo(o, dados) {
  const { maximo, programa } = o;
  const pede = [];
  if (maximo.pede_clube) pede.push(`o clube ${programa.nome} ativo`);
  if (maximo.pede_cartao_id) {
    const cartao = dados.cartoes.find((c) => c.id === maximo.pede_cartao_id);
    pede.push(`o cartão ${cartao?.nome ?? maximo.pede_cartao_id}`);
  }
  return `${pontosPorReal(maximo.pontos_por_real)}${pede.length ? `, com ${pede.join(' e ')}` : ''}.`;
}

function textoCemReais(o) {
  const { pontos_texto: pontos, valor_estimado_em_reais: valor } = o.a_cada_100_reais;
  return valor
    ? `${pontos} pontos, que valem cerca de ${valor.texto} (pelo valor estimado do milheiro).`
    : `${pontos} pontos. Ainda não dá para dizer quanto valem em reais: falta o valor do milheiro do ${o.programa.nome}.`;
}

function textoValidade(o) {
  if (o.vence_em_dias === null) return 'Fim não confirmado: confira antes de comprar.';
  const quando = o.vence_em_dias === 0 ? 'vence hoje' : o.vence_em_dias === 1 ? 'vence amanhã' : `faltam ${o.vence_em_dias} dias`;
  return `Até ${formatarData(o.fim)} (${quando}).`;
}

function textoFora(o) {
  if (o.alvo.escopo === 'todos_os_produtos' && !o.alvo.categorias_excluidas.length) return null;
  return o.pontos_fora_do_escopo_por_real === null ? 'Não confirmado.' : `${pontosPorReal(o.pontos_fora_do_escopo_por_real)}.`;
}

function listaDeProdutos(o) {
  return h('ul', { class: 'pagina__lista' }, o.produtos_em_campanha.map((p) => h('li', {}, linkExterno(p.link, p.nome))));
}

function cartaoDaOportunidade(o, dados, raiz, indice) {
  const idTitulo = `oportunidade-${indice}`;
  const fora = textoFora(o);
  const loja = dados.lojas.find((l) => l.id === o.loja.id);
  return h('li', {},
    h('section', { class: 'card pilha', 'aria-labelledby': idTitulo },
      h('h2', { id: idTitulo, class: 'card__titulo' }, `${indice}. ${o.loja.nome} · ${o.programa.nome}`),
      h('p', {}, `Vale para ${alvoCurto(o.alvo)}.`),
      h('dl', { class: 'lista-conta' },
        linha('Para qualquer pessoa', textoParaQualquerPessoa(o)),
        o.maximo.pontos_por_real > o.pontos_por_real_sem_exigencia ? linha('Até', textoMaximo(o, dados)) : null,
        o.pontos_por_real_referencia > 0 ? linha('A cada R$ 100', textoCemReais(o)) : null,
        linha('O que entra', o.alvo.texto),
        fora ? linha('Fora da oferta', fora) : null,
        o.produtos_em_campanha.length ? linha('Produtos citados na campanha', listaDeProdutos(o)) : null,
        linha('Validade', textoValidade(o)),
        linha('Conferido em', `${formatarData(o.verificado_em)}. `, linkExterno(o.fonte_url, 'Ver a fonte'))),
      h('p', {}, h('a', { class: 'alvo-toque', href: `${raiz}loja/${o.loja.id}/` }, `Ver todas as regras ${naLoja(loja ?? o.loja)}`))));
}

function fraseDoTopo(lista, dados, hoje) {
  if (!lista.length) {
    return `Hoje, ${formatarData(hoje)}, não há nenhuma oferta de pontos ativa que a gente conheça. Quando uma oferta nova for conferida, ela aparece aqui.`;
  }
  const [topo] = lista;
  if (topo.pontos_por_real_referencia === 0) {
    return `Hoje, ${formatarData(hoje)}, as ofertas ativas só rendem pontos extras com clube ou cartão específico. Veja abaixo o que cada uma pede.`;
  }
  const loja = dados.lojas.find((l) => l.id === topo.loja.id);
  return `Hoje, ${formatarData(hoje)}, o que mais rende para qualquer pessoa é comprar ${naLoja(loja)} ` +
    `pelo ${topo.programa.nome}: ${pontosPorReal(topo.pontos_por_real_referencia)}, em ${alvoCurto(topo.alvo)}.`;
}

/** Página "Onde rende mais hoje": todas as ofertas ativas, da que mais rende para a que menos rende. */
export function paginaOndeRendeMais(dados, { hoje, urlBase, vitrine = null, agora = null }) {
  const raiz = '../';
  const caminho = `${PASTA_ONDE_RENDE_MAIS}/`;
  const lista = rankearOportunidades(dados, hoje);
  const frase = fraseDoTopo(lista, dados, hoje);
  const produtos = vitrine ? secaoQueMaisRende(dados, vitrine, { hoje, agora }) : null;
  const titulo = `Onde rende mais pontos e milhas hoje | ${NOME_DO_SITE}`;
  const descricao = 'Lojas, categorias e produtos em campanha que mais rendem pontos e milhas hoje, com pontos por real, validade, data de conferência e fonte.';

  const conteudo = juntar(
    h('section', { class: 'pilha--sm' },
      h('h1', {}, 'Onde rende mais hoje'),
      h('p', { class: 'resposta' }, frase),
      h('p', { class: 'texto-suave texto-pequeno' },
        produtos
          ? 'Numa mesma oferta, todo produto que entra rende os mesmos pontos por real. Por isso a lista de ofertas mostra lojas e categorias. Mais abaixo, alguns produtos com preço consultado na loja mostram quanto isso dá em pontos. '
          : 'Numa mesma oferta, todo produto que entra rende os mesmos pontos por real. Por isso a lista mostra lojas, categorias e produtos citados nas campanhas, e não preços. ',
        'A ordem vale para qualquer pessoa, sem clube e sem cartão específico. "Até" é o máximo da oferta.')),
    lista.length
      ? h('ol', { class: 'pilha lista-oportunidades', 'aria-label': 'Ofertas ativas, da que mais rende para a que menos rende' },
        lista.map((o, i) => cartaoDaOportunidade(o, dados, raiz, i + 1)))
      : null,
    produtos,
    h('p', {}, h('a', { class: 'botao botao--secundario', href: raiz }, 'Calcular com os meus cartões e clubes')),
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
      name: 'Onde rende mais hoje',
      numberOfItems: lista.length,
      itemListElement: lista.map((o, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${o.programa.nome} ${naLoja(dados.lojas.find((l) => l.id === o.loja.id) ?? o.loja)}: ${o.alvo.texto}`,
        ...(urlBase ? { url: urlAbsoluta(urlBase, `loja/${o.loja.id}/`) } : {}),
      })),
    },
  };

  return {
    caminho: `${caminho}index.html`,
    conteudo: documento({
      titulo, descricao, caminho, raiz, urlBase, atual: null,
      dadosEstruturados: estruturados,
      principal: juntar(conteudo, termosExplicados(conteudo)),
      scripts: produtos ? [SCRIPT_VALIDADE] : [],
    }),
    resumo: { oportunidades: lista.length, produtos: Boolean(produtos) },
  };
}

/**
 * Bloco "O que mais rende aqui" da página da loja. Só aparece quando a loja
 * tem mais de uma oferta ativa ou alguma cita produtos: com uma oferta só, as
 * regras logo abaixo já dizem tudo.
 */
export function blocoDaLoja(dados, loja, hoje, raiz) {
  const lista = rankearOportunidades(dados, hoje, { loja_id: loja.id });
  if (lista.length < 2 && !lista.some((o) => o.produtos_em_campanha.length)) return null;
  return h('section', { class: 'pilha--sm', 'aria-labelledby': 'rende-mais-titulo' },
    h('h2', { id: 'rende-mais-titulo', class: 'pagina__subtitulo' }, 'O que mais rende aqui'),
    h('p', { class: 'texto-suave texto-pequeno' }, 'Para qualquer pessoa, sem clube e sem cartão específico. "Até" é o máximo da oferta.'),
    h('ol', { class: 'pagina__lista' }, lista.map((o) => h('li', {},
      `${maiuscula(alvoCurto(o.alvo))}, pelo ${o.programa.nome}: `,
      o.pontos_por_real_sem_exigencia > 0 ? pontosPorReal(o.pontos_por_real_sem_exigencia) : 'nada extra sem clube ou cartão',
      o.maximo.pontos_por_real > o.pontos_por_real_sem_exigencia ? ` (até ${pontosPorReal(o.maximo.pontos_por_real)})` : '',
      '.',
      o.produtos_em_campanha.length ? juntar(' Produtos citados na campanha:', listaDeProdutos(o)) : null))),
    h('p', {}, h('a', { class: 'alvo-toque', href: `${raiz}${PASTA_ONDE_RENDE_MAIS}/` }, 'Ver onde rende mais em todas as lojas')));
}

function maiuscula(texto) {
  return texto[0].toUpperCase() + texto.slice(1);
}
