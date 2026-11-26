// Pontos de um produto da vitrine (preço que veio da API oficial da loja).
//
// Usa o mesmo motor da calculadora: a compra é o preço do produto, na loja
// dele, com a categoria e o tipo de vendedor que sabemos. Dois cenários:
//   - qualquer pessoa: sem clube e sem cartão específico;
//   - máximo: clube ativo (há muito tempo) e o melhor dos cartões cadastrados.
// Funções puras (sem DOM, rede ou relógio).

import { calcularJeitosDeComprar } from './calcular.js';

/** Clube assinado "há muito tempo": cumpre qualquer exigência de horas. */
const CLUBE_DESDE = '2000-01-01';
const UM_REAL = 100;

function perfil(dados, completo) {
  return {
    programas: dados.programas.map((p) => (
      completo ? { programa_id: p.id, clube_ativo: true, clube_ativo_desde: CLUBE_DESDE } : { programa_id: p.id, clube_ativo: false }
    )),
    cartoes: completo ? dados.cartoes.map((c) => c.id) : [],
    valor_milheiro_brl: {},
  };
}

function compra(produto, valor) {
  return {
    loja_id: produto.loja_id,
    valor_centavos: valor,
    tipo_vendedor: produto.vendido_pela_loja === true ? 'loja' : 'parceiro',
    ...(produto.categoria ? { categoria: produto.categoria } : {}),
  };
}

function resumo(jeito) {
  return {
    tipo: jeito.tipo,
    total_pontos: jeito.total_pontos,
    total_pontos_texto: jeito.total_pontos_texto,
    valor_texto: jeito.valor_estimado_em_reais?.texto ?? null,
    programa: jeito.programa,
    /** Só quando o cartão soma pontos de verdade (cartão sem pontos confirmados não conta). */
    cartao: jeito.pontos_do_cartao > 0 ? jeito.cartao : null,
    pede_clube: jeito.condicoes_a_cumprir.some((c) => c.startsWith('Estar com o clube')),
    avisos: jeito.avisos,
  };
}

/**
 * Quanto o produto rende.
 * Devolve { qualquer, maximo (null se igual a qualquer), pontos_por_real }.
 * pontos_por_real é o do cenário "qualquer pessoa" (número, só para ordenar).
 */
export function pontosDoProduto(produto, dados, hoje) {
  const [qualquer] = calcularJeitosDeComprar(perfil(dados, false), compra(produto, produto.preco_centavos), dados, hoje);
  const [maximo] = calcularJeitosDeComprar(perfil(dados, true), compra(produto, produto.preco_centavos), dados, hoje);
  const [porReal] = calcularJeitosDeComprar(perfil(dados, false), compra(produto, UM_REAL), dados, hoje);
  return {
    qualquer: resumo(qualquer),
    maximo: maximo.total_pontos > qualquer.total_pontos ? resumo(maximo) : null,
    pontos_por_real: porReal.total_pontos,
  };
}

/**
 * Produtos com os pontos, do que mais rende por real ao que menos rende.
 * Empate: o mais barato primeiro; depois, o nome.
 */
export function rankearProdutos(produtos, dados, hoje) {
  return produtos
    .map((produto) => ({ produto, pontos: pontosDoProduto(produto, dados, hoje) }))
    .sort((a, b) => b.pontos.pontos_por_real - a.pontos.pontos_por_real ||
      a.produto.preco_centavos - b.produto.preco_centavos ||
      a.produto.nome.localeCompare(b.produto.nome, 'pt-BR'));
}
