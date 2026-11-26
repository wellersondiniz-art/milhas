// Testes da decisão final (site/js/motor/decisao.js): pontos x cashback x
// desconto e "a anuidade compensa?". Contas feitas à mão nos comentários.
// Valores em bilionésimos de centavo: R$ 1,00 = 100 × 10^9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularAnuidade, compararComDinheiro, formatarPorcento } from '../site/js/motor/index.js';

const BI = 1_000_000_000n;
const PT = 1_000_000n; // escala dos pontos
const reais = (centavos) => BigInt(centavos) * BI;

// ---------------------------------------------------------------------------
// Porcentagem

test('porcentagem: até 2 casas, sem zero sobrando', () => {
  assert.equal(formatarPorcento(500), '5%');
  assert.equal(formatarPorcento(525), '5,25%');
  assert.equal(formatarPorcento(550), '5,5%');
  assert.equal(formatarPorcento(5), '0,05%');
  assert.equal(formatarPorcento(10000), '100%');
});

// ---------------------------------------------------------------------------
// Pontos x cashback x desconto

// Compra de R$ 1.000,00; 5.000 pontos a R$ 17,00 o milheiro = R$ 85,00.
const BASE = { valor_compra_centavos: 100000, pontos_escalados: 5000n * PT, valor_pontos: 5000n * PT * 1700n };

test('pontos ganham do cashback e o milheiro de empate aparece', () => {
  // Cashback 5% de R$ 1.000 = R$ 50,00. Empate: R$ 50 ÷ 5.000 × 1.000 = R$ 10,00.
  const r = compararComDinheiro({ ...BASE, cashback_porcento: 500 });
  assert.equal(r.vencedor, 'pontos');
  assert.equal(r.opcoes[0].tipo, 'pontos');
  assert.equal(r.opcoes[1].valor, reais(5000));
  assert.equal(r.milheiro_de_empate_centavos, 1000);
  assert.match(r.veredito, /^Os pontos valem mais: uns R\$ 85,00 contra R\$ 50,00\. Mas só se você usar 1\.000 pontos por mais de R\$ 10,00; abaixo disso, o cashback de 5% rende mais\.$/);
});

test('desconto em porcentagem ganha dos pontos', () => {
  // 10% de R$ 1.000 = R$ 100,00 > R$ 85,00. Empate: 100 ÷ 5 = R$ 20,00 o milheiro.
  const r = compararComDinheiro({ ...BASE, cashback_porcento: 500, desconto_porcento: 1000 });
  assert.equal(r.vencedor, 'desconto');
  assert.deepEqual(r.opcoes.map((o) => o.tipo), ['desconto', 'pontos', 'cashback']);
  assert.equal(r.milheiro_de_empate_centavos, 2000);
  assert.match(r.veredito, /^O desconto de 10% rende mais: R\$ 100,00 contra uns R\$ 85,00 em pontos\. Os pontos só ganhariam se 1\.000 pontos valessem mais que R\$ 20,00\.$/);
});

test('desconto em reais', () => {
  const r = compararComDinheiro({ ...BASE, desconto_centavos: 8500 });
  assert.equal(r.empate, true);
  assert.equal(r.vencedor, null);
  assert.match(r.veredito, /^Empate/);
  // Empate: dinheiro certo vem antes na lista.
  assert.equal(r.opcoes[0].tipo, 'desconto');
  assert.equal(r.opcoes[0].rotulo, 'Desconto de R$ 85,00');
});

test('sem milheiro: não inventa o valor, mas diz a partir de quanto os pontos ganham', () => {
  const r = compararComDinheiro({ ...BASE, valor_pontos: null, desconto_centavos: 5000 });
  assert.equal(r.vencedor, null);
  assert.equal(r.opcoes.at(-1).valor, null);
  assert.equal(r.milheiro_de_empate_centavos, 1000);
  assert.match(r.veredito, /^Não sabemos quanto valem esses pontos\. Eles só ganham do desconto \(R\$ 50,00\) se 1\.000 pontos valerem mais que R\$ 10,00\.$/);
});

test('sem pontos, o dinheiro vence; sem alternativa, pede uma', () => {
  const zero = compararComDinheiro({ valor_compra_centavos: 100000, pontos_escalados: 0n, valor_pontos: 0n, cashback_porcento: 100 });
  assert.equal(zero.vencedor, 'cashback');
  assert.equal(zero.milheiro_de_empate_centavos, null);
  assert.match(zero.veredito, /^Esta compra não rende pontos: fique com o cashback de 1% \(R\$ 10,00\)\.$/);
  const nada = compararComDinheiro({ ...BASE, cashback_porcento: 0, desconto_porcento: 0 });
  assert.equal(nada.opcoes.length, 1);
  assert.match(nada.veredito, /^Informe um cashback ou um desconto/);
});

