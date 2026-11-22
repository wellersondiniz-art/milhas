// Casos de borda do motor de cálculo: entradas inválidas, limites de data,
// escopo por categoria, faixas sem regra, empates e arredondamento.
// Complementa testes/motor.test.mjs. As contas esperadas estão nos comentários.
//
// Conta: pontos = pontos_por_real × valor em reais
//        valor (centavos) = pontos × milheiro (centavos) ÷ 1000
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularJeitosDeComprar as calcular, arredondarParaCentavos, formatarCentavos, formatarData, formatarPontos, formatarValor,
} from '../site/js/motor/index.js';
import { diasEntre, horasGarantidasDesde, lerDataHora, temHora } from '../site/js/motor/datas.js';
import { formatarNumero, pontosParaNumero, pontosPorReal } from '../site/js/motor/formatar.js';

const BI = 1_000_000_000n;
const FONTE = 'https://exemplo.invalid/teste';
const HOJE = '2026-11-10';
const VERIFICADO = '2026-11-05';

function dadosBase() {
  return {
    programas: [
      { id: 'prog-a', nome: 'Programa A', tipo: 'milhas', valor_milheiro_brl: 2000, fonte_url: FONTE, verificado_em: VERIFICADO },
      { id: 'prog-b', nome: 'Programa B', tipo: 'pontos', valor_milheiro_brl: 1000, fonte_url: FONTE, verificado_em: VERIFICADO },
      { id: 'prog-sem-milheiro', nome: 'Programa C', tipo: 'pontos', valor_milheiro_brl: 'A_CONFIRMAR', fonte_url: FONTE, verificado_em: VERIFICADO },
    ],
    cartoes: [
      { id: 'cartao-a', nome: 'Cartão A', programa_id: 'prog-a', pontos_por_real: 2, status: 'confirmado', fonte_url: FONTE, verificado_em: VERIFICADO },
      { id: 'cartao-b', nome: 'Cartão B', programa_id: 'prog-b', pontos_por_real: 3, status: 'confirmado', fonte_url: FONTE, verificado_em: VERIFICADO },
      { id: 'cartao-c', nome: 'Cartão C', programa_id: 'prog-sem-milheiro', pontos_por_real: 1, status: 'confirmado', fonte_url: FONTE, verificado_em: VERIFICADO },
    ],
    lojas: [
      { id: 'loja', nome: 'Loja X', fonte_url: FONTE, verificado_em: VERIFICADO },
      { id: 'vazia', nome: 'Loja Vazia', fonte_url: FONTE, verificado_em: VERIFICADO },
    ],
    ofertas: [
      {
        id: 'oferta-a',
        loja_id: 'loja',
        programa_id: 'prog-a',
        regras: [
          { condicao: { clube_ativo: true }, pontos_por_real: 10 },
          { condicao: {}, pontos_por_real: 5 },
        ],
        escopo: 'todos_os_produtos',
        pontos_fora_do_escopo_por_real: 1,
        acumula_com_cartao: true,
        clube_ativo_ha_horas: 24,
        exige_cupom: false,
        inicio: '2026-11-01',
        fim: '2026-11-30',
        credito_prazo_dias: 30,
        fonte_url: FONTE,
        verificado_em: VERIFICADO,
      },
    ],
  };
}

function dadosCom(alterar) {
  const d = dadosBase();
  alterar(d);
  return d;
}

const PROG_A = { programa_id: 'prog-a', clube_ativo: false };
const perfil = (programas = [PROG_A], cartoes = [], extra = {}) => ({ programas, cartoes, ...extra });
const compra = (valor_centavos = 10000, extra = {}) => ({ loja_id: 'loja', valor_centavos, tipo_vendedor: 'loja', ...extra });
const ofertaDe = (lista) => lista.find((j) => j.tipo === 'oferta');

