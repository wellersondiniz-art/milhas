// Testes do abastecimento (tipo de compra "combustível"). Os números esperados
// são calculados à mão nos comentários. Os dados de teste ficam aqui dentro:
// redes e programas fictícios (nada de dado inventado em dados/).
//
// Conta: pontos por real  = pontos_por_real × reais
//        pontos por litro = pontos_por_litro × litros
//        reais = litros × preço; litros = reais ÷ preço (corta para baixo)
//        valor (centavos) = pontos × milheiro (centavos) ÷ 1000
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COMBUSTIVEIS, calcularAbastecimento as abastecer, calcularJeitosDeComprar, formatarLitros, formatarPrecoLitro,
} from '../site/js/motor/index.js';
import { validarDados } from '../scripts/validar-dados.js';

const BI = 1_000_000_000n;
const FONTE = 'https://exemplo.invalid/teste';
const HOJE = '2026-11-10';
const VERIFICADO = '2026-11-05';

function regra(extra) {
  return {
    rede_id: 'rede-litro',
    programa_id: 'prog-litro',
    unidade: 'litro',
    pontos_por_unidade: 2,
    combustiveis: ['gasolina_comum', 'etanol_comum'],
    formas_de_pagamento: ['cpf_no_caixa'],
    inicio: 'sem_data',
    fim: 'sem_data',
    credito_prazo: { dias: 5, tipo: 'corridos' },
    validade_dos_pontos_meses: 12,
    fonte_url: FONTE,
    verificado_em: VERIFICADO,
    ...extra,
  };
}

function dadosDeTeste() {
  const prog = (id, nome, milheiro) => ({ id, nome, tipo: 'pontos', valor_milheiro_brl: milheiro, url: FONTE, fonte_url: FONTE, verificado_em: VERIFICADO });
  const rede = (id, nome) => ({ id, nome, site: FONTE, fonte_url: FONTE, verificado_em: VERIFICADO });
  return {
    programas: [
      prog('prog-litro', 'Programa Litro', 2000), // R$ 20,00 o milheiro
      prog('prog-real', 'Programa Real', 'A_CONFIRMAR'),
      prog('prog-app', 'Programa App', 1000),
      prog('cartao-prog', 'Pontos do Cartão', 1000), // R$ 10,00 o milheiro
    ],
    cartoes: [
      { id: 'cartao-a', nome: 'Cartão A', emissor: 'Banco', bandeira: 'Visa', programa_id: 'cartao-prog', pontos_por_real: 2, anuidade_brl: 0, observacoes: '', fonte_url: FONTE, verificado_em: VERIFICADO, status: 'confirmado' },
    ],
    redes_postos: [rede('rede-litro', 'Rede Litro'), rede('rede-real', 'Rede Real'), rede('rede-app', 'Rede App')],
    regras_postos: [
      regra({ id: 'litro' }),
      regra({ id: 'real', rede_id: 'rede-real', programa_id: 'prog-real', unidade: 'real', pontos_por_unidade: 1, pontua_a_cada: 100, combustiveis: Object.keys(COMBUSTIVEIS), formas_de_pagamento: ['app_meio_a_confirmar', 'cpf_no_caixa'], credito_prazo: { dias: 1, tipo: 'uteis' } }),
      regra({ id: 'app', rede_id: 'rede-app', programa_id: 'prog-app', unidade: 'real', pontos_por_unidade: 0.2, pontua_a_cada: 500, formas_de_pagamento: ['app_meio_a_confirmar'], nome_do_app: 'App Teste' }),
    ],
  };
}

function com(alterar) {
  const d = dadosDeTeste();
  alterar(d);
  return d;
}

const TODOS = { programas: ['prog-litro', 'prog-real', 'prog-app', 'cartao-prog'].map((id) => ({ programa_id: id, clube_ativo: false })), cartoes: ['cartao-a'] };
const SEM_CARTAO = { ...TODOS, cartoes: [] };
const so = (r, id) => r.jeitos.filter((j) => j.regra_id === id);

// ---------------------------------------------------------------------------
// Contas

