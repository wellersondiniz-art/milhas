// Testes do ranking "o que mais rende" (site/js/motor/oportunidades.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankearOportunidades } from '../site/js/motor/index.js';

const HOJE = '2026-11-24';

function oferta(campos) {
  return {
    id: 'oferta',
    loja_id: 'loja-a',
    programa_id: 'prog-a',
    regras: [{ condicao: {}, pontos_por_real: 5 }],
    escopo: 'todos_os_produtos',
    acumula_com_cartao: true,
    exige_cupom: false,
    inicio: '2026-11-01',
    fim: '2026-11-30',
    credito_prazo_dias: 30,
    link_oferta: 'https://loja-a.com.br/oferta',
    fonte_url: 'https://loja-a.com.br/oferta',
    verificado_em: '2026-11-20',
    ...campos,
  };
}

function dados(ofertas) {
  return {
    programas: [
      { id: 'prog-a', nome: 'Programa A', valor_milheiro_brl: 1700 },
      { id: 'prog-b', nome: 'Programa B', valor_milheiro_brl: 'A_CONFIRMAR' },
    ],
    lojas: [
      { id: 'loja-a', nome: 'Loja A' },
      { id: 'loja-b', nome: 'Loja B' },
    ],
    cartoes: [],
    ofertas,
  };
}

const CLUBE_E_CARTAO = [
  { condicao: { clube_ativo: true, cartao_id: 'cartao-x' }, pontos_por_real: 15 },
  { condicao: { clube_ativo: true }, pontos_por_real: 13 },
  { condicao: { cartao_id: 'cartao-x' }, pontos_por_real: 9 },
  { condicao: {}, pontos_por_real: 7 },
];

test('ordena pelos pontos por real que qualquer pessoa ganha', () => {
  const lista = rankearOportunidades(dados([
    oferta({ id: 'baixa', regras: [{ condicao: {}, pontos_por_real: 3 }] }),
    oferta({ id: 'alta', loja_id: 'loja-b', regras: [{ condicao: {}, pontos_por_real: 10 }] }),
    oferta({ id: 'media', programa_id: 'prog-b', regras: [{ condicao: {}, pontos_por_real: 6 }] }),
  ]), HOJE);
  assert.deepEqual(lista.map((o) => o.oferta_id), ['alta', 'media', 'baixa']);
  assert.equal(lista[0].loja.nome, 'Loja B');
  assert.equal(lista[0].pontos_por_real_referencia, 10);
  assert.equal(lista[0].pontos_por_real_para_voce, null);
});

test('sem perfil, oferta que só rende com clube vale 0 na ordem, mas mostra o máximo', () => {
  const lista = rankearOportunidades(dados([
    oferta({ id: 'so-clube', regras: [{ condicao: { clube_ativo: true }, pontos_por_real: 20 }] }),
    oferta({ id: 'aberta', regras: [{ condicao: {}, pontos_por_real: 2 }] }),
  ]), HOJE);
  assert.deepEqual(lista.map((o) => o.oferta_id), ['aberta', 'so-clube']);
  assert.equal(lista[1].pontos_por_real_sem_exigencia, 0);
  assert.deepEqual(lista[1].maximo, { pontos_por_real: 20, pede_clube: true, pede_cartao_id: null });
});

test('empate na referência: vence o maior máximo, depois loja, programa e id', () => {
  const lista = rankearOportunidades(dados([
    oferta({ id: 'z', loja_id: 'loja-b' }),
    oferta({ id: 'y', programa_id: 'prog-b' }),
    oferta({ id: 'x' }),
    oferta({ id: 'w' }),
    oferta({ id: 'com-clube', loja_id: 'loja-b', regras: [{ condicao: {}, pontos_por_real: 5 }, { condicao: { clube_ativo: true }, pontos_por_real: 8 }] }),
  ]), HOJE);
  assert.deepEqual(lista.map((o) => o.oferta_id), ['com-clube', 'w', 'x', 'y', 'z']);
});

test('máximo: em empate de pontos, a faixa que pede menos', () => {
  const [o] = rankearOportunidades(dados([oferta({
    regras: [{ condicao: { clube_ativo: true }, pontos_por_real: 8 }, { condicao: { cartao_id: 'c' }, pontos_por_real: 8 }, { condicao: { clube_ativo: true, cartao_id: 'c' }, pontos_por_real: 8 }],
  })]), HOJE);
  assert.deepEqual(o.maximo, { pontos_por_real: 8, pede_clube: true, pede_cartao_id: null });
});

