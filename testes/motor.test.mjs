// Testes do motor de cálculo. Os números esperados são calculados à mão nos
// comentários. Dados de teste ficam aqui dentro (nada de dado inventado em dados/).
//
// Conta: pontos = pontos_por_real × valor em reais
//        valor (centavos) = pontos × milheiro (centavos) ÷ 1000
//        bilionesimos_de_centavo = centavos × 1.000.000.000
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { calcularJeitosDeComprar as calcular, formatarPontos, formatarCentavos, formatarData } from '../site/js/motor/index.js';
import { formatarNumero } from '../site/js/motor/formatar.js';

const BI = 1_000_000_000n; // bilionésimos por centavo
const reais = (centavos) => BigInt(centavos) * BI;
const FONTE = 'https://exemplo.invalid/teste';
const HOJE = '2026-11-10'; // dentro da validade da oferta de teste (01/11 a 12/11)

function dadosDeTeste() {
  return {
    programas: [
      { id: 'azul-fidelidade', nome: 'Azul Fidelidade', tipo: 'pontos', valor_milheiro_brl: 2000, url: FONTE, fonte_url: FONTE, verificado_em: '2026-11-05' },
      { id: 'livelo', nome: 'Livelo', tipo: 'pontos', valor_milheiro_brl: 'A_CONFIRMAR', url: FONTE, fonte_url: FONTE, verificado_em: '2026-11-05' },
    ],
    cartoes: [
      { id: 'azul-itau', nome: 'Azul Itaú', emissor: 'Itaú', bandeira: 'Visa', programa_id: 'azul-fidelidade', pontos_por_real: 2, anuidade_brl: 0, observacoes: '', fonte_url: FONTE, verificado_em: '2026-11-05', status: 'confirmado' },
      { id: 'cartao-livelo', nome: 'Cartão Livelo', emissor: 'Banco', bandeira: 'Visa', programa_id: 'livelo', pontos_por_real: 3, anuidade_brl: 0, observacoes: '', fonte_url: FONTE, verificado_em: '2026-11-05', status: 'confirmado' },
    ],
    lojas: [
      { id: 'magalu', nome: 'Magalu', dominio: 'A_CONFIRMAR', categoria: 'A_CONFIRMAR', aceita_cupom: 'A_CONFIRMAR', observacoes: '', fonte_url: FONTE, verificado_em: '2026-11-05' },
      { id: 'loja-sem-oferta', nome: 'Loja Sem Oferta', dominio: 'A_CONFIRMAR', categoria: 'A_CONFIRMAR', aceita_cupom: 'A_CONFIRMAR', observacoes: '', fonte_url: FONTE, verificado_em: '2026-11-05' },
    ],
    ofertas: [
      {
        id: 'azul-magalu-teste',
        loja_id: 'magalu',
        programa_id: 'azul-fidelidade',
        // Mesmos degraus da campanha de exemplo: 15, 13, 9 e 7.
        regras: [
          { condicao: { clube_ativo: true, cartao_id: 'azul-itau' }, pontos_por_real: 15 },
          { condicao: { clube_ativo: true }, pontos_por_real: 13 },
          { condicao: { cartao_id: 'azul-itau' }, pontos_por_real: 9 },
          { condicao: {}, pontos_por_real: 7 },
        ],
        escopo: 'vendido_e_entregue_pela_loja',
        pontos_fora_do_escopo_por_real: 1,
        acumula_com_cartao: true,
        clube_ativo_ha_horas: 24,
        exige_cupom: false,
        inicio: '2026-11-01',
        fim: '2026-11-12',
        credito_prazo_dias: 30,
        link_oferta: 'A_CONFIRMAR',
        fonte_url: FONTE,
        verificado_em: '2026-11-05',
      },
    ],
  };
}

/** Altera a cópia dos dados de teste. */
function dadosCom(alterar) {
  const d = dadosDeTeste();
  alterar(d);
  return d;
}