test('litros com regra por litro: 40 L × 2 pontos = 80 pontos, R$ 1,60 sem precisar do preço', () => {
  const r = abastecer(SEM_CARTAO, { combustivel: 'gasolina_comum', litros_ml: 40_000 }, dadosDeTeste(), HOJE);
  const [j] = so(r, 'litro');
  assert.equal(j.tipo, 'combustivel');
  assert.equal(j.total_pontos, 80);
  assert.equal(j.pontos_do_programa, 80);
  // 80 × 2000 ÷ 1000 = 160 centavos
  assert.equal(j.valor_estimado_em_reais.bilionesimos_de_centavo, 160n * BI);
  assert.equal(j.valor_estimado_em_reais.texto, 'R$ 1,60');
  assert.deepEqual(j.rede, { id: 'rede-litro', nome: 'Rede Litro' });
  assert.deepEqual(j.programa_do_posto, { id: 'prog-litro', nome: 'Programa Litro' });
  assert.equal(j.explicacao[0], 'Abastecimento de 40 litros de gasolina comum.');
  assert.ok(j.explicacao.includes('40 litros × 2 pontos por litro = 80 pontos.'));
  // As regras por real precisam do preço para virar reais.
  assert.deepEqual(r.falta_preco.map((f) => f.regra_id).sort(), ['app', 'real']);
  assert.match(r.falta_preco.find((f) => f.regra_id === 'real').texto, /Para calcular em reais, informe o preço do litro\.$/);
  // Sem reais não há conta de cartão: nenhum jeito "só cartão".
  assert.equal(r.jeitos.length, 1);
});

test('reais com regra por real e bloco de R$ 1,00: R$ 150,60 conta 150 pontos (corta o resto)', () => {
  const r = abastecer(SEM_CARTAO, { combustivel: 'diesel_s500', valor_centavos: 15_060 }, dadosDeTeste(), HOJE);
  const [j] = so(r, 'real');
  assert.equal(j.total_pontos, 150);
  assert.equal(j.valor_estimado_em_reais, null); // milheiro A_CONFIRMAR
  assert.ok(j.explicacao.includes('A regra conta a cada R$ 1,00 completo: R$ 150,60 têm 150 blocos, ou seja R$ 150,00; R$ 150,00 × 1 ponto por real = 150 pontos.'));
  assert.equal(j.prazo_de_credito.texto, 'Os pontos do programa caem na conta em até 1 dia útil, segundo o regulamento.');
  // Diesel S500 não está na regra "litro" (gasolina e etanol).
  assert.deepEqual(r.outro_combustivel.map((o) => o.regra_id), ['litro', 'app']);
  assert.match(r.outro_combustivel[0].texto, /não vale para diesel S500\.$/);
});

test('litros + preço viram reais: 40 L a R$ 6,299 = R$ 251,96', () => {
  const r = abastecer(SEM_CARTAO, { combustivel: 'gasolina_comum', litros_ml: 40_000, preco_litro_milesimos: 6299 }, dadosDeTeste(), HOJE);
  assert.equal(r.abastecimento.reais_texto, 'R$ 251,96');
  assert.equal(r.abastecimento.preco_litro_texto, 'R$ 6,299');
  assert.equal(r.abastecimento.reais_aproximados, false);
  // real: 251 blocos de R$ 1 → 251 pontos; app: 50 blocos de R$ 5 = R$ 250 × 0,2 = 50 pontos
  assert.equal(so(r, 'real')[0].total_pontos, 251);
  assert.equal(so(r, 'app')[0].total_pontos, 50);
  assert.equal(so(r, 'litro')[0].total_pontos, 80);
  assert.equal(r.falta_preco.length, 0);
});

test('reais + preço viram litros: R$ 100,00 a R$ 6,000 = 16,666… L → 33,33 pontos (corta para baixo)', () => {
  const r = abastecer(SEM_CARTAO, { combustivel: 'etanol_comum', valor_centavos: 10_000, preco_litro_milesimos: 6000 }, dadosDeTeste(), HOJE);
  const [j] = so(r, 'litro');
  // 10000 × 10000 ÷ 6000 = 16666,66… mL; × 2 pontos/L = 33,333… pontos (escala 1e6, cortada)
  assert.equal(j.total_pontos, 33.333333);
  assert.equal(j.total_pontos_texto, '33,33');
  assert.equal(r.abastecimento.litros_texto, '16,67 litros');
  assert.equal(r.abastecimento.litros_aproximados, true);
  assert.equal(j.explicacao[0], 'Abastecimento de R$ 100,00 de etanol comum a R$ 6,000 o litro: cerca de 16,67 litros.');
});

test('litros + preço com centavo quebrado: o cartão conta os centavos inteiros (para baixo)', () => {
  // 10,5 L × R$ 5,999 = R$ 62,9895 → cartão conta R$ 62,98 × 2 = 125,96 pontos
  const r = abastecer(TODOS, { combustivel: 'gasolina_comum', litros_ml: 10_500, preco_litro_milesimos: 5999 }, dadosDeTeste(), HOJE);
  const [soCartao] = r.jeitos.filter((j) => j.tipo === 'combustivel_so_cartao');
  assert.equal(soCartao.pontos_do_cartao, 125.96);
  assert.equal(r.abastecimento.reais_texto, 'R$ 62,99');
  assert.equal(r.abastecimento.reais_aproximados, true);
  assert.match(soCartao.explicacao[0], /: cerca de R\$ 62,99\.$/);
});