// ---------------------------------------------------------------------------
describe('entrada inválida é recusada com mensagem clara', () => {
  test('perfil sem listas', () => {
    for (const p of [null, {}, { programas: [] }, { cartoes: [] }, { programas: 'x', cartoes: [] }]) {
      assert.throws(() => calcular(p, compra(), dadosBase(), HOJE), /perfil precisa de "programas" e "cartoes"/);
    }
  });

  test('compra sem loja ou com vendedor desconhecido', () => {
    assert.throws(() => calcular(perfil(), { valor_centavos: 100, tipo_vendedor: 'loja' }, dadosBase(), HOJE), /loja_id/);
    assert.throws(() => calcular(perfil(), null, dadosBase(), HOJE), /loja_id/);
    for (const tipo of [undefined, 'marketplace', 'LOJA']) {
      assert.throws(() => calcular(perfil(), compra(100, { tipo_vendedor: tipo }), dadosBase(), HOJE), /tipo_vendedor/);
    }
  });

  test('valor não numérico, infinito ou NaN', () => {
    for (const v of [NaN, Infinity, null, undefined, 100n]) {
      const c = { loja_id: 'loja', valor_centavos: v, tipo_vendedor: 'loja' };
      assert.throws(() => calcular(perfil(), c, dadosBase(), HOJE), /valor_centavos/);
    }
  });

  test('dados sem alguma das quatro listas', () => {
    for (const falta of ['programas', 'cartoes', 'lojas', 'ofertas']) {
      const d = dadosCom((x) => { delete x[falta]; });
      assert.throws(() => calcular(perfil(), compra(), d, HOJE), new RegExp(`dados\\.${falta} precisa ser uma lista`));
    }
    assert.throws(() => calcular(perfil(), compra(), null, HOJE), /dados\.programas/);
  });

  test('loja que não existe nos dados', () => {
    assert.throws(() => calcular(perfil(), compra(100, { loja_id: 'nao-existe' }), dadosBase(), HOJE), /loja "nao-existe" não existe/);
  });

  test('data de hoje inválida ou inexistente', () => {
    for (const hoje of ['2026-02-30', '2026-13-01', '10/11/2026', '2026-1-1', '', null, '2026-11-10T25:00']) {
      assert.throws(() => calcular(perfil(), compra(), dadosBase(), hoje), /data inválida/);
    }
  });

  test('milheiro do perfil precisa ser centavos inteiros >= 0', () => {
    for (const v of [-1, 17.5, '1700', NaN]) {
      const p = perfil([PROG_A], [], { valor_milheiro_brl: { 'prog-a': v } });
      assert.throws(() => calcular(p, compra(), dadosBase(), HOJE), /valor_milheiro_brl de "prog-a"/);
    }
  });

  test('pontos por real com mais de 4 casas decimais é erro de dado', () => {
    const d = dadosCom((x) => { x.ofertas[0].regras[1].pontos_por_real = 1.23456; });
    assert.throws(() => calcular(perfil(), compra(), d, HOJE), /mais de 4 casas decimais/);
  });
});

// ---------------------------------------------------------------------------
describe('perfil', () => {
  test('cartão repetido e cartão que não existe nos dados são ignorados', () => {
    const lista = calcular(perfil([], ['cartao-a', 'cartao-a', 'nao-existe']), compra(10000, { loja_id: 'vazia' }), dadosBase(), HOJE);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].cartao.id, 'cartao-a');
  });

  test('programa repetido no perfil: vale o primeiro', () => {
    const p = perfil([{ programa_id: 'prog-a', clube_ativo: true, clube_ativo_desde: '2026-11-01' }, { programa_id: 'prog-a', clube_ativo: false }]);
    // Primeiro diz que tem clube há dias: faixa de 10 → 100 × 10 = 1000
    assert.equal(ofertaDe(calcular(p, compra(), dadosBase(), HOJE)).total_pontos, 1000);
  });

  test('itens estranhos no perfil (null, sem programa_id) não quebram', () => {
    const p = perfil([null, { clube_ativo: true }, PROG_A]);
    assert.equal(ofertaDe(calcular(p, compra(), dadosBase(), HOJE)).total_pontos, 500);
  });

  test('oferta de programa que a pessoa não tem não aparece', () => {
    const lista = calcular(perfil([{ programa_id: 'prog-b', clube_ativo: false }]), compra(), dadosBase(), HOJE);
    assert.equal(ofertaDe(lista), undefined);
  });

  test('perfil vazio: só o caso base, com 0 pontos', () => {
    const lista = calcular(perfil([], []), compra(), dadosBase(), HOJE);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].tipo, 'sem_oferta');
    assert.equal(lista[0].cartao, null);
    assert.equal(lista[0].programa, null);
    assert.equal(lista[0].total_pontos, 0);
    assert.equal(lista[0].prazo_de_credito, null);
    assert.ok(lista[0].explicacao.includes('Sem cartão de crédito do seu perfil: 0 pontos de cartão.'));
  });

  test('milheiro 0 no perfil vale (pontos sem valor para a pessoa)', () => {
    const p = perfil([PROG_A], [], { valor_milheiro_brl: { 'prog-a': 0 } });
    const o = ofertaDe(calcular(p, compra(), dadosBase(), HOJE));
    assert.equal(o.total_pontos, 500);
    assert.deepEqual(o.valor_estimado_em_reais, { bilionesimos_de_centavo: 0n, texto: 'R$ 0,00' });
  });
});