const COM_CLUBE = { programa_id: 'azul-fidelidade', clube_ativo: true, clube_ativo_desde: '2026-11-01' };
const SEM_CLUBE = { programa_id: 'azul-fidelidade', clube_ativo: false };
const perfil = (programas, cartoes, extra = {}) => ({ programas, cartoes, ...extra });
const compra = (valor_centavos, extra = {}) => ({ loja_id: 'magalu', valor_centavos, tipo_vendedor: 'loja', ...extra });
const daOferta = (lista) => lista.filter((j) => j.tipo === 'oferta');

// ---------------------------------------------------------------------------
// Degraus da campanha (R$ 100,00 = 10000 centavos; milheiro Azul = R$ 20,00)

test('degrau 15: clube ativo + cartão Azul Itaú', () => {
  const [melhor] = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dadosDeTeste(), HOJE);
  // programa: 100 × 15 = 1500; cartão: 100 × 2 = 200; soma (acumula) = 1700
  // valor: 1700 × 2000 ÷ 1000 = 3400 centavos = R$ 34,00
  assert.equal(melhor.tipo, 'oferta');
  assert.equal(melhor.pontos_do_programa, 1500);
  assert.equal(melhor.pontos_do_cartao, 200);
  assert.equal(melhor.total_pontos, 1700);
  assert.deepEqual(melhor.valor_estimado_em_reais, { bilionesimos_de_centavo: reais(3400), texto: 'R$ 34,00' });
  assert.deepEqual(melhor.o_que_voce_ganharia_se, []);
  assert.deepEqual(melhor.condicoes_a_cumprir, [
    'Estar com o clube Azul Fidelidade ativo na hora da compra.',
    'Comprar produto vendido e entregue pela própria loja (não de parceiro).',
    'Pagar com o cartão Azul Itaú.',
  ]);
  assert.deepEqual(melhor.explicacao, [
    'Compra de R$ 100,00 na Magalu, vendida e entregue pela própria loja.',
    'Oferta Azul Fidelidade na Magalu: vale a faixa "clube Azul Fidelidade ativo + cartão Azul Itaú", com 15 pontos por real.',
    'Pontos do programa: R$ 100,00 × 15 = 1.500 pontos.',
    'Pontos do cartão Azul Itaú: R$ 100,00 × 2 = 200 pontos no programa Azul Fidelidade.',
    'A oferta soma com os pontos do cartão: 1.500 + 200 = 1.700 pontos.',
    'Valor estimado (milheiro é quanto valem 1.000 pontos): 1.700 pontos Azul Fidelidade × R$ 20,00 por milheiro ÷ 1.000 = R$ 34,00.',
  ]);
  assert.deepEqual(melhor.validade_da_oferta, { inicio: '2026-11-01', fim: '2026-11-12', texto: 'De 01/11/2026 até 12/11/2026.' });
  assert.deepEqual(melhor.prazo_de_credito, { dias: 30, texto: 'Os pontos da oferta caem em até 30 dias, segundo a oferta.' });
});

test('degrau 13: clube ativo, sem cartão', () => {
  const [melhor] = calcular(perfil([COM_CLUBE], []), compra(10000), dadosDeTeste(), HOJE);
  // programa: 100 × 13 = 1300; sem cartão; valor 1300 × 2000 ÷ 1000 = 2600 centavos
  assert.equal(melhor.cartao, null);
  assert.equal(melhor.pontos_do_programa, 1300);
  assert.equal(melhor.pontos_do_cartao, 0);
  assert.equal(melhor.total_pontos, 1300);
  assert.equal(melhor.valor_estimado_em_reais.texto, 'R$ 26,00');
  // A faixa de 15 exige um cartão que a pessoa não tem.
  assert.equal(melhor.o_que_voce_ganharia_se.length, 1);
  assert.equal(melhor.o_que_voce_ganharia_se[0].pontos_do_programa, 1500);
});