test('milheiro de empate arredonda para cima (o centavo a mais garante que os pontos ganham)', () => {
  // R$ 10,00 ÷ 3 pontos × 1.000 = R$ 3.333,333… → R$ 3.333,34
  const r = compararComDinheiro({ valor_compra_centavos: 100000, pontos_escalados: 3n * PT, valor_pontos: null, desconto_centavos: 1000 });
  assert.equal(r.milheiro_de_empate_centavos, 333334);
});

test('cashback com centavos de porcentagem é exato', () => {
  // 1,25% de R$ 0,99 = 1,2375 centavo
  const r = compararComDinheiro({ valor_compra_centavos: 99, pontos_escalados: 0n, valor_pontos: 0n, cashback_porcento: 125 });
  assert.equal(r.opcoes.find((o) => o.tipo === 'cashback').valor, 1_237_500_000n);
});

test('entrada inválida é recusada', () => {
  assert.throws(() => compararComDinheiro({ ...BASE, valor_compra_centavos: 10.5 }), /centavos inteiros/);
  assert.throws(() => compararComDinheiro({ ...BASE, pontos_escalados: 5 }), /BigInt/);
  assert.throws(() => compararComDinheiro({ ...BASE, valor_pontos: 5 }), /valor_pontos/);
  assert.throws(() => compararComDinheiro({ ...BASE, cashback_porcento: 10001 }), /0 a 10000/);
  assert.throws(() => compararComDinheiro({ ...BASE, desconto_porcento: 1.5 }), /inteiro/);
  assert.throws(() => compararComDinheiro({ ...BASE, desconto_centavos: 100001 }), /maior que a compra/);
});

// ---------------------------------------------------------------------------
// Anuidade

const porReal = { id: 'c1', nome: 'Cartão Real', programa_id: 'p', pontos_por_real: 2, anuidade_brl: 60000, status: 'confirmado' };
const porDolar = { id: 'c2', nome: 'Cartão Dólar', programa_id: 'p', pontos_por_real: 'A_CONFIRMAR', pontos_por_dolar: 3, anuidade_brl: 135600, status: 'confirmado' };

test('anuidade: compensa, com conta passo a passo', () => {
  // R$ 2.000/mês → R$ 24.000/ano × 2 = 48.000 pontos × R$ 20,00 ÷ 1.000 = R$ 960,00.
  // Saldo: 960 − 600 = R$ 360,00. Empate: 600 ÷ 12 ÷ (2 × 0,02) = R$ 1.250,00/mês.
  const r = calcularAnuidade({ cartao: porReal, gasto_mensal_centavos: 200000, milheiro: { centavos: 2000 } });
  assert.equal(r.situacao, 'compensa');
  assert.equal(r.pontos_por_ano.escalados, 48000n * PT);
  assert.equal(r.valor_dos_pontos.bilionesimos_de_centavo, reais(96000));
  assert.equal(r.saldo.bilionesimos_de_centavo, reais(36000));
  assert.equal(r.saldo.negativo, false);
  assert.equal(r.gasto_mensal_de_empate_centavos, 125000);
  assert.equal(r.veredito, 'Compensa: sobram uns R$ 360,00 por ano depois de pagar a anuidade. Passa a compensar com um gasto a partir de R$ 1.250,00 por mês.');
  assert.deepEqual(r.explicacao, [
    'Gasto no ano: R$ 2.000,00 por mês × 12 = R$ 24.000,00.',
    'Pontos no ano: R$ 24.000,00 × 2 ponto(s) por real = 48.000 pontos.',
    'Valor dos pontos: 48.000 × R$ 20,00 por milheiro (estimativa) ÷ 1.000 = R$ 960,00.',
    'Anuidade: R$ 600,00 por ano.',
  ]);
});

test('anuidade: não compensa, e o cashback de outro cartão entra na conta', () => {
  // R$ 1.000/mês → 24.000 pontos → R$ 480,00. Cashback 1% de R$ 12.000 = R$ 120,00.
  // Saldo: 480 − 600 − 120 = −R$ 240,00. Empate: 600 ÷ 12 ÷ (0,04 − 0,01) = R$ 1.666,666… → R$ 1.666,67.
  const r = calcularAnuidade({ cartao: porReal, gasto_mensal_centavos: 100000, milheiro: { centavos: 2000, doPerfil: true }, cashback_alternativo_porcento: 100 });
  assert.equal(r.situacao, 'nao_compensa');
  assert.equal(r.saldo.negativo, true);
  assert.equal(r.saldo.texto, 'R$ 240,00');
  assert.equal(r.cashback_alternativo.texto, 'R$ 120,00');
  assert.equal(r.gasto_mensal_de_empate_centavos, 166667);
  assert.match(r.veredito, /^Não compensa: faltam uns R\$ 240,00 por ano para os pontos pagarem a anuidade e o cashback que você deixaria de ganhar\./);
  assert.ok(r.explicacao.some((p) => p.includes('(valor que você informou)')));
  assert.ok(r.explicacao.some((p) => p.startsWith('Um cartão sem anuidade com 1% de cashback')));
});

test('anuidade: empata exatamente', () => {
  const r = calcularAnuidade({ cartao: porReal, gasto_mensal_centavos: 125000, milheiro: { centavos: 2000 } });
  assert.equal(r.situacao, 'empata');
  assert.match(r.veredito, /^Empata/);
});