test('com perfil: usa o clube e o melhor cartão da pessoa', () => {
  const d = dados([
    oferta({ id: 'clube', regras: CLUBE_E_CARTAO, clube_ativo_ha_horas: 24 }),
    oferta({ id: 'aberta', loja_id: 'loja-b', regras: [{ condicao: {}, pontos_por_real: 10 }] }),
  ]);
  const semNada = rankearOportunidades(d, HOJE, { perfil: { programas: [], cartoes: [] } });
  assert.deepEqual(semNada.map((o) => [o.oferta_id, o.pontos_por_real_para_voce]), [['aberta', 10], ['clube', 7]]);

  const comCartao = rankearOportunidades(d, HOJE, { perfil: { programas: [], cartoes: ['outro', 'cartao-x'] } });
  assert.deepEqual(comCartao.map((o) => [o.oferta_id, o.pontos_por_real_para_voce]), [['aberta', 10], ['clube', 9]]);

  const comClube = rankearOportunidades(d, HOJE, {
    perfil: { programas: [{ programa_id: 'prog-a', clube_ativo: true, clube_ativo_desde: '2026-01-01' }], cartoes: ['cartao-x'] },
  });
  assert.deepEqual(comClube.map((o) => [o.oferta_id, o.pontos_por_real_para_voce]), [['clube', 15], ['aberta', 10]]);
  assert.equal(comClube[0].pontos_por_real_referencia, 15);
});

test('com perfil: clube assinado há pouco tempo não conta', () => {
  const d = dados([oferta({ regras: CLUBE_E_CARTAO, clube_ativo_ha_horas: 24 })]);
  const [o] = rankearOportunidades(d, '2026-11-24T10:00', {
    perfil: { programas: [{ programa_id: 'prog-a', clube_ativo: true, clube_ativo_desde: '2026-11-24' }], cartoes: [] },
  });
  assert.equal(o.pontos_por_real_para_voce, 7);
});

test('a cada R$ 100: pontos e valor pelo milheiro (do programa ou do perfil)', () => {
  const d = dados([
    oferta({ id: 'a', regras: [{ condicao: {}, pontos_por_real: 7 }] }),
    oferta({ id: 'b', programa_id: 'prog-b', regras: [{ condicao: {}, pontos_por_real: 1.5 }] }),
  ]);
  const [a, b] = rankearOportunidades(d, HOJE);
  assert.equal(a.a_cada_100_reais.pontos, 700);
  assert.equal(a.a_cada_100_reais.pontos_texto, '700');
  // 700 pontos × R$ 17,00 por milheiro ÷ 1.000 = R$ 11,90
  assert.equal(a.a_cada_100_reais.valor_estimado_em_reais.texto, 'R$ 11,90');
  assert.equal(b.a_cada_100_reais.pontos, 150);
  assert.equal(b.a_cada_100_reais.valor_estimado_em_reais, null, 'milheiro A_CONFIRMAR não entra');

  const [a2, b2] = rankearOportunidades(d, HOJE, { perfil: { programas: [], cartoes: [], valor_milheiro_brl: { 'prog-a': 2000, 'prog-b': 2500 } } });
  assert.equal(a2.a_cada_100_reais.valor_estimado_em_reais.texto, 'R$ 14,00');
  assert.equal(b2.a_cada_100_reais.valor_estimado_em_reais.texto, 'R$ 3,75');
});

test('valor guarda a precisão até a exibição', () => {
  const d = dados([oferta({ regras: [{ condicao: {}, pontos_por_real: 0.0001 }] })]);
  d.programas[0].valor_milheiro_brl = 1;
  const [o] = rankearOportunidades(d, HOJE);
  // 0,01 ponto × 1 centavo por milheiro = 0,00001 centavo = 10.000 bilionésimos
  assert.equal(o.a_cada_100_reais.valor_estimado_em_reais.bilionesimos_de_centavo, 10_000n);
  assert.equal(o.a_cada_100_reais.valor_estimado_em_reais.texto, 'R$ 0,00');
});