// ---------------------------------------------------------------------------
describe('validade da oferta', () => {
  test('primeiro dia vale; véspera não', () => {
    assert.ok(ofertaDe(calcular(perfil(), compra(), dadosBase(), '2026-11-01')));
    assert.equal(ofertaDe(calcular(perfil(), compra(), dadosBase(), '2026-10-31')), undefined);
  });

  test('"hoje" com hora: conta só a data para a validade', () => {
    assert.ok(ofertaDe(calcular(perfil(), compra(), dadosBase(), '2026-11-30T23:59')));
    assert.equal(ofertaDe(calcular(perfil(), compra(), dadosBase(), '2026-12-01T00:00')), undefined);
  });

  test('aviso de vencimento: amanhã, 7 dias sim, 8 dias não', () => {
    const avisos = (hoje) => ofertaDe(calcular(perfil(), compra(), dadosBase(), hoje)).avisos;
    assert.ok(avisos('2026-11-29').includes('A oferta vence amanhã (30/11/2026).'));
    assert.ok(avisos('2026-11-23').includes('A oferta vence em 7 dias (30/11/2026).'));
    assert.ok(!avisos('2026-11-22').some((a) => a.startsWith('A oferta vence')));
  });

  test('início e fim A_CONFIRMAR: entra, com avisos e texto de validade', () => {
    const d = dadosCom((x) => { x.ofertas[0].inicio = 'A_CONFIRMAR'; x.ofertas[0].fim = 'A_CONFIRMAR'; });
    const o = ofertaDe(calcular(perfil(), compra(), d, '2030-01-01'));
    assert.ok(o);
    assert.ok(o.avisos.includes('A data de início da oferta não está confirmada.'));
    assert.ok(o.avisos.includes('A data de fim da oferta não está confirmada; confira antes de comprar.'));
    assert.equal(o.validade_da_oferta.texto, 'Início não confirmado, fim não confirmado.');
  });

  test('oferta de outra loja não entra', () => {
    const d = dadosCom((x) => { x.ofertas[0].loja_id = 'vazia'; });
    assert.equal(ofertaDe(calcular(perfil(), compra(), d, HOJE)), undefined);
  });

  test('prazo de crédito A_CONFIRMAR vira texto de não confirmado', () => {
    const d = dadosCom((x) => { x.ofertas[0].credito_prazo_dias = 'A_CONFIRMAR'; });
    assert.deepEqual(ofertaDe(calcular(perfil(), compra(), d, HOJE)).prazo_de_credito, {
      dias: null, texto: 'Prazo de crédito dos pontos da oferta não confirmado.',
    });
  });
});