test('anuidade: cartão por dólar usa a cotação', () => {
  // R$ 5.000/mês → R$ 60.000 ÷ R$ 5,00 = 12.000 dólares × 3 = 36.000 pontos × R$ 17 = R$ 612,00.
  const r = calcularAnuidade({ cartao: porDolar, gasto_mensal_centavos: 500000, milheiro: { centavos: 1700 }, cotacao: 50000 });
  assert.equal(r.pontos_por_ano.escalados, 36000n * PT);
  assert.equal(r.valor_dos_pontos.texto, 'R$ 612,00');
  assert.equal(r.situacao, 'nao_compensa');
  // Empate: 1.356 ÷ 12 ÷ (3 ÷ 5 × 0,017) = R$ 11.078,431… → R$ 11.078,44
  assert.equal(r.gasto_mensal_de_empate_centavos, 1107844);
  assert.ok(r.explicacao[1].includes('÷ R$ 5,0000 por dólar × 3 ponto(s) por dólar'));
});

test('anuidade: sem cotação, sem milheiro ou sem anuidade não vira número inventado', () => {
  const semCot = calcularAnuidade({ cartao: porDolar, gasto_mensal_centavos: 500000, milheiro: { centavos: 1700 } });
  assert.equal(semCot.pontos_por_ano, null);
  assert.equal(semCot.situacao, 'sem_conta');
  assert.ok(semCot.avisos.some((a) => a.includes('falta a cotação do dólar')));

  const semMilheiro = calcularAnuidade({ cartao: porReal, gasto_mensal_centavos: 100000, milheiro: null });
  assert.equal(semMilheiro.pontos_por_ano.texto, '24.000');
  assert.equal(semMilheiro.valor_dos_pontos, null);
  assert.equal(semMilheiro.gasto_mensal_de_empate_centavos, null);
  assert.equal(semMilheiro.veredito, 'O cartão renderia 24.000 pontos por ano. Sem o valor dos pontos confirmado, não dá para dizer se compensa.');

  const semAnuidade = calcularAnuidade({ cartao: { ...porReal, anuidade_brl: 'A_CONFIRMAR' }, gasto_mensal_centavos: 100000, milheiro: { centavos: 2000 } });
  assert.equal(semAnuidade.anuidade_centavos, null);
  assert.match(semAnuidade.veredito, /Sem a anuidade confirmada, não dá/);
  assert.ok(semAnuidade.avisos.some((a) => a.includes('anuidade do cartão Cartão Real não está confirmada')));

  const naoConfirmado = calcularAnuidade({ cartao: { ...porReal, status: 'A_CONFIRMAR' }, gasto_mensal_centavos: 100000, milheiro: { centavos: 2000 } });
  assert.equal(naoConfirmado.pontos_por_ano, null);
  assert.ok(naoConfirmado.avisos[0].includes('ainda não estão confirmados'));

  const semPontos = calcularAnuidade({ cartao: { ...porReal, pontos_por_real: 'A_CONFIRMAR' }, gasto_mensal_centavos: 100000, milheiro: { centavos: 2000 } });
  assert.equal(semPontos.pontos_por_ano, null);
});

test('anuidade: cartão sem anuidade e milheiro que nunca paga', () => {
  const gratis = calcularAnuidade({ cartao: { ...porReal, anuidade_brl: 0 }, gasto_mensal_centavos: 100000, milheiro: { centavos: 2000 } });
  assert.equal(gratis.situacao, 'compensa');
  assert.equal(gratis.gasto_mensal_de_empate_centavos, null);
  assert.ok(!gratis.avisos.some((a) => a.includes('isenção')));

  // Cashback de 5% (R$ 0,05 por real) vale mais que 2 pontos × R$ 0,02 = R$ 0,04 por real.
  const nunca = calcularAnuidade({ cartao: porReal, gasto_mensal_centavos: 100000, milheiro: { centavos: 2000 }, cashback_alternativo_porcento: 500 });
  assert.equal(nunca.gasto_mensal_de_empate_centavos, null);
  assert.match(nunca.veredito, /nenhum gasto faz os pontos pagarem a anuidade/);
});

test('anuidade: entrada inválida é recusada', () => {
  assert.throws(() => calcularAnuidade({ cartao: null, gasto_mensal_centavos: 1 }), /registro/);
  assert.throws(() => calcularAnuidade({ cartao: porReal, gasto_mensal_centavos: -1 }), /centavos/);
  assert.throws(() => calcularAnuidade({ cartao: porReal, gasto_mensal_centavos: 1, milheiro: { centavos: 1.5 } }), /milheiro/);
  assert.throws(() => calcularAnuidade({ cartao: porReal, gasto_mensal_centavos: 1, cotacao: 0 }), /cotacao/);
  assert.throws(() => calcularAnuidade({ cartao: porReal, gasto_mensal_centavos: 1, cashback_alternativo_porcento: -1 }), /porcentagem/);
});