test('bloco por litro: a cada 1 litro completo, 10,5 L contam 10 L', () => {
  const d = com((x) => { x.regras_postos[0].pontua_a_cada = 1000; });
  const r = abastecer(SEM_CARTAO, { combustivel: 'gasolina_comum', litros_ml: 10_500 }, d, HOJE);
  const [j] = so(r, 'litro');
  assert.equal(j.total_pontos, 20);
  assert.ok(j.explicacao.includes('A regra conta a cada 1 litro completo: 10,5 litros têm 10 blocos, ou seja 10 litros; 10 litros × 2 pontos por litro = 20 pontos.'));
});

test('bloco de um só: "1 bloco" no singular', () => {
  const r = abastecer(SEM_CARTAO, { combustivel: 'gasolina_comum', valor_centavos: 700 }, dadosDeTeste(), HOJE);
  assert.match(so(r, 'app')[0].explicacao.join(' '), /têm 1 bloco, ou seja R\$ 5,00/);
});

test('pontos por litro sem bloco e litro quebrado: 0,5 L × 2 = 1 ponto; "1 litro" no singular', () => {
  const r = abastecer(SEM_CARTAO, { combustivel: 'gasolina_comum', litros_ml: 500 }, dadosDeTeste(), HOJE);
  assert.equal(so(r, 'litro')[0].total_pontos, 1);
  assert.equal(formatarLitros(1000), '1 litro');
  assert.equal(formatarLitros(1), '0 litros');
  assert.equal(formatarPrecoLitro(6299), 'R$ 6,299');
  assert.equal(formatarPrecoLitro(5), 'R$ 0,005');
});

// ---------------------------------------------------------------------------
// Cartão e forma de pagamento

test('regra que aceita cartão (CPF no caixa): soma programa + cartão', () => {
  // R$ 100,00 a R$ 5,000 = 20 L × 2 = 40 pontos Litro (R$ 0,80) + 200 pontos do cartão (R$ 2,00) = R$ 2,80
  const r = abastecer(TODOS, { combustivel: 'gasolina_comum', valor_centavos: 10_000, preco_litro_milesimos: 5000 }, dadosDeTeste(), HOJE);
  const [j] = so(r, 'litro');
  assert.equal(j.cartao.id, 'cartao-a');
  assert.equal(j.pontos_do_programa, 40);
  assert.equal(j.pontos_do_cartao, 200);
  assert.equal(j.total_pontos, 240);
  assert.equal(j.valor_estimado_em_reais.texto, 'R$ 2,80');
  assert.ok(j.condicoes_a_cumprir.includes('Para ganhar os pontos Programa Litro: pagar no caixa ou na maquininha do posto informando o seu CPF.'));
  assert.ok(j.condicoes_a_cumprir.includes('Pagar com o cartão Cartão A.'));
  assert.ok(j.condicoes_a_cumprir.includes('Para somar os pontos do cartão, pague no caixa ou na maquininha com o cartão de crédito.'));
  assert.ok(j.explicacao.includes('Somando: 40 pontos Programa Litro + 200 pontos do cartão = 240 pontos.'));
});

test('regra só pelo app, sem confirmação de cartão: não soma o cartão e avisa', () => {
  const r = abastecer(TODOS, { combustivel: 'gasolina_comum', valor_centavos: 10_000 }, dadosDeTeste(), HOJE);
  const [j] = so(r, 'app');
  assert.equal(j.cartao, null);
  assert.equal(j.pontos_do_cartao, 0);
  assert.equal(j.total_pontos, 20); // 20 blocos × R$ 5 = R$ 100 × 0,2
  assert.ok(j.avisos.includes('Não está confirmado se dá para pagar com cartão de crédito pelo app App Teste; por isso não somamos os pontos do seu cartão aqui.'));
  assert.ok(j.condicoes_a_cumprir.includes('Para ganhar os pontos Programa App: pagar pelo app App Teste.'));
});

test('app com cartão cadastrado e Pix: soma o cartão; textos de cada forma', () => {
  const d = com((x) => { x.regras_postos[2].formas_de_pagamento = ['app_cartao_cadastrado', 'app_pix']; delete x.regras_postos[2].nome_do_app; });
  const r = abastecer(TODOS, { combustivel: 'gasolina_comum', valor_centavos: 10_000 }, d, HOJE);
  const [j] = so(r, 'app');
  assert.equal(j.pontos_do_cartao, 200);
  assert.ok(j.condicoes_a_cumprir.includes('Para ganhar os pontos Programa App: pagar pelo app do posto com um cartão de crédito cadastrado nele ou pagar pelo app do posto com Pix.'));
  assert.ok(!j.condicoes_a_cumprir.some((c) => c.startsWith('Para somar')));
});