// ---------------------------------------------------------------------------
describe('dado antigo (14 dias)', () => {
  test('14 dias ainda não é antigo; 15 é', () => {
    const d = dadosCom((x) => { x.ofertas[0].verificado_em = '2026-10-27'; });
    const ofertaConferida = (hoje) => ofertaDe(calcular(perfil(), compra(), d, hoje)).conferido_em
      .find((c) => c.rotulo === 'oferta Programa A na Loja X');
    assert.deepEqual(ofertaConferida('2026-11-10'), { rotulo: 'oferta Programa A na Loja X', verificado_em: '2026-10-27', dias: 14, antigo: false });
    assert.equal(ofertaConferida('2026-11-11').antigo, true);
  });

  test('milheiro informado pela pessoa não gera aviso de dado antigo do cadastro', () => {
    const d = dadosCom((x) => { x.programas[0].verificado_em = '2026-01-01'; });
    const p = perfil([PROG_A], [], { valor_milheiro_brl: { 'prog-a': 1500 } });
    const o = ofertaDe(calcular(p, compra(), d, HOJE));
    assert.ok(!o.avisos.some((a) => a.includes('valor do milheiro')));
    // O programa em si continua conferido (e antigo).
    assert.ok(o.avisos.some((a) => a.endsWith(': programa Programa A.')));
  });
});

// ---------------------------------------------------------------------------
describe('escopo por categoria', () => {
  const porCategoria = (x) => {
    Object.assign(x.ofertas[0], { escopo: 'categorias_selecionadas', categorias_incluidas: ['eletro', 'moveis'] });
  };

  test('categoria da oferta: vale a faixa normal', () => {
    const o = ofertaDe(calcular(perfil(), compra(10000, { categoria: 'eletro' }), dadosCom(porCategoria), HOJE));
    assert.equal(o.pontos_do_programa, 500);
    assert.ok(o.condicoes_a_cumprir.includes('Produto de uma das categorias da oferta: eletro, moveis.'));
  });

  test('categoria fora da oferta: pontos fora do escopo', () => {
    const o = ofertaDe(calcular(perfil(), compra(10000, { categoria: 'livros' }), dadosCom(porCategoria), HOJE));
    // 100 × 1 = 100
    assert.equal(o.pontos_do_programa, 100);
    assert.ok(o.avisos.includes('Produto da categoria "livros", fora da oferta, rende só 1 ponto por real.'));
    assert.deepEqual(o.o_que_voce_ganharia_se, []);
  });

  test('sem categoria informada: pede a categoria', () => {
    const o = ofertaDe(calcular(perfil(), compra(), dadosCom(porCategoria), HOJE));
    assert.equal(o.pontos_do_programa, 100);
    assert.ok(o.avisos.includes('Informe a categoria do produto para saber se ele entra na oferta.'));
  });

  test('categoria excluída vence o escopo "todos os produtos"', () => {
    const d = dadosCom((x) => { x.ofertas[0].categorias_excluidas = ['celulares']; });
    const o = ofertaDe(calcular(perfil(), compra(10000, { categoria: 'celulares' }), d, HOJE));
    assert.equal(o.pontos_do_programa, 100);
    assert.ok(o.avisos.includes('Produto da categoria "celulares", excluída da oferta, rende só 1 ponto por real.'));
  });

  test('pontos fora do escopo A_CONFIRMAR: conta 0 e avisa', () => {
    const d = dadosCom((x) => { porCategoria(x); x.ofertas[0].pontos_fora_do_escopo_por_real = 'A_CONFIRMAR'; });
    const o = ofertaDe(calcular(perfil(), compra(10000, { categoria: 'livros' }), d, HOJE));
    assert.equal(o.pontos_do_programa, 0);
    assert.ok(o.avisos.includes('Produto da categoria "livros", fora da oferta, fica fora da oferta, e os pontos fora da oferta não estão confirmados; contamos 0.'));
  });

  test('parceiro em oferta "todos os produtos" continua dentro da oferta', () => {
    const o = ofertaDe(calcular(perfil(), compra(10000, { tipo_vendedor: 'parceiro' }), dadosBase(), HOJE));
    assert.equal(o.pontos_do_programa, 500);
  });
});

