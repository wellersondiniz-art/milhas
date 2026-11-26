// Ciclo de vida das ofertas (site/js/motor/ciclo.js) e a virada do dia no
// horário de São Paulo (dataHoraEmSaoPaulo). Testes de borda: último dia,
// meia-noite, 3/4 dias para vencer, 14/15 e 30/31 dias desde a conferência.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  calcularJeitosDeComprar as calcular, dataHoraEmSaoPaulo, DIAS_ALERTA_VENCIMENTO, DIAS_DADO_ANTIGO, DIAS_RECONFERIR,
  ESTADOS, idadeDoDado, quandoVence, situacaoDaOferta,
} from '../site/js/motor/index.js';

const FONTE = 'https://exemplo.invalid/teste';

function oferta(extra = {}) {
  return {
    id: 'oferta-a',
    loja_id: 'loja',
    programa_id: 'prog-a',
    regras: [{ condicao: {}, pontos_por_real: 5 }],
    escopo: 'todos_os_produtos',
    acumula_com_cartao: true,
    exige_cupom: false,
    inicio: '2026-11-01',
    fim: '2026-11-30',
    credito_prazo_dias: 30,
    fonte_url: FONTE,
    verificado_em: '2026-11-20',
    ...extra,
  };
}

function dados(o = oferta()) {
  return {
    programas: [{ id: 'prog-a', nome: 'Programa A', tipo: 'milhas', valor_milheiro_brl: 2000, fonte_url: FONTE, verificado_em: '2026-11-20' }],
    cartoes: [],
    lojas: [{ id: 'loja', nome: 'Loja X', fonte_url: FONTE, verificado_em: '2026-11-20' }],
    ofertas: [o],
  };
}

const perfil = { programas: [{ programa_id: 'prog-a', clube_ativo: false }], cartoes: [] };
const compra = { loja_id: 'loja', valor_centavos: 10000, tipo_vendedor: 'loja' };
const ofertaNoRanking = (o, hoje) => calcular(perfil, compra, dados(o), hoje).find((j) => j.tipo === 'oferta');
const estado = (o, hoje) => situacaoDaOferta(o, hoje).estado;

describe('prazos', () => {
  test('3 dias de alerta, 14 de dado antigo, 30 para reconferir', () => {
    assert.equal(DIAS_ALERTA_VENCIMENTO, 3);
    assert.equal(DIAS_DADO_ANTIGO, 14);
    assert.equal(DIAS_RECONFERIR, 30);
  });

  test('quandoVence', () => {
    assert.equal(quandoVence(0), 'hoje');
    assert.equal(quandoVence(1), 'amanhã');
    assert.equal(quandoVence(3), 'em 3 dias');
  });
});

describe('vencimento', () => {
  test('4 dias antes: ativa; 3 dias antes: vence logo', () => {
    assert.equal(estado(oferta(), '2026-11-26'), ESTADOS.ATIVA);
    assert.equal(estado(oferta(), '2026-11-27'), ESTADOS.VENCE_LOGO);
    assert.equal(situacaoDaOferta(oferta(), '2026-11-27').dias_para_vencer, 3);
  });

  test('último dia ainda vale (vence hoje) e entra no ranking', () => {
    const s = situacaoDaOferta(oferta(), '2026-11-30');
    assert.equal(s.estado, ESTADOS.VENCE_LOGO);
    assert.equal(s.dias_para_vencer, 0);
    assert.equal(s.no_ranking, true);
    const j = ofertaNoRanking(oferta(), '2026-11-30');
    assert.ok(j.avisos.includes('A oferta vence hoje (30/11/2026).'));
    assert.equal(j.situacao_da_oferta.estado, 'vence_logo');
  });

  test('dia seguinte ao último: vencida, sai do ranking e vai para o histórico', () => {
    const s = situacaoDaOferta(oferta(), '2026-12-01');
    assert.equal(s.estado, ESTADOS.VENCIDA);
    assert.equal(s.no_ranking, false);
    assert.equal(s.no_historico, true);
    assert.equal(ofertaNoRanking(oferta(), '2026-12-01'), undefined);
  });

  test('vencida continua vencida mesmo conferida há muito tempo (histórico vence "reconferir")', () => {
    assert.equal(estado(oferta({ verificado_em: '2026-01-01' }), '2026-12-01'), ESTADOS.VENCIDA);
  });

  test('fim A_CONFIRMAR: nunca vence pelo calendário, sem dias para vencer', () => {
    const s = situacaoDaOferta(oferta({ fim: 'A_CONFIRMAR' }), '2026-11-30');
    assert.equal(s.estado, ESTADOS.ATIVA);
    assert.equal(s.dias_para_vencer, null);
  });

  test('ainda não começou: futura, fora do ranking; no primeiro dia já entra', () => {
    assert.equal(estado(oferta({ inicio: '2026-11-21' }), '2026-11-20'), ESTADOS.FUTURA);
    assert.equal(situacaoDaOferta(oferta({ inicio: '2026-11-21' }), '2026-11-20').no_ranking, false);
    assert.equal(estado(oferta({ inicio: '2026-11-21' }), '2026-11-21'), ESTADOS.ATIVA);
  });

  test('status A_CONFIRMAR: em conferência, fora do ranking', () => {
    assert.equal(estado(oferta({ status: 'A_CONFIRMAR' }), '2026-11-21'), ESTADOS.EM_CONFERENCIA);
    assert.equal(ofertaNoRanking(oferta({ status: 'A_CONFIRMAR' }), '2026-11-21'), undefined);
  });
});