test('só Pix pelo app: sem cartão, com aviso próprio', () => {
  const d = com((x) => { x.regras_postos[2].formas_de_pagamento = ['app_pix']; });
  const [j] = so(abastecer(TODOS, { combustivel: 'gasolina_comum', valor_centavos: 10_000 }, d, HOJE), 'app');
  assert.ok(j.avisos.includes('Não está confirmado se dá para pagar com cartão de crédito neste jeito; por isso não somamos os pontos do seu cartão aqui.'));
});

test('forma de pagamento A_CONFIRMAR: conta o programa, sem cartão, com aviso', () => {
  const d = com((x) => { x.regras_postos[0].formas_de_pagamento = 'A_CONFIRMAR'; });
  const [j] = so(abastecer(TODOS, { combustivel: 'gasolina_comum', valor_centavos: 10_000, preco_litro_milesimos: 5000 }, d, HOJE), 'litro');
  assert.equal(j.cartao, null);
  assert.equal(j.total_pontos, 40);
  assert.ok(j.avisos.includes('Não está confirmado como pagar para ganhar os pontos Programa Litro; confira no app.'));
  assert.ok(j.avisos.includes('Não está confirmado como pagar; por isso não somamos os pontos do seu cartão aqui.'));
});

test('litros sem preço com cartão no perfil: avisa que o cartão fica de fora', () => {
  const [j] = so(abastecer(TODOS, { combustivel: 'gasolina_comum', litros_ml: 40_000 }, dadosDeTeste(), HOJE), 'litro');
  assert.equal(j.cartao, null);
  assert.ok(j.avisos.includes('Sem o preço do litro não dá para saber quanto você vai pagar, então os pontos do cartão ficam de fora.'));
});

test('"só cartão": vale em qualquer posto, ou na rede escolhida', () => {
  const qualquer = abastecer(TODOS, { combustivel: 'gnv', valor_centavos: 5000 }, dadosDeTeste(), HOJE);
  const [j] = qualquer.jeitos.filter((x) => x.tipo === 'combustivel_so_cartao');
  assert.equal(j.rede, null);
  assert.equal(j.total_pontos, 100); // R$ 50 × 2
  assert.equal(j.validade_da_regra, null);
  assert.equal(j.explicacao[1], 'Sem programa do posto: só os pontos do cartão, em qualquer posto.');
  const naRede = abastecer(TODOS, { combustivel: 'gnv', valor_centavos: 5000, rede_id: 'rede-real' }, dadosDeTeste(), HOJE);
  const [k] = naRede.jeitos.filter((x) => x.tipo === 'combustivel_so_cartao');
  assert.deepEqual(k.rede, { id: 'rede-real', nome: 'Rede Real' });
  assert.equal(k.explicacao[1], 'Sem programa do posto: só os pontos do cartão, nos postos Rede Real.');
  // Sem cartão nenhum: um jeito de 0 ponto, para a tela explicar.
  const zero = abastecer(SEM_CARTAO, { combustivel: 'gnv', valor_centavos: 5000, rede_id: 'rede-litro' }, dadosDeTeste(), HOJE);
  const [z] = zero.jeitos.filter((x) => x.tipo === 'combustivel_so_cartao');
  assert.equal(z.total_pontos, 0);
  assert.equal(z.prazo_de_credito, null);
});

// ---------------------------------------------------------------------------
// O que fica fora do ranking

test('programa fora do perfil: não entra no ranking, vira "se você participasse"', () => {
  const perfil = { programas: [{ programa_id: 'prog-real', clube_ativo: false }], cartoes: [] };
  const r = abastecer(perfil, { combustivel: 'gasolina_comum', litros_ml: 40_000, preco_litro_milesimos: 5000 }, dadosDeTeste(), HOJE);
  assert.deepEqual(r.jeitos.map((j) => j.regra_id), ['real', null]);
  // litro: 80 pontos; app: R$ 200 → 40 blocos × 5 × 0,2 = 40 pontos. Ordem: mais pontos primeiro.
  assert.deepEqual(r.fora_do_perfil.map((f) => [f.regra_id, f.total_pontos]), [['litro', 80], ['app', 40]]);
  assert.equal(r.fora_do_perfil[0].texto, 'Se você participasse do Programa Litro e abastecesse nos postos Rede Litro, ganharia 80 pontos Programa Litro neste abastecimento.');
});