// ---------------------------------------------------------------------------
describe('clube', () => {
  const comClube = (desde) => perfil([{ programa_id: 'prog-a', clube_ativo: true, ...(desde ? { clube_ativo_desde: desde } : {}) }]);

  test('exatamente 24 h conta; 23 h 59 não', () => {
    assert.equal(ofertaDe(calcular(comClube('2026-11-09T10:00'), compra(), dadosBase(), '2026-11-10T10:00')).pontos_do_programa, 1000);
    assert.equal(ofertaDe(calcular(comClube('2026-11-09T10:01'), compra(), dadosBase(), '2026-11-10T10:00')).pontos_do_programa, 500);
  });

  test('clube ativo sem data: fica na faixa sem clube e pede a data', () => {
    const o = ofertaDe(calcular(comClube(null), compra(), dadosBase(), HOJE));
    assert.equal(o.pontos_do_programa, 500);
    assert.match(o.o_que_voce_ganharia_se[0].texto, /confirmasse que o seu clube Programa A está ativo há pelo menos 24 horas \(informe desde quando\)/);
  });

  test('oferta sem exigência de horas: clube ativo basta, mesmo sem data', () => {
    const d = dadosCom((x) => { delete x.ofertas[0].clube_ativo_ha_horas; });
    assert.equal(ofertaDe(calcular(comClube(null), compra(), d, HOJE)).pontos_do_programa, 1000);
  });

  test('horas exigidas A_CONFIRMAR: clube conta, com aviso', () => {
    const d = dadosCom((x) => { x.ofertas[0].clube_ativo_ha_horas = 'A_CONFIRMAR'; });
    const o = ofertaDe(calcular(comClube(null), compra(), d, HOJE));
    assert.equal(o.pontos_do_programa, 1000);
    assert.ok(o.avisos.includes('Não está confirmado há quanto tempo o clube precisa estar ativo antes da compra.'));
  });

  test('assinou o clube hoje sem hora: não conta (conservador)', () => {
    assert.equal(ofertaDe(calcular(comClube(HOJE), compra(), dadosBase(), HOJE)).pontos_do_programa, 500);
  });
});

// ---------------------------------------------------------------------------
describe('faixas e soma com o cartão', () => {
  test('oferta sem nenhuma faixa que valha: 0 ponto por real', () => {
    const d = dadosCom((x) => { x.ofertas[0].regras = [{ condicao: { clube_ativo: true }, pontos_por_real: 10 }]; });
    const o = ofertaDe(calcular(perfil(), compra(), d, HOJE));
    assert.equal(o.pontos_do_programa, 0);
    assert.ok(o.explicacao.includes('Oferta Programa A na Loja X: nenhuma faixa vale para você agora, então 0 ponto por real.'));
    assert.equal(o.o_que_voce_ganharia_se.length, 1);
  });

  test('empate de especificidade: vale a faixa com mais pontos', () => {
    const d = dadosCom((x) => { x.ofertas[0].regras = [{ condicao: {}, pontos_por_real: 3 }, { condicao: {}, pontos_por_real: 4 }]; });
    assert.equal(ofertaDe(calcular(perfil(), compra(), d, HOJE)).pontos_do_programa, 400);
  });

  test('faixa de 4 casas decimais fica exata', () => {
    const d = dadosCom((x) => { x.ofertas[0].regras = [{ condicao: {}, pontos_por_real: 1.2345 }]; });
    // R$ 100,00 × 1,2345 = 123,45 pontos; valor 123,45 × 2000 ÷ 1000 = 246,9 centavos → R$ 2,47
    const o = ofertaDe(calcular(perfil(), compra(), d, HOJE));
    assert.equal(o.pontos_do_programa, 123.45);
    assert.equal(o.valor_estimado_em_reais.bilionesimos_de_centavo, 246_900_000_000n);
    assert.equal(o.valor_estimado_em_reais.texto, 'R$ 2,47');
  });

  test('acumula A_CONFIRMAR e o cartão rende mais: vale o cartão', () => {
    const d = dadosCom((x) => { x.ofertas[0].acumula_com_cartao = 'A_CONFIRMAR'; x.ofertas[0].regras = [{ condicao: {}, pontos_por_real: 1 }]; });
    const o = ofertaDe(calcular(perfil([PROG_A], ['cartao-b']), compra(), d, HOJE));
    // oferta 100 × 1 = 100; cartão B 100 × 3 = 300 → vale 300 (Programa B, milheiro R$ 10,00 → 300 centavos)
    assert.equal(o.pontos_do_programa, 0);
    assert.equal(o.pontos_do_cartao, 300);
    assert.equal(o.valor_estimado_em_reais.texto, 'R$ 3,00');
    assert.ok(o.avisos.includes('Não está confirmado se os pontos do cartão somam com a oferta; por isso contamos só o maior dos dois.'));
  });

  test('cartão de outro programa: valor soma os dois programas', () => {
    const o = ofertaDe(calcular(perfil([PROG_A], ['cartao-b']), compra(), dadosBase(), HOJE));
    // A: 100 × 5 = 500 pontos × R$ 20 ÷ 1000 = 1000 centavos; B: 100 × 3 = 300 × R$ 10 ÷ 1000 = 300 → R$ 13,00
    assert.equal(o.total_pontos, 800);
    assert.equal(o.valor_estimado_em_reais.texto, 'R$ 13,00');
    assert.ok(o.explicacao.includes('Valor total estimado: R$ 13,00.'));
  });

  test('cartão de programa sem milheiro: pontos somam, valor fica sem estimativa', () => {
    const o = ofertaDe(calcular(perfil([PROG_A], ['cartao-c']), compra(), dadosBase(), HOJE));
    assert.equal(o.total_pontos, 600);
    assert.equal(o.valor_estimado_em_reais, null);
    assert.ok(o.explicacao.some((p) => p.includes('falta o valor do milheiro de Programa C')));
  });

  test('cartão com status A_CONFIRMAR não soma, mesmo com número', () => {
    const d = dadosCom((x) => { x.cartoes[0].status = 'A_CONFIRMAR'; });
    const o = ofertaDe(calcular(perfil([PROG_A], ['cartao-a']), compra(), d, HOJE));
    assert.equal(o.pontos_do_cartao, 0);
  });

  test('pontos por real negativo no cartão é tratado como não confirmado', () => {
    const d = dadosCom((x) => { x.cartoes[0].pontos_por_real = -2; });
    const lista = calcular(perfil([], ['cartao-a']), compra(10000, { loja_id: 'vazia' }), d, HOJE);
    assert.equal(lista[0].total_pontos, 0);
  });
});