test('degrau 9: cartão Azul Itaú, sem clube', () => {
  const [melhor] = calcular(perfil([SEM_CLUBE], ['azul-itau']), compra(10000), dadosDeTeste(), HOJE);
  // programa: 100 × 9 = 900; cartão 200; total 1100; valor 1100 × 2 = 2200 centavos
  assert.equal(melhor.pontos_do_programa, 900);
  assert.equal(melhor.pontos_do_cartao, 200);
  assert.equal(melhor.total_pontos, 1100);
  assert.equal(melhor.valor_estimado_em_reais.texto, 'R$ 22,00');
});

test('degrau 7: sem clube e sem cartão', () => {
  const [melhor, base] = calcular(perfil([SEM_CLUBE], []), compra(10000), dadosDeTeste(), HOJE);
  // programa: 100 × 7 = 700; valor 700 × 2 = 1400 centavos
  assert.equal(melhor.total_pontos, 700);
  assert.equal(melhor.valor_estimado_em_reais.texto, 'R$ 14,00');
  // Caso base: sem oferta e sem cartão = 0 pontos
  assert.equal(base.tipo, 'sem_oferta');
  assert.equal(base.total_pontos, 0);
  assert.equal(base.valor_estimado_em_reais.texto, 'R$ 0,00');
});

// ---------------------------------------------------------------------------
// Escopo e validade

test('item de parceiro rende 1 ponto por real', () => {
  const lista = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000, { tipo_vendedor: 'parceiro' }), dadosDeTeste(), HOJE);
  const [oferta] = daOferta(lista);
  // programa: 100 × 1 = 100 (fora do escopo); cartão 200; soma 300
  assert.equal(oferta.pontos_do_programa, 100);
  assert.equal(oferta.total_pontos, 300);
  assert.ok(oferta.avisos.includes('Item de parceiro rende só 1 ponto por real.'));
  assert.deepEqual(oferta.o_que_voce_ganharia_se, []);
  assert.equal(lista[0], oferta); // 300 > 200 do caso base
});

test('oferta vencida não entra', () => {
  const lista = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dadosDeTeste(), '2026-11-13');
  assert.deepEqual(daOferta(lista), []);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].tipo, 'sem_oferta');
  assert.equal(lista[0].total_pontos, 200); // só o cartão: 100 × 2
});

test('oferta no último dia ainda vale e avisa que vence hoje', () => {
  const [melhor] = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dadosDeTeste(), '2026-11-12');
  assert.equal(melhor.tipo, 'oferta');
  assert.ok(melhor.avisos.includes('A oferta vence hoje (12/11/2026).'));
});

test('avisa que a oferta vence em 2 dias', () => {
  const [melhor] = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dadosDeTeste(), HOJE);
  assert.ok(melhor.avisos.includes('A oferta vence em 2 dias (12/11/2026).'));
});

test('oferta que começa amanhã não entra', () => {
  const dados = dadosCom((d) => { d.ofertas[0].inicio = '2026-11-11'; });
  const lista = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dados, HOJE);
  assert.deepEqual(daOferta(lista), []);
});

// ---------------------------------------------------------------------------
// Clube

test('cliente sem clube: regra do nível dele e, separado, o que ganharia', () => {
  const [melhor] = calcular(perfil([SEM_CLUBE], ['azul-itau']), compra(10000), dadosDeTeste(), HOJE);
  // nível dele: cartão = 9 → 900 + 200 = 1100 (não soma as hipóteses)
  assert.equal(melhor.total_pontos, 1100);
  assert.deepEqual(melhor.o_que_voce_ganharia_se, [
    {
      condicoes: ['assinasse o clube Azul Fidelidade pelo menos 24 horas antes da compra'],
      pontos_por_real: 15,
      pontos_do_programa: 1500, // 100 × 15
      valor_estimado_em_reais: { bilionesimos_de_centavo: reais(3000), texto: 'R$ 30,00' }, // 1500 × 2
      texto: 'Se você assinasse o clube Azul Fidelidade pelo menos 24 horas antes da compra: 15 pontos por real = 1.500 pontos do programa (R$ 30,00), em vez de 900. Isso não está somado ao resultado acima.',
    },
  ]);
});