test('fora do perfil com 0 ponto não aparece; empate em pontos desempata pelo id', () => {
  const perfil = { programas: [], cartoes: [] };
  const zero = abastecer(perfil, { combustivel: 'gasolina_comum', valor_centavos: 400 }, dadosDeTeste(), HOJE);
  assert.ok(!zero.fora_do_perfil.some((f) => f.regra_id === 'app')); // R$ 4 não completa R$ 5
  const d = com((x) => { x.regras_postos.push(regra({ id: 'aa-litro', rede_id: 'rede-real' })); });
  const r = abastecer(perfil, { combustivel: 'gasolina_comum', litros_ml: 1000 }, d, HOJE);
  assert.deepEqual(r.fora_do_perfil.map((f) => f.regra_id), ['aa-litro', 'litro']);
});

test('pontos, unidade ou status A_CONFIRMAR: regra sai do cálculo e vai para "a confirmar"', () => {
  for (const mudar of [{ pontos_por_unidade: 'A_CONFIRMAR' }, { unidade: 'A_CONFIRMAR' }, { status: 'A_CONFIRMAR' }]) {
    const d = com((x) => Object.assign(x.regras_postos[0], mudar));
    const r = abastecer(TODOS, { combustivel: 'gasolina_comum', litros_ml: 40_000 }, d, HOJE);
    assert.equal(so(r, 'litro').length, 0, JSON.stringify(mudar));
    assert.deepEqual(r.a_confirmar.map((a) => a.regra_id), ['litro']);
    assert.equal(r.a_confirmar[0].texto, 'Programa Litro nos postos Rede Litro: ainda não confirmamos quantos pontos dá por abastecimento (conferido em 05/11/2026).');
    assert.equal(r.a_confirmar[0].fonte_url, FONTE);
  }
});

test('combustíveis A_CONFIRMAR: a regra entra, com aviso', () => {
  const d = com((x) => { x.regras_postos[0].combustiveis = 'A_CONFIRMAR'; });
  const [j] = so(abastecer(SEM_CARTAO, { combustivel: 'gnv', litros_ml: 10_000 }, d, HOJE), 'litro');
  assert.equal(j.total_pontos, 20);
  assert.ok(j.avisos.includes('Não está confirmado quais combustíveis pontuam no Programa Litro; confira no app antes de abastecer.'));
});

test('filtro de rede: só as regras da rede escolhida', () => {
  const r = abastecer(SEM_CARTAO, { combustivel: 'gasolina_comum', litros_ml: 40_000, preco_litro_milesimos: 5000, rede_id: 'rede-app' }, dadosDeTeste(), HOJE);
  assert.deepEqual(r.jeitos.map((j) => j.regra_id), ['app', null]);
  assert.deepEqual(r.fora_do_perfil, []);
});

test('regra com rede que não existe nos dados é ignorada', () => {
  const d = com((x) => { x.regras_postos[0].rede_id = 'sumiu'; });
  assert.equal(so(abastecer(SEM_CARTAO, { combustivel: 'gasolina_comum', litros_ml: 1000 }, d, HOJE), 'litro').length, 0);
});

// ---------------------------------------------------------------------------
// Datas

test('validade: regra futura e vencida ficam de fora; perto do fim ganha aviso', () => {
  const ab = { combustivel: 'gasolina_comum', litros_ml: 1000 };
  const futura = com((x) => Object.assign(x.regras_postos[0], { inicio: '2026-11-11', fim: '2026-12-31' }));
  assert.equal(so(abastecer(SEM_CARTAO, ab, futura, HOJE), 'litro').length, 0);
  const vencida = com((x) => Object.assign(x.regras_postos[0], { inicio: '2026-10-01', fim: '2026-11-09' }));
  assert.equal(so(abastecer(SEM_CARTAO, ab, vencida, HOJE), 'litro').length, 0);
  for (const [fim, quando] of [['2026-11-10', 'hoje'], ['2026-11-11', 'amanhã'], ['2026-11-17', 'em 7 dias']]) {
    const d = com((x) => Object.assign(x.regras_postos[0], { inicio: '2026-11-01', fim }));
    const [j] = so(abastecer(SEM_CARTAO, ab, d, HOJE), 'litro');
    assert.ok(j.avisos.some((a) => a.startsWith(`Esta regra vence ${quando}`)), fim);
    assert.match(j.validade_da_regra.texto, /^De 01\/11\/2026 até/);
  }
  const longe = com((x) => Object.assign(x.regras_postos[0], { inicio: '2026-11-01', fim: '2026-11-18' }));
  assert.ok(!so(abastecer(SEM_CARTAO, ab, longe, HOJE), 'litro')[0].avisos.some((a) => a.startsWith('Esta regra vence')));
});