// ---------------------------------------------------------------------------
describe('ordem dos jeitos', () => {
  test('sem milheiro vai para depois de quem tem valor, no empate de pontos', () => {
    const d = dadosCom((x) => { x.cartoes[2].pontos_por_real = 2; });
    const lista = calcular(perfil([], ['cartao-c', 'cartao-a']), compra(10000, { loja_id: 'vazia' }), d, HOJE);
    // Os dois dão 200 pontos; A vale R$ 4,00 e C não tem valor.
    assert.deepEqual(lista.map((j) => j.cartao.id), ['cartao-a', 'cartao-c']);
  });

  test('empate total: oferta antes do caso base', () => {
    const d = dadosCom((x) => { x.ofertas[0].regras = [{ condicao: {}, pontos_por_real: 0 }]; });
    const lista = calcular(perfil(), compra(), d, HOJE);
    assert.deepEqual(lista.map((j) => j.tipo), ['oferta', 'sem_oferta']);
  });

  test('a ordem não depende da ordem dos cartões no perfil', () => {
    const ids = (cartoes) => calcular(perfil([PROG_A], cartoes), compra(), dadosBase(), HOJE).map((j) => `${j.tipo}:${j.cartao.id}`);
    assert.deepEqual(ids(['cartao-a', 'cartao-b', 'cartao-c']), ids(['cartao-c', 'cartao-b', 'cartao-a']));
  });

  test('um centavo também calcula (sem arredondar no meio da conta)', () => {
    const [melhor] = calcular(perfil([PROG_A], ['cartao-a']), compra(1), dadosBase(), HOJE);
    // R$ 0,01 × 5 = 0,05; cartão 0,01 × 2 = 0,02; total 0,07 pontos; valor 0,07 × 2000 ÷ 1000 = 0,14 centavo → R$ 0,00
    assert.equal(melhor.total_pontos, 0.07);
    assert.equal(melhor.total_pontos_texto, '0,07');
    assert.equal(melhor.valor_estimado_em_reais.bilionesimos_de_centavo, 140_000_000n);
    assert.equal(melhor.valor_estimado_em_reais.texto, 'R$ 0,00');
  });
});