test('cliente sem clube e sem cartão vê as três faixas melhores', () => {
  const [melhor] = calcular(perfil([SEM_CLUBE], []), compra(10000), dadosDeTeste(), HOJE);
  assert.equal(melhor.total_pontos, 700);
  assert.deepEqual(melhor.o_que_voce_ganharia_se.map((h) => [h.pontos_por_real, h.pontos_do_programa]), [
    [15, 1500], [13, 1300], [9, 900],
  ]);
  assert.deepEqual(melhor.o_que_voce_ganharia_se[0].condicoes, [
    'assinasse o clube Azul Fidelidade pelo menos 24 horas antes da compra',
    'tivesse e usasse o cartão Azul Itaú',
  ]);
});

test('clube assinado ontem (sem hora) ainda não conta as 24 h; anteontem conta', () => {
  const ontem = { ...COM_CLUBE, clube_ativo_desde: '2026-11-09' };
  const [a] = calcular(perfil([ontem], ['azul-itau']), compra(10000), dadosDeTeste(), HOJE);
  assert.equal(a.pontos_do_programa, 900); // fica no degrau do cartão
  assert.match(a.o_que_voce_ganharia_se[0].texto, /ativo há pelo menos 24 horas na hora da compra \(ele está ativo desde 09\/11\/2026\)/);

  const anteontem = { ...COM_CLUBE, clube_ativo_desde: '2026-11-08' };
  const [b] = calcular(perfil([anteontem], ['azul-itau']), compra(10000), dadosDeTeste(), HOJE);
  assert.equal(b.pontos_do_programa, 1500);
});

test('clube com hora: 25 h antes conta', () => {
  const p = { ...COM_CLUBE, clube_ativo_desde: '2026-11-09T08:00' };
  const [melhor] = calcular(perfil([p], ['azul-itau']), compra(10000), dadosDeTeste(), '2026-11-10T09:00');
  assert.equal(melhor.pontos_do_programa, 1500);
});

// ---------------------------------------------------------------------------
// Soma com o cartão

test('acumula_com_cartao falso: vale o maior dos dois', () => {
  const dados = dadosCom((d) => { d.ofertas[0].acumula_com_cartao = false; });
  const [melhor] = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dados, HOJE);
  // oferta 1500 × cartão 200 → vale 1500; valor 1500 × 2 = 3000 centavos
  assert.equal(melhor.pontos_do_programa, 1500);
  assert.equal(melhor.pontos_do_cartao, 0);
  assert.equal(melhor.total_pontos, 1500);
  assert.equal(melhor.valor_estimado_em_reais.texto, 'R$ 30,00');
  assert.ok(melhor.avisos.includes('Esta oferta não soma com os pontos do cartão; vale o maior dos dois.'));
});

test('acumula_com_cartao falso com parceiro: o cartão vence a oferta', () => {
  const dados = dadosCom((d) => { d.ofertas[0].acumula_com_cartao = false; });
  const [oferta] = daOferta(calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000, { tipo_vendedor: 'parceiro' }), dados, HOJE));
  // oferta 100 × 1 = 100; cartão 200 → vale 200 do cartão
  assert.equal(oferta.pontos_do_programa, 0);
  assert.equal(oferta.pontos_do_cartao, 200);
  assert.equal(oferta.total_pontos, 200);
});

test('acumula_com_cartao verdadeiro: soma', () => {
  const [melhor] = calcular(perfil([SEM_CLUBE], ['azul-itau']), compra(25000), dadosDeTeste(), HOJE);
  // R$ 250: programa 250 × 9 = 2250; cartão 250 × 2 = 500; soma 2750; valor 2750 × 2 = 5500 centavos
  assert.equal(melhor.total_pontos, 2750);
  assert.equal(melhor.valor_estimado_em_reais.texto, 'R$ 55,00');
});