test('validade: textos de sem_data e A_CONFIRMAR', () => {
  const ab = { combustivel: 'gasolina_comum', litros_ml: 1000 };
  const [fixa] = so(abastecer(SEM_CARTAO, ab, dadosDeTeste(), HOJE), 'litro');
  assert.equal(fixa.validade_da_regra.texto, 'Regra fixa do programa: o regulamento não traz data para acabar.');
  const casos = [
    [{ inicio: 'A_CONFIRMAR', fim: 'A_CONFIRMAR' }, 'Início não confirmado, fim não confirmado.'],
    [{ inicio: 'sem_data', fim: '2026-12-31' }, 'Sem data de início até 31/12/2026.'],
    [{ inicio: '2026-11-01', fim: 'sem_data' }, 'De 01/11/2026, sem data para acabar.'],
  ];
  for (const [mudar, texto] of casos) {
    const [j] = so(abastecer(SEM_CARTAO, ab, com((x) => Object.assign(x.regras_postos[0], mudar)), HOJE), 'litro');
    assert.equal(j.validade_da_regra.texto, texto);
  }
  const [aconf] = so(abastecer(SEM_CARTAO, ab, com((x) => Object.assign(x.regras_postos[0], { inicio: 'A_CONFIRMAR', fim: 'A_CONFIRMAR' })), HOJE), 'litro');
  assert.ok(aconf.avisos.includes('A data de início desta regra não está confirmada.'));
  assert.ok(aconf.avisos.includes('A data de fim desta regra não está confirmada; confira no app antes de abastecer.'));
});

test('prazo de crédito e validade dos pontos', () => {
  const ab = { combustivel: 'gasolina_comum', litros_ml: 1000 };
  const casos = [
    [{ credito_prazo: { dias: 5, tipo: 'corridos' }, validade_dos_pontos_meses: 12 }, 'Os pontos do programa caem na conta em até 5 dias, segundo o regulamento.', 'Os pontos valem 12 meses depois de creditados.'],
    [{ credito_prazo: { dias: 2, tipo: 'uteis' }, validade_dos_pontos_meses: 1 }, 'Os pontos do programa caem na conta em até 2 dias úteis, segundo o regulamento.', 'Os pontos valem 1 mês depois de creditados.'],
    [{ credito_prazo: { dias: 1, tipo: 'corridos' }, validade_dos_pontos_meses: 'A_CONFIRMAR' }, 'Os pontos do programa caem na conta em até 1 dia, segundo o regulamento.', 'Validade dos pontos não confirmada.'],
    [{ credito_prazo: 'A_CONFIRMAR' }, 'Prazo para os pontos caírem na conta não confirmado.', 'Os pontos valem 12 meses depois de creditados.'],
  ];
  for (const [mudar, prazo, validade] of casos) {
    const [j] = so(abastecer(SEM_CARTAO, ab, com((x) => Object.assign(x.regras_postos[0], mudar)), HOJE), 'litro');
    assert.equal(j.prazo_de_credito.texto, prazo);
    assert.equal(j.validade_dos_pontos.texto, validade);
  }
});

test('dado conferido há mais de 14 dias ganha aviso e selo', () => {
  const d = com((x) => { x.regras_postos[0].verificado_em = '2026-10-01'; });
  const [j] = so(abastecer(SEM_CARTAO, { combustivel: 'gasolina_comum', litros_ml: 1000 }, d, HOJE), 'litro');
  assert.equal(j.tem_dado_antigo, true);
  assert.ok(j.avisos.includes('Dado verificado há mais de 14 dias (40 dias): regra Programa Litro nos postos Rede Litro.'));
  assert.deepEqual(j.conferido_em.map((c) => c.rotulo), ['regra Programa Litro nos postos Rede Litro', 'valor do milheiro Programa Litro', 'programa Programa Litro', 'rede Rede Litro']);
});

// ---------------------------------------------------------------------------
// Ordem, formato e compatibilidade

test('ordem: mais pontos primeiro; empate → com valor em reais; depois programa antes de "só cartão"', () => {
  const r = abastecer(TODOS, { combustivel: 'gasolina_comum', valor_centavos: 10_000, preco_litro_milesimos: 5000 }, dadosDeTeste(), HOJE);
  // real: 100 + 200 = 300 (sem valor); litro: 40 + 200 = 240; só cartão: 200; app: 20
  assert.deepEqual(r.jeitos.map((j) => [j.regra_id, j.total_pontos]), [['real', 300], ['litro', 240], [null, 200], ['app', 20]]);
  // Empate em pontos: quem tem valor em reais vem antes.
  const empate = com((x) => { x.regras_postos[0].pontos_por_unidade = 5; }); // 20 L × 5 = 100 + 200 = 300
  const e = abastecer(TODOS, { combustivel: 'gasolina_comum', valor_centavos: 10_000, preco_litro_milesimos: 5000 }, empate, HOJE);
  assert.deepEqual(e.jeitos.slice(0, 2).map((j) => j.regra_id), ['litro', 'real']);
});