test('fica fora: vencida, que não começou, A_CONFIRMAR, de outra loja, sem loja ou programa', () => {
  const lista = rankearOportunidades(dados([
    oferta({ id: 'vencida', fim: '2026-11-23' }),
    oferta({ id: 'futura', inicio: '2026-11-25' }),
    oferta({ id: 'em-conferencia', status: 'A_CONFIRMAR' }),
    oferta({ id: 'sem-loja', loja_id: 'nao-existe' }),
    oferta({ id: 'sem-programa', programa_id: 'nao-existe' }),
    oferta({ id: 'sem-regras', regras: [] }),
    oferta({ id: 'outra-loja', loja_id: 'loja-b' }),
    oferta({ id: 'vale', inicio: 'A_CONFIRMAR', fim: 'A_CONFIRMAR' }),
    oferta({ id: 'ultimo-dia', fim: HOJE, status: 'confirmado' }),
  ]), HOJE, { loja_id: 'loja-a' });
  assert.deepEqual(lista.map((o) => o.oferta_id).sort(), ['ultimo-dia', 'vale']);
  const vale = lista.find((o) => o.oferta_id === 'vale');
  assert.equal(vale.vence_em_dias, null);
  assert.equal(lista.find((o) => o.oferta_id === 'ultimo-dia').vence_em_dias, 0);
});

test('o que a oferta cobre, em texto e em lista', () => {
  const lista = rankearOportunidades(dados([
    oferta({ id: 'cat', escopo: 'categorias_selecionadas', categorias_incluidas: ['Eletrônicos', 'Celulares'], categorias_excluidas: ['Gift card'] }),
    oferta({ id: 'loja', escopo: 'vendido_e_entregue_pela_loja', pontos_fora_do_escopo_por_real: 1 }),
    oferta({ id: 'todos', escopo: 'todos_os_produtos', pontos_fora_do_escopo_por_real: 'A_CONFIRMAR' }),
    oferta({ id: 'estranho', escopo: 'outro' }),
  ]), HOJE);
  const por = Object.fromEntries(lista.map((o) => [o.oferta_id, o]));
  assert.equal(por.cat.alvo.texto, 'Só estas categorias: Eletrônicos, Celulares. Fora: Gift card.');
  assert.deepEqual(por.cat.alvo.categorias_incluidas, ['Eletrônicos', 'Celulares']);
  assert.equal(por.loja.alvo.texto, 'Produtos vendidos e entregues pela própria loja.');
  assert.equal(por.loja.pontos_fora_do_escopo_por_real, 1);
  assert.equal(por.todos.alvo.texto, 'Todos os produtos.');
  assert.equal(por.todos.pontos_fora_do_escopo_por_real, null);
  assert.deepEqual(por.todos.alvo.categorias_excluidas, []);
  assert.equal(por.estranho.alvo.texto, 'Produtos cobertos não confirmados.');
});

test('produtos em campanha: só nome e link, nada mais é copiado', () => {
  const [o] = rankearOportunidades(dados([oferta({
    produtos_em_campanha: [{ nome: 'Geladeira X', link: 'https://loja-a.com.br/geladeira-x', preco: 999 }],
  })]), HOJE);
  assert.deepEqual(o.produtos_em_campanha, [{ nome: 'Geladeira X', link: 'https://loja-a.com.br/geladeira-x' }]);
  const [sem] = rankearOportunidades(dados([oferta({})]), HOJE);
  assert.deepEqual(sem.produtos_em_campanha, []);
});

test('links e fonte: link A_CONFIRMAR vira null; fonte e data vão junto', () => {
  const [o] = rankearOportunidades(dados([oferta({ link_oferta: 'A_CONFIRMAR' })]), HOJE);
  assert.equal(o.link_oferta, null);
  assert.equal(o.fonte_url, 'https://loja-a.com.br/oferta');
  assert.equal(o.verificado_em, '2026-11-20');
  assert.equal(o.fim, '2026-11-30');
  assert.equal(o.vence_em_dias, 6);
});

test('mesma entrada, mesma saída, e não mexe nos dados', () => {
  const d = dados([oferta({ regras: CLUBE_E_CARTAO }), oferta({ id: 'b', loja_id: 'loja-b' })]);
  const copia = structuredClone(d);
  const um = rankearOportunidades(d, HOJE);
  const dois = rankearOportunidades(d, HOJE);
  assert.deepEqual(um, dois);
  assert.deepEqual(d, copia);
});

test('entrada inválida dá erro claro', () => {
  assert.throws(() => rankearOportunidades(dados([]), '24/11/2026'));
  assert.throws(() => rankearOportunidades({ lojas: [], programas: [] }, HOJE), /dados\.ofertas precisa ser uma lista/);
  assert.throws(() => rankearOportunidades(dados([]), HOJE, { perfil: { programas: [] } }), /perfil precisa/);
  assert.throws(() => rankearOportunidades(dados([oferta({ regras: [{ condicao: {}, pontos_por_real: 1.00001 }] })]), HOJE), /4 casas/);
  assert.deepEqual(rankearOportunidades(dados([]), HOJE, { perfil: null }), []);
});