// ---------------------------------------------------------------------------
// Valores extremos

test('valor zero: tudo zero, sem erro', () => {
  const lista = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(0), dadosDeTeste(), HOJE);
  assert.equal(lista.length, 2);
  for (const j of lista) {
    assert.equal(j.total_pontos, 0);
    assert.deepEqual(j.valor_estimado_em_reais, { bilionesimos_de_centavo: 0n, texto: 'R$ 0,00' });
  }
});

test('valor enorme (maior inteiro seguro) sem perder precisão no valor', () => {
  const v = Number.MAX_SAFE_INTEGER; // 9.007.199.254.740.991 centavos
  const [melhor] = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(v), dadosDeTeste(), HOJE);
  // programa: 9.007.199.254.740.991 × 15 ÷ 100 = 1.351.079.888.211.148,65
  // cartão:   9.007.199.254.740.991 × 2 ÷ 100  =   180.143.985.094.819,82
  // total:                                       1.531.223.873.305.968,47 pontos
  // valor: total × 2000 ÷ 1000 = 3.062.447.746.611.936,94 centavos → R$ 30.624.477.466.119,37
  assert.equal(melhor.total_pontos_texto, '1.531.223.873.305.968,47');
  assert.equal(melhor.valor_estimado_em_reais.bilionesimos_de_centavo, 3_062_447_746_611_936_940_000_000n);
  assert.equal(melhor.valor_estimado_em_reais.texto, 'R$ 30.624.477.466.119,37');
});

test('valor inválido é recusado', () => {
  for (const v of [-1, 10.5, Number.MAX_SAFE_INTEGER + 1, '100']) {
    assert.throws(() => calcular(perfil([], []), compra(v), dadosDeTeste(), HOJE), /valor_centavos/);
  }
});

test('centavos fracionários de pontos ficam exatos até a exibição', () => {
  // R$ 0,99 × 7 = 6,93 pontos; valor 6,93 × 2000 ÷ 1000 = 13,86 centavos → R$ 0,14
  const [melhor] = calcular(perfil([SEM_CLUBE], []), compra(99), dadosDeTeste(), HOJE);
  assert.equal(melhor.total_pontos, 6.93);
  assert.equal(melhor.valor_estimado_em_reais.bilionesimos_de_centavo, 13_860_000_000n);
  assert.equal(melhor.valor_estimado_em_reais.texto, 'R$ 0,14');
});

// ---------------------------------------------------------------------------
// Milheiro

test('programa sem valor de milheiro: pontos sim, reais não', () => {
  const lista = calcular(perfil([], ['cartao-livelo']), compra(10000, { loja_id: 'loja-sem-oferta' }), dadosDeTeste(), HOJE);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].total_pontos, 300); // 100 × 3
  assert.equal(lista[0].valor_estimado_em_reais, null);
  assert.ok(lista[0].avisos.includes('O programa Livelo não tem valor de milheiro confirmado; não dá para estimar em reais. Você pode informar o seu.'));
});

test('valor de milheiro do perfil sobrescreve o padrão', () => {
  const p = perfil([], ['cartao-livelo', 'azul-itau'], { valor_milheiro_brl: { livelo: 3000, 'azul-fidelidade': 2500 } });
  const lista = calcular(p, compra(10000, { loja_id: 'loja-sem-oferta' }), dadosDeTeste(), HOJE);
  // Livelo: 300 × 3000 ÷ 1000 = 900 centavos; Azul: 200 × 2500 ÷ 1000 = 500 centavos
  assert.deepEqual(lista.map((j) => [j.cartao.id, j.total_pontos, j.valor_estimado_em_reais.texto]), [
    ['cartao-livelo', 300, 'R$ 9,00'],
    ['azul-itau', 200, 'R$ 5,00'],
  ]);
});