test('ordem: empate total desempata por tipo e depois por rede, programa e regra', () => {
  const d = com((x) => {
    x.regras_postos = [regra({ id: 'b', rede_id: 'rede-real', pontos_por_unidade: 0 }), regra({ id: 'a', pontos_por_unidade: 0 }), regra({ id: 'c', pontos_por_unidade: 0 })];
  });
  const r = abastecer(SEM_CARTAO, { combustivel: 'gasolina_comum', valor_centavos: 1000, preco_litro_milesimos: 5000 }, d, HOJE);
  assert.deepEqual(r.jeitos.map((j) => j.regra_id), ['a', 'c', 'b', null]);
});

test('saída tem o formato dos jeitos de comprar e é sempre igual para a mesma entrada', () => {
  const ab = { combustivel: 'gasolina_comum', litros_ml: 40_000, preco_litro_milesimos: 6299 };
  const a = abastecer(TODOS, ab, dadosDeTeste(), HOJE);
  const b = abastecer(TODOS, ab, dadosDeTeste(), HOJE);
  assert.deepEqual(a, b);
  for (const j of a.jeitos) {
    for (const campo of ['tipo', 'programa', 'cartao', 'total_pontos', 'total_pontos_texto', 'valor_estimado_em_reais', 'condicoes_a_cumprir', 'avisos', 'conferido_em', 'tem_dado_antigo', 'o_que_voce_ganharia_se', 'explicacao']) {
      assert.ok(campo in j, campo);
    }
    assert.deepEqual(j.combustivel, { id: 'gasolina_comum', nome: 'Gasolina comum' });
  }
});

test('calcularJeitosDeComprar aceita o tipo "combustivel" e devolve a mesma lista', () => {
  const ab = { tipo: 'combustivel', combustivel: 'gasolina_comum', litros_ml: 40_000 };
  assert.deepEqual(calcularJeitosDeComprar(SEM_CARTAO, ab, dadosDeTeste(), HOJE), abastecer(SEM_CARTAO, ab, dadosDeTeste(), HOJE).jeitos);
});

test('calcularJeitosDeComprar: compra em loja com tipo "loja" continua igual; tipo desconhecido é erro', () => {
  const dados = { ...dadosDeTeste(), lojas: [{ id: 'loja', nome: 'Loja', fonte_url: FONTE, verificado_em: VERIFICADO }], ofertas: [] };
  const compra = { loja_id: 'loja', valor_centavos: 10_000, tipo_vendedor: 'loja' };
  assert.deepEqual(calcularJeitosDeComprar(TODOS, { ...compra, tipo: 'loja' }, dados, HOJE), calcularJeitosDeComprar(TODOS, compra, dados, HOJE));
  assert.throws(() => calcularJeitosDeComprar(TODOS, { ...compra, tipo: 'mercado' }, dados, HOJE), /tipo de compra precisa ser "loja" ou "combustivel"/);
});

// ---------------------------------------------------------------------------
// Entrada inválida

test('entrada inválida dá erro claro', () => {
  const d = dadosDeTeste();
  const ok = { combustivel: 'gasolina_comum', litros_ml: 1000 };
  const casos = [
    [TODOS, null, d, /abastecimento precisa ser um objeto/],
    [TODOS, { ...ok, tipo: 'loja' }, d, /tipo precisa ser "combustivel"/],
    [TODOS, { ...ok, combustivel: 'querosene' }, d, /combustivel precisa ser um de/],
    [TODOS, { ...ok, rede_id: 7 }, d, /rede_id precisa ser texto/],
    [TODOS, { ...ok, rede_id: 'nao-existe' }, d, /rede "nao-existe" não existe/],
    [TODOS, { combustivel: 'gnv' }, d, /litros_ml OU valor_centavos/],
    [TODOS, { ...ok, valor_centavos: 100 }, d, /litros_ml OU valor_centavos/],
    [TODOS, { ...ok, litros_ml: 0 }, d, /litros_ml precisa ser um inteiro/],
    [TODOS, { ...ok, litros_ml: 1.5 }, d, /litros_ml precisa ser um inteiro/],
    [TODOS, { ...ok, litros_ml: 99_999_001 }, d, /litros_ml precisa ser um inteiro entre 1 e 99999000/],
    [TODOS, { combustivel: 'gnv', valor_centavos: -1 }, d, /valor_centavos precisa ser um inteiro/],
    [TODOS, { ...ok, preco_litro_milesimos: 0 }, d, /preco_litro_milesimos precisa ser um inteiro/],
    [TODOS, { ...ok, preco_litro_milesimos: 100_000 }, d, /preco_litro_milesimos precisa ser um inteiro/],
    [{ programas: [] }, ok, d, /perfil precisa de "programas" e "cartoes"/],
    [TODOS, ok, { ...d, regras_postos: undefined }, /dados.regras_postos precisa ser uma lista/],
    [TODOS, ok, { ...d, cambio: {} }, /dados.cambio precisa ser uma lista/],
  ];
  for (const [perfil, ab, dados, msg] of casos) assert.throws(() => abastecer(perfil, ab, dados, HOJE), msg, JSON.stringify(ab));
  assert.throws(() => abastecer(TODOS, ok, d, '10/11/2026'));
  const fina = com((x) => { x.regras_postos[0].pontos_por_unidade = 0.00001; });
  assert.throws(() => abastecer(TODOS, ok, fina, HOJE), /mais de 4 casas decimais/);
});

