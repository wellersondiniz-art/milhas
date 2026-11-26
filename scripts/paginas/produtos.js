// Produtos da vitrine (preço vindo da API oficial da loja) nas páginas de
// loja e em "Onde rende mais". Funções puras.
//
// Regras de exibição (as da Amazon, que são as mais duras, valem para todas):
//   - preço sempre com data e hora da consulta, no horário de Brasília;
//   - aviso de que preço e disponibilidade podem mudar e que vale o da loja;
//   - preço some depois da validade (no máximo 24 horas): no build, e na tela
//     pelo script js/produtos-validade.js, se a página ficou guardada;
//   - sem foto (a Amazon proíbe guardar imagem, e foto pesa no celular);
//   - ordem pelos pontos, nunca pelo preço de uma loja contra outra.
// Os pontos vêm SEMPRE do motor (rankearProdutos).

import { formatarCentavos, rankearProdutos } from '../../site/js/motor/index.js';
import { h, juntar } from './html.js';
import { alerta } from './moldura.js';
import { naLoja } from './montar.js';

export const SCRIPT_VALIDADE = 'js/produtos-validade.js';
/** Quantos produtos aparecem em "Onde rende mais". */
export const MAXIMO_NO_RANKING = 10;

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** "2026-11-25T17:11:00Z" → "25/11/2026 às 14:11". */
export function dataHoraDeBrasilia(iso) {
  const partes = Object.fromEntries(DATA_HORA.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${partes.day}/${partes.month}/${partes.year} às ${partes.hour}:${partes.minute}`;
}

/** Aviso ao lado do preço. O da Amazon é o texto pedido pela Licença do Associados. */
export function avisoDoPreco(loja) {
  if (loja.id === 'amazon') {
    return 'Os preços e a disponibilidade dos produtos estão corretos na data/horário indicados e poderão sofrer alterações. ' +
      'Quaisquer informações de preço e disponibilidade exibidas na Amazon.com.br no momento da compra serão aplicáveis à compra desse produto.';
  }
  return 'O preço e a disponibilidade estavam assim na data e hora indicadas e podem mudar a qualquer momento. ' +
    `Vale o preço que aparecer no site da loja (${loja.nome}) na hora da compra.`;
}

/** Só os produtos que existem nas lojas cadastradas e que ainda valem em `agora`. */
export function produtosQueValem(vitrine, dados, agora) {
  const lojas = new Set(dados.lojas.map((l) => l.id));
  const agoraMs = Date.parse(agora);
  return (vitrine?.produtos ?? []).filter((p) => lojas.has(p.loja_id) && Date.parse(p.valido_ate) > agoraMs);
}

function textoDosPontos({ qualquer, maximo }) {
  const partes = [];
  if (qualquer.total_pontos > 0) {
    partes.push(`Rende ${qualquer.total_pontos_texto} pontos ${qualquer.programa.nome} para qualquer pessoa` +
      `${qualquer.valor_texto ? `, que valem cerca de ${qualquer.valor_texto}` : ''}.`);
  } else {
    partes.push('Para qualquer pessoa, sem clube e sem cartão específico, não há pontos extras de oferta hoje.');
  }
  if (maximo) {
    const com = [maximo.pede_clube ? `o clube ${maximo.programa.nome}` : null, maximo.cartao ? `o cartão ${maximo.cartao.nome}` : null].filter(Boolean);
    partes.push(` Até ${maximo.total_pontos_texto} pontos${maximo.programa ? ` ${maximo.programa.nome}` : ''}` +
      `${com.length ? ` com ${com.join(' e ')}` : ''}${maximo.valor_texto ? ` (cerca de ${maximo.valor_texto})` : ''}.`);
  }
  return partes.join('');
}

/** Avisos que dependem do que a API não disse (vendedor, categoria). */
function ressalvas(produto, dados, hoje) {
  const ofertas = dados.ofertas.filter((o) => o.loja_id === produto.loja_id && o.status !== 'A_CONFIRMAR' &&
    (o.inicio === 'A_CONFIRMAR' || o.inicio <= hoje) && (o.fim === 'A_CONFIRMAR' || o.fim >= hoje));
  const lista = [];
  if (!produto.vendedor_confirmado && ofertas.some((o) => o.escopo === 'vendido_e_entregue_pela_loja')) {
    lista.push('Não sabemos se este produto é vendido e entregue pela própria loja. Na conta, ele foi tratado como de vendedor parceiro, que costuma render menos.');
  }
  if (!produto.categoria && ofertas.some((o) => o.escopo === 'categorias_selecionadas')) {
    lista.push('A categoria deste produto não está confirmada. Na conta, ele ficou fora das categorias da oferta.');
  }
  return lista;
}

function linkDoProduto(produto, loja) {
  const rel = produto.afiliado ? 'sponsored noopener noreferrer' : 'noopener noreferrer nofollow';
  return h('a', { class: 'botao botao--secundario', href: produto.link, rel }, `Ver ${naLoja(loja)}`);
}

/** Cartão de um produto. `indice` deixa os ids únicos na página. */
export function cartaoDoProduto({ produto, pontos }, dados, hoje, indice, { nivel = 'h3', mostrarLoja = false } = {}) {
  const loja = dados.lojas.find((l) => l.id === produto.loja_id);
  const idTitulo = `produto-${indice}`;
  const idAviso = `produto-${indice}-aviso`;
  const quando = dataHoraDeBrasilia(produto.consultado_em);
  const avisos = ressalvas(produto, dados, hoje);
  return h('li', { class: 'produto', 'data-valido-ate': produto.valido_ate },
    h('article', { class: 'card pilha--sm', 'aria-labelledby': idTitulo },
      h(nivel, { id: idTitulo, class: 'card__titulo' }, produto.nome),
      produto.demo ? h('p', {}, h('span', { class: 'selo selo--aviso' }, 'Demonstração: produto e preço inventados')) : null,
      mostrarLoja ? h('p', { class: 'texto-suave texto-pequeno' }, loja.nome) : null,
      h('p', { class: 'produto__preco', 'data-some-se-vencido': true, 'aria-describedby': idAviso },
        `Preço ${naLoja(loja)}: `,
        h('strong', {}, `${produto.a_partir_de ? 'a partir de ' : ''}${formatarCentavos(BigInt(produto.preco_centavos))}`),
        ` (em ${quando}, horário de Brasília).`),
      h('details', { class: 'termo', 'data-some-se-vencido': true },
        h('summary', {}, 'Detalhes do preço'),
        h('p', { id: idAviso, class: 'termo__texto' }, avisoDoPreco(loja))),
      h('p', { class: 'produto__pontos', 'data-some-se-vencido': true }, textoDosPontos(pontos)),
      avisos.length ? h('ul', { class: 'pagina__lista texto-pequeno', 'data-some-se-vencido': true }, avisos.map((a) => h('li', {}, a))) : null,
      h('p', { class: 'produto__vencido', 'data-aviso-vencido': true, hidden: true },
        `Este preço passou do prazo de validade e pode ter mudado. Confira o preço de agora ${naLoja(loja)}.`),
      h('p', {}, linkDoProduto(produto, loja)),
      produto.afiliado
        ? h('p', { class: 'texto-suave texto-pequeno' }, 'Podemos ganhar uma comissão se você comprar por este link, sem custo extra para você. A ordem da lista é só pelos pontos.')
        : null));
}

/** Aviso de demonstração no topo da seção, quando a vitrine é de exemplo. */
function avisoDemo(lista) {
  return lista.some((r) => r.produto.demo)
    ? alerta('aviso', '!', 'Página de demonstração', h('p', {}, 'Os produtos, preços e ofertas abaixo são inventados. No site de verdade, eles vêm das APIs oficiais das lojas.'))
    : null;
}

/** Seção "Produtos com preço de hoje" da página da loja (null se não houver). */
export function secaoDaLoja(dados, loja, vitrine, { hoje, agora }) {
  const doLoja = produtosQueValem(vitrine, dados, agora).filter((p) => p.loja_id === loja.id);
  if (!doLoja.length) return null;
  const lista = rankearProdutos(doLoja, dados, hoje);
  return h('section', { class: 'pilha--sm', 'aria-labelledby': 'produtos-titulo' },
    h('h2', { id: 'produtos-titulo', class: 'pagina__subtitulo' }, 'Produtos com preço consultado na loja'),
    avisoDemo(lista),
    h('p', { class: 'texto-suave texto-pequeno' },
      'Nome e preço vêm da API oficial da loja. Os pontos são a nossa conta, com as ofertas acima. Do que mais rende por real ao que menos rende.'),
    h('ol', { class: 'pilha lista-produtos' }, lista.map((r, i) => cartaoDoProduto(r, dados, hoje, i + 1))));
}

/** Seção "Produtos que mais rendem agora" de "Onde rende mais" (null se não houver). */
export function secaoQueMaisRende(dados, vitrine, { hoje, agora }) {
  const validos = produtosQueValem(vitrine, dados, agora);
  if (!validos.length) return null;
  const lista = rankearProdutos(validos, dados, hoje).slice(0, MAXIMO_NO_RANKING);
  return h('section', { class: 'pilha--sm', 'aria-labelledby': 'produtos-titulo' },
    h('h2', { id: 'produtos-titulo', class: 'pagina__subtitulo' }, 'Produtos que mais rendem pontos agora'),
    avisoDemo(lista),
    h('p', { class: 'texto-suave texto-pequeno' },
      'Ordem pelos pontos por real para qualquer pessoa, não pelo preço. Nome e preço vêm da API oficial de cada loja.'),
    h('ol', { class: 'pilha lista-produtos' }, lista.map((r, i) => cartaoDoProduto(r, dados, hoje, i + 1, { mostrarLoja: true }))));
}

/** A vitrine tem algum link de afiliado? (muda os textos de Termos e Sobre os dados). */
export function vitrineTemAfiliado(vitrine, dados, agora) {
  return produtosQueValem(vitrine, dados, agora).some((p) => p.afiliado);
}