test('empate de pontos: desempata pelo maior valor em reais', () => {
  const dados = dadosCom((d) => { d.cartoes[1].pontos_por_real = 2; });
  const p = perfil([], ['azul-itau', 'cartao-livelo'], { valor_milheiro_brl: { livelo: 3000 } });
  const lista = calcular(p, compra(10000, { loja_id: 'loja-sem-oferta' }), dados, HOJE);
  // Os dois dão 100 × 2 = 200 pontos. Azul: 200 × 2000 ÷ 1000 = 400; Livelo: 200 × 3000 ÷ 1000 = 600.
  // Pela ordem alfabética, Azul viria antes; o desempate por reais põe Livelo na frente.
  assert.deepEqual(lista.map((j) => [j.cartao.id, j.total_pontos, j.valor_estimado_em_reais.texto]), [
    ['cartao-livelo', 200, 'R$ 6,00'],
    ['azul-itau', 200, 'R$ 4,00'],
  ]);
});

// ---------------------------------------------------------------------------
// A_CONFIRMAR

test('oferta com status A_CONFIRMAR não entra no ranking', () => {
  const dados = dadosCom((d) => { d.ofertas[0].status = 'A_CONFIRMAR'; });
  const lista = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dados, HOJE);
  assert.deepEqual(daOferta(lista), []);
});

test('cartão com pontos A_CONFIRMAR não soma pontos', () => {
  const dados = dadosCom((d) => { d.cartoes[0].pontos_por_real = 'A_CONFIRMAR'; });
  const [melhor] = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dados, HOJE);
  assert.equal(melhor.pontos_do_programa, 1500);
  assert.equal(melhor.pontos_do_cartao, 0);
  assert.ok(melhor.avisos.includes('Os pontos por real do cartão Azul Itaú não estão confirmados; não entram no cálculo.'));
});

test('oferta de exemplo do repositório (vários campos A_CONFIRMAR)', async () => {
  const dados = {};
  for (const nome of ['programas', 'cartoes', 'lojas', 'ofertas']) {
    dados[nome] = JSON.parse(await readFile(new URL(`../dados/${nome}.json`, import.meta.url), 'utf8'));
  }
  // Hoje dentro da validade: a oferta de exemplo termina em 12/11/2026.
  const lista = calcular(perfil([COM_CLUBE], ['azul-itau-infinite']), compra(10000), dados, HOJE);
  const [melhor] = lista;
  // 100 × 15 = 1500; cartão A_CONFIRMAR = 0; acumula A_CONFIRMAR → vale o maior (1500)
  assert.equal(melhor.tipo, 'oferta');
  assert.equal(melhor.total_pontos, 1500);
  // milheiro Azul = estimativa editável de R$ 17,00: 1500 × 1700 ÷ 1000 = 2550 centavos
  assert.equal(melhor.valor_estimado_em_reais.texto, 'R$ 25,50');
  assert.ok(melhor.avisos.includes('A data de início da oferta não está confirmada.'));
  assert.ok(melhor.avisos.includes('Não está confirmado se a oferta exige cupom.'));
  assert.equal(melhor.prazo_de_credito.dias, 30);
});

// ---------------------------------------------------------------------------
// Avisos, cupom e caso base

test('dado verificado há mais de 14 dias gera aviso', () => {
  const dados = dadosCom((d) => { d.ofertas[0].verificado_em = '2026-10-20'; });
  const [melhor] = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dados, HOJE);
  // 20/10 → 10/11 = 21 dias
  assert.ok(melhor.avisos.includes('Dado verificado há mais de 14 dias (21 dias): oferta Azul Fidelidade na Magalu.'));
  assert.equal(melhor.tem_dado_antigo, true);
  const daOfertaConferida = melhor.conferido_em.find((c) => c.rotulo === 'oferta Azul Fidelidade na Magalu');
  assert.deepEqual(daOfertaConferida, {
    rotulo: 'oferta Azul Fidelidade na Magalu', verificado_em: '2026-10-20', dias: 21, antigo: true,
  });
});