test('entrada aceita rede_id null e preço null como "não informado"', () => {
  const r = abastecer(SEM_CARTAO, { combustivel: 'gasolina_comum', litros_ml: 1000, rede_id: null, preco_litro_milesimos: null, valor_centavos: null }, dadosDeTeste(), HOJE);
  assert.equal(r.abastecimento.preco_litro_texto, null);
  assert.equal(r.abastecimento.reais_texto, null);
});

// ---------------------------------------------------------------------------
// Dados reais (dados/): conta com as regras oficiais cadastradas

test('dados reais: 40 L de gasolina comum a R$ 6,299 nas regras cadastradas', async () => {
  const pasta = new URL('../dados/', import.meta.url);
  const ler = async (n) => JSON.parse(await readFile(new URL(`${n}.json`, pasta), 'utf8'));
  const dados = {
    programas: await ler('programas'), cartoes: await ler('cartoes'), cambio: await ler('cambio'),
    redes_postos: await ler('redes-postos'), regras_postos: await ler('regras-postos'),
  };
  assert.deepEqual((await validarDados(pasta, { hoje: '2026-11-23' })).erros, []);
  const perfil = { programas: dados.programas.map((p) => ({ programa_id: p.id, clube_ativo: false })), cartoes: [] };
  const r = abastecer(perfil, { combustivel: 'gasolina_comum', litros_ml: 40_000, preco_litro_milesimos: 6299 }, dados, '2026-11-23');
  // Premmia: R$ 251,96 → 251 reais inteiros × 1 = 251; Shell Box Clube: 50 blocos de R$ 5 × 1 stix = 50.
  assert.deepEqual(r.jeitos.map((j) => [j.regra_id, j.total_pontos]), [['petrobras-premmia', 251], ['shell-box-clube-comum', 50], [null, 0]]);
  // V-Power vale 2 stix a cada R$ 5,00.
  const vp = abastecer(perfil, { combustivel: 'gasolina_aditivada', valor_centavos: 20_000 }, dados, '2026-11-23');
  assert.equal(vp.jeitos.find((j) => j.regra_id === 'shell-box-clube-v-power').total_pontos, 80);
  // KMV fica fora do cálculo até alguém confirmar os pontos.
  assert.deepEqual(r.a_confirmar.map((a) => a.regra_id), ['ipiranga-km-de-vantagens']);
});

test('cartão que não soma ponto não repete o jeito; se nenhum soma, fica um só', () => {
  const d = com((x) => {
    x.cartoes.push({ ...x.cartoes[0], id: 'cartao-b', nome: 'Cartão B', pontos_por_real: 'A_CONFIRMAR', status: 'A_CONFIRMAR' });
    x.cartoes.push({ ...x.cartoes[0], id: 'cartao-c', nome: 'Cartão C', pontos_por_real: 'A_CONFIRMAR', status: 'A_CONFIRMAR' });
  });
  const ab = { combustivel: 'gasolina_comum', valor_centavos: 10_000, preco_litro_milesimos: 5000 };
  const r = abastecer({ ...TODOS, cartoes: ['cartao-a', 'cartao-b', 'cartao-c'] }, ab, d, HOJE);
  assert.deepEqual(so(r, 'litro').map((j) => j.cartao.id), ['cartao-a']);
  assert.deepEqual(r.jeitos.filter((j) => j.tipo === 'combustivel_so_cartao').map((j) => j.cartao.id), ['cartao-a']);
  const semPontos = abastecer({ ...TODOS, cartoes: ['cartao-b', 'cartao-c'] }, ab, d, HOJE);
  assert.deepEqual(so(semPontos, 'litro').map((j) => j.cartao.id), ['cartao-b']);
  assert.ok(so(semPontos, 'litro')[0].avisos.some((a) => /não estão confirmados/.test(a)));
});