// ---------------------------------------------------------------------------
describe('datas', () => {
  test('ano bissexto', () => {
    assert.doesNotThrow(() => lerDataHora('2028-02-29'));
    assert.throws(() => lerDataHora('2026-02-29'), /não existe/);
  });

  test('aceita segundos e recusa hora inexistente', () => {
    assert.equal(lerDataHora('2026-11-10T10:00:30') - lerDataHora('2026-11-10T10:00'), 30_000);
    assert.throws(() => lerDataHora('2026-11-10T10:60'), /não existe/);
    assert.throws(() => lerDataHora(20261110), /data inválida/);
  });

  test('dias entre datas: virada de mês, de ano e para trás', () => {
    assert.equal(diasEntre('2026-11-30', '2026-12-01'), 1);
    assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1);
    assert.equal(diasEntre('2026-11-10', '2026-11-01'), -9);
    assert.equal(diasEntre('2026-11-10T23:59', '2026-11-11T00:01'), 1);
  });

  test('horas garantidas: sem hora conta o fim do dia; com hora, exato', () => {
    assert.equal(horasGarantidasDesde('2026-11-09', '2026-11-10'), 0);
    assert.equal(horasGarantidasDesde('2026-11-09', '2026-11-11T06:00'), 30);
    assert.equal(horasGarantidasDesde('2026-11-09T06:00', '2026-11-10T06:30'), 24.5);
    assert.equal(horasGarantidasDesde('2026-11-10', '2026-11-10'), -24);
  });

  test('temHora', () => {
    assert.equal(temHora('2026-11-10'), false);
    assert.equal(temHora('2026-11-10T08:00'), true);
    assert.equal(temHora(null), false);
  });
});

// ---------------------------------------------------------------------------
describe('formatação (arredonda só aqui)', () => {
  test('centavos: zero, negativo, BigInt e milhar', () => {
    assert.equal(formatarCentavos(0), 'R$ 0,00');
    assert.equal(formatarCentavos(-123456), '-R$ 1.234,56');
    assert.equal(formatarCentavos(100_000_000n), 'R$ 1.000.000,00');
    assert.equal(formatarCentavos(99), 'R$ 0,99');
  });

  test('meio centavo arredonda para cima; um pouco menos, para baixo', () => {
    assert.equal(arredondarParaCentavos(BI / 2n), 1n);
    assert.equal(arredondarParaCentavos(BI / 2n - 1n), 0n);
    assert.equal(formatarValor(149_500_000_000n), 'R$ 1,50');
    assert.equal(formatarValor(149_499_999_999n), 'R$ 1,49');
  });

  test('pontos: até 2 casas, sem zeros à direita', () => {
    assert.equal(formatarPontos(0n), '0');
    assert.equal(formatarPontos(1_000_000n), '1');
    assert.equal(formatarPontos(1_500_000n), '1,5');
    assert.equal(formatarPontos(1_005_000n), '1,01'); // 1,005 → meio para cima
    assert.equal(formatarPontos(1_004_999n), '1');
    assert.equal(formatarPontos(1_234_567_890_000n), '1.234.567,89');
  });

  test('pontos para número', () => {
    assert.equal(pontosParaNumero(6_930_000n), 6.93);
    assert.equal(pontosParaNumero(0n), 0);
  });

  test('pontos por real: singular, plural e decimal com vírgula', () => {
    assert.equal(pontosPorReal(1), '1 ponto por real');
    assert.equal(pontosPorReal(0), '0 pontos por real');
    assert.equal(pontosPorReal(1.5), '1,5 pontos por real');
    assert.equal(formatarNumero(2.25), '2,25');
  });

  test('data no formato brasileiro, com ou sem hora', () => {
    assert.equal(formatarData('2026-01-05'), '05/01/2026');
    assert.equal(formatarData('2026-01-05T08:30'), '05/01/2026');
  });
});

test('oferta repetida nos dados (mesmo id) não quebra a ordem', () => {
  const d = dadosCom((x) => { x.ofertas.push(structuredClone(x.ofertas[0])); });
  const lista = calcular(perfil(), compra(), d, HOJE);
  assert.deepEqual(lista.map((j) => [j.tipo, j.total_pontos]), [['oferta', 500], ['oferta', 500], ['sem_oferta', 0]]);
});