test('conferido_em lista a data de verificação de cada dado usado, sem repetir', () => {
  const [melhor] = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dadosDeTeste(), HOJE);
  assert.equal(melhor.tem_dado_antigo, false);
  const rotulos = melhor.conferido_em.map((c) => c.rotulo);
  assert.ok(rotulos.includes('oferta Azul Fidelidade na Magalu'));
  assert.ok(rotulos.some((r) => r.startsWith('cartão ')));
  assert.equal(new Set(rotulos).size, rotulos.length);
  for (const c of melhor.conferido_em) assert.match(c.verificado_em, /^\d{4}-\d{2}-\d{2}$/);
});

test('cupom exigido vira condição, e some quando já foi aplicado', () => {
  const dados = dadosCom((d) => { d.ofertas[0].exige_cupom = true; d.ofertas[0].cupom = 'MILHAS10'; });
  const [a] = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000), dados, HOJE);
  assert.ok(a.condicoes_a_cumprir.includes('Aplicar o cupom MILHAS10 na compra.'));
  const [b] = calcular(perfil([COM_CLUBE], ['azul-itau']), compra(10000, { cupom_aplicado: true }), dados, HOJE);
  assert.ok(!b.condicoes_a_cumprir.includes('Aplicar o cupom MILHAS10 na compra.'));
});

test('sempre inclui o caso base, sem oferta, para cada cartão', () => {
  const lista = calcular(perfil([COM_CLUBE], ['azul-itau', 'cartao-livelo']), compra(10000), dadosDeTeste(), HOJE);
  const base = lista.filter((j) => j.tipo === 'sem_oferta').map((j) => [j.cartao.id, j.total_pontos]);
  assert.deepEqual(base, [['cartao-livelo', 300], ['azul-itau', 200]]);
  assert.equal(lista.length, 4); // 2 com oferta + 2 sem
});

// ---------------------------------------------------------------------------
// Pureza

function congelar(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) congelar(v);
  }
  return obj;
}

test('mesma entrada, mesmo resultado, sem mexer na entrada', () => {
  const entrada = congelar([perfil([SEM_CLUBE], ['azul-itau', 'cartao-livelo']), compra(12345), dadosDeTeste(), HOJE]);
  const antes = structuredClone(entrada);
  const r1 = calcular(...entrada);
  const r2 = calcular(...entrada);
  assert.deepEqual(r1, r2);
  assert.deepEqual(entrada, antes);
});

test('o motor não usa relógio, rede, DOM, aleatoriedade nem módulos do Node', async () => {
  const pasta = new URL('../site/js/motor/', import.meta.url);
  for (const nome of await readdir(pasta)) {
    const codigo = await readFile(new URL(nome, pasta), 'utf8');
    assert.doesNotMatch(codigo, /Date\.now|new Date\(\)|Math\.random|fetch\(|document\.|window\.|localStorage|from 'node:/, nome);
  }
});

test('formatação pt-BR', () => {
  assert.equal(formatarCentavos(123456), 'R$ 1.234,56');
  assert.equal(formatarCentavos(5), 'R$ 0,05');
  assert.equal(formatarPontos(1_234_500_000n), '1.234,5');
});

test('formatação pt-BR pelo Intl: moeda, números e datas', () => {
  assert.equal(formatarCentavos(0), 'R$ 0,00');
  assert.equal(formatarCentavos(-150), '-R$ 1,50');
  assert.equal(formatarCentavos(99_999_999_999), 'R$ 999.999.999,99');
  // BigInt maior que o maior inteiro seguro do float: nenhum dígito se perde.
  assert.equal(formatarCentavos(12_345_678_901_234_567_891n), 'R$ 123.456.789.012.345.678,91');
  assert.equal(formatarPontos(1_000_000n), '1');
  assert.equal(formatarPontos(1_234_567_000_000n), '1.234.567');
  assert.equal(formatarNumero(1.5), '1,5');
  assert.equal(formatarNumero(10), '10');
  assert.equal(formatarData('2026-01-05'), '05/01/2026');
  assert.equal(formatarData('2026-12-31T23:59'), '31/12/2026');
});