describe('dado antigo', () => {
  test('14 dias: em dia; 15: antigo (aviso), continua no ranking', () => {
    assert.deepEqual(idadeDoDado('2026-11-01', '2026-11-15'), { dias: 14, nivel: 'em_dia' });
    assert.deepEqual(idadeDoDado('2026-11-01', '2026-11-16'), { dias: 15, nivel: 'antigo' });
    const o = oferta({ verificado_em: '2026-11-01' });
    const s = situacaoDaOferta(o, '2026-11-16');
    assert.equal(s.estado, ESTADOS.ATIVA);
    assert.equal(s.dado_antigo, true);
    const j = ofertaNoRanking(o, '2026-11-16');
    assert.ok(j.tem_dado_antigo);
    assert.ok(j.avisos.includes('Dado verificado há mais de 14 dias (15 dias): oferta Programa A na Loja X.'));
  });

  test('30 dias: ainda no ranking; 31: sai até reconferir', () => {
    const o = oferta({ verificado_em: '2026-10-31' });
    assert.equal(situacaoDaOferta(o, '2026-11-30').dias_desde_conferencia, 30);
    assert.equal(estado(o, '2026-11-30'), ESTADOS.VENCE_LOGO);
    assert.ok(ofertaNoRanking(o, '2026-11-30'));
    const o2 = oferta({ verificado_em: '2026-10-29' });
    assert.equal(estado(o2, '2026-11-29'), ESTADOS.RECONFERIR);
    assert.equal(situacaoDaOferta(o2, '2026-11-29').no_ranking, false);
    assert.equal(situacaoDaOferta(o2, '2026-11-29').no_historico, false);
    assert.equal(ofertaNoRanking(o2, '2026-11-29'), undefined);
  });

  test('reconferir: basta atualizar verificado_em para voltar ao ranking', () => {
    const velha = oferta({ verificado_em: '2026-10-01' });
    assert.equal(ofertaNoRanking(velha, '2026-11-20'), undefined);
    assert.ok(ofertaNoRanking({ ...velha, verificado_em: '2026-11-20' }, '2026-11-20'));
  });

  test('a virada de mês e de ano conta dias de calendário', () => {
    assert.equal(idadeDoDado('2026-12-31', '2027-01-30').dias, 30);
    assert.equal(idadeDoDado('2026-12-31', '2027-01-31').nivel, 'reconferir');
    assert.equal(idadeDoDado('2028-02-14', '2028-02-29').nivel, 'antigo'); // ano bissexto: 15 dias
  });

  test('sem oferta, o jeito não tem situação de oferta', () => {
    const lista = calcular(perfil, compra, dados(oferta({ fim: '2026-11-01' })), '2026-11-20');
    assert.equal(lista.length, 1);
    assert.equal(lista[0].situacao_da_oferta, null);
  });
});

describe('meia-noite no fuso de São Paulo', () => {
  test('23:59 de Brasília ainda é o último dia; 00:00 já é o dia seguinte', () => {
    // 30/11 23:59 em São Paulo = 01/12 02:59 em UTC.
    const antes = dataHoraEmSaoPaulo(new Date('2026-12-01T02:59:59Z'));
    const depois = dataHoraEmSaoPaulo(new Date('2026-12-01T03:00:00Z'));
    assert.equal(antes, '2026-11-30T23:59');
    assert.equal(depois, '2026-12-01T00:00');
    assert.equal(estado(oferta(), antes), ESTADOS.VENCE_LOGO);
    assert.ok(ofertaNoRanking(oferta(), antes));
    assert.equal(estado(oferta(), depois), ESTADOS.VENCIDA);
    assert.equal(ofertaNoRanking(oferta(), depois), undefined);
  });

  test('já é dia seguinte em UTC, mas ainda é o último dia em São Paulo', () => {
    // 01/12 01:00 em UTC = 30/11 22:00 em Brasília: a oferta ainda vale.
    const agora = dataHoraEmSaoPaulo(Date.parse('2026-12-01T01:00:00Z'));
    assert.equal(agora, '2026-11-30T22:00');
    assert.ok(ofertaNoRanking(oferta(), agora));
  });

  test('a idade do dado também vira à meia-noite de São Paulo', () => {
    const o = oferta({ verificado_em: '2026-11-01' });
    assert.equal(situacaoDaOferta(o, dataHoraEmSaoPaulo(new Date('2026-11-16T02:59:00Z'))).dado_antigo, false);
    assert.equal(situacaoDaOferta(o, dataHoraEmSaoPaulo(new Date('2026-11-16T03:00:00Z'))).dado_antigo, true);
  });

  test('não depende do fuso do aparelho', () => {
    const codigo = `import('${new URL('../site/js/motor/datas.js', import.meta.url).href}')` +
      ".then((m) => process.stdout.write(m.dataHoraEmSaoPaulo(new Date('2026-12-01T02:59:59Z'))))";
    for (const TZ of ['UTC', 'Asia/Tokyo', 'America/Manaus', 'America/Noronha']) {
      const saida = execFileSync(process.execPath, ['--input-type=module', '-e', codigo], { env: { ...process.env, TZ } }).toString();
      assert.equal(saida, '2026-11-30T23:59', `fuso do aparelho ${TZ}`);
    }
  });

  test('horário de verão antigo (2018) também é respeitado', () => {
    // Em 04/11/2018 o relógio de São Paulo pulou de 00:00 para 01:00.
    assert.equal(dataHoraEmSaoPaulo(new Date('2018-11-04T02:59:00Z')), '2018-11-03T23:59');
    assert.equal(dataHoraEmSaoPaulo(new Date('2018-11-04T03:00:00Z')), '2018-11-04T01:00');
  });
});
