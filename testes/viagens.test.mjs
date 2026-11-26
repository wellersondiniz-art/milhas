// Testes do motor das viagens (site/js/motor/viagens.js).
// Contas feitas à mão nos comentários. Dados de teste ficam aqui dentro;
// os testes com os dados reais (dados/*.json) usam a data fixa em que foram conferidos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  calcularTransferencias, calcularViagem, campanhasDeHoje, niveisPorPrograma, origensDeTransferencia,
  perguntasDasRegras, regrasDaCompra, vendedores,
} from '../site/js/motor/viagens.js';
import { formatarPontos, formatarValor } from '../site/js/motor/formatar.js';

const BI = 1_000_000_000n; // bilionésimos por centavo
const PT = 1_000_000n; // escala dos pontos
const FONTE = 'https://exemplo.invalid/teste';
const HOJE = '2026-11-25';

function programa(id, nome, milheiro) {
  return { id, nome, tipo: 'pontos', valor_milheiro_brl: milheiro, url: FONTE, fonte_url: FONTE, verificado_em: HOJE };
}

function dadosDeTeste() {
  return {
    programas: [
      programa('banco', 'Banco Pontos', 1500),
      programa('aerea', 'Aérea Milhas', 2000),
      programa('outra', 'Outra Aérea', 'A_CONFIRMAR'),
      programa('hotel', 'Hotel Pontos', 'A_CONFIRMAR'),
    ],
    cartoes: [
      { id: 'cartao-real', nome: 'Cartão Real', emissor: 'B', bandeira: 'Visa', programa_id: 'banco', pontos_por_real: 2, anuidade_brl: 0, observacoes: '', fonte_url: FONTE, verificado_em: HOJE, status: 'confirmado' },
      { id: 'cartao-dolar', nome: 'Cartão Dólar', emissor: 'B', bandeira: 'Visa', programa_id: 'aerea', pontos_por_real: 'A_CONFIRMAR', pontos_por_dolar: 4, anuidade_brl: 0, observacoes: '', fonte_url: FONTE, verificado_em: HOJE, status: 'confirmado' },
    ],
    cambio: [{ id: 'usd-brl', moeda: 'USD', reais_por_dolar: 50000, origem: 'ptax', data_referencia: '2026-11-24', observacoes: '', fonte_url: FONTE, verificado_em: HOJE }],
    cotacoes: [{ id: 'eur-brl', moeda: 'EUR', reais_por_unidade: 60000, origem: 'ptax', data_referencia: '2026-11-24', observacoes: '', fonte_url: FONTE, verificado_em: HOJE }],
    transferencias: [
      { id: 'banco-aerea', origem_id: 'banco', destino_id: 'aerea', paridade: { pontos_origem: 1, pontos_destino: 1 }, minimo_origem: 10000, multiplo_origem: 1000, prazo: '1 dia', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'banco-hotel', origem_id: 'banco', destino_id: 'hotel', paridade: { pontos_origem: 7, pontos_destino: 2 }, minimo_origem: 7000, multiplo_origem: 'A_CONFIRMAR', prazo: '7 dias', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'banco-outra', origem_id: 'banco', destino_id: 'outra', paridade: 'A_CONFIRMAR', minimo_origem: 'A_CONFIRMAR', multiplo_origem: 'A_CONFIRMAR', prazo: '?', fonte_url: FONTE, verificado_em: HOJE },
    ],
    'bonus-transferencia': [
      {
        id: 'hoje', transferencia_id: 'banco-aerea', inicio: '2026-11-25', fim: '2026-11-25',
        faixas: [{ id: 'todos', quem: 'Todos os clientes', bonus_percentual: 40 }, { id: 'clube', quem: 'Assinantes do clube', bonus_percentual: 80 }],
        limite_bonus: 300000, exige_cadastro: true, fonte_url: FONTE, verificado_em: HOJE,
      },
      {
        id: 'passada', transferencia_id: 'banco-aerea', inicio: '2026-11-01', fim: '2026-11-02',
        faixas: [{ id: 'todos', quem: 'Todos', bonus_percentual: 100 }], limite_bonus: 'A_CONFIRMAR', exige_cadastro: false, fonte_url: FONTE, verificado_em: HOJE,
      },
      {
        id: 'futura', transferencia_id: 'banco-hotel', inicio: '2026-12-01', fim: '2026-12-02',
        faixas: [{ id: 'todos', quem: 'Todos', bonus_percentual: 30 }], limite_bonus: 'A_CONFIRMAR', exige_cadastro: false, fonte_url: FONTE, verificado_em: HOJE,
      },
    ],
    viagens: [
      {
        id: 'aerea-nacional', tipo: 'passagem', programa_id: 'aerea', vendedor: 'Aérea', trechos: 'nacional_e_america_do_sul',
        escolha: { pergunta_id: 'tarifa', pergunta: 'Qual tarifa?', resposta_id: 'cheia', resposta: 'Cheia' },
        moeda: 'BRL', a_cada: 1, base_de_calculo: 'tarifa',
        niveis: [{ id: 'base', nome: 'Base (inicial)', pontos: 1.5 }, { id: 'top', nome: 'Top', pontos: 3.5 }, { id: 'nova', nome: 'Nova', pontos: 'A_CONFIRMAR' }],
        fonte_url: FONTE, verificado_em: HOJE,
      },
      {
        id: 'aerea-basica', tipo: 'passagem', programa_id: 'aerea', vendedor: 'Aérea', trechos: 'todos',
        escolha: { pergunta_id: 'tarifa', pergunta: 'Qual tarifa?', resposta_id: 'basica', resposta: 'Básica' },
        moeda: 'USD', a_cada: 1, base_de_calculo: 'tarifa', niveis: [{ id: 'todas', nome: 'Qualquer', pontos: 1 }],
        fonte_url: FONTE, verificado_em: HOJE,
      },
      {
        id: 'aerea-internacional', tipo: 'passagem', programa_id: 'aerea', vendedor: 'Aérea', trechos: 'fora_da_america_do_sul',
        escolha: { pergunta_id: 'tarifa', pergunta: 'Qual tarifa?', resposta_id: 'cheia', resposta: 'Cheia' },
        moeda: 'USD', a_cada: 1, base_de_calculo: 'tarifa', teto_por_trecho: 1000,
        niveis: [{ id: 'base', nome: 'Base (inicial)', pontos: 5 }, { id: 'top', nome: 'Top', pontos: 10 }],
        fonte_url: FONTE, verificado_em: HOJE,
      },
      {
        id: 'hotel-direto', tipo: 'hotel', programa_id: 'hotel', vendedor: 'Hotel direto', trechos: 'todos',
        moeda: 'EUR', a_cada: 10, base_de_calculo: 'diária',
        niveis: [{ id: 'classic', nome: 'Classic (inicial)', pontos: 25 }, { id: 'gold', nome: 'Gold', pontos: 37 }],
        valor_do_ponto: { moeda: 'EUR', centimos_por_mil: 2000, fonte_url: FONTE },
        fonte_url: FONTE, verificado_em: HOJE,
      },
      {
        id: 'hotel-parceiro', tipo: 'hotel', programa_id: 'aerea', vendedor: 'Site parceiro', trechos: 'todos',
        moeda: 'BRL', a_cada: 1, base_de_calculo: 'diária', niveis: [{ id: 'todas', nome: 'Qualquer', pontos: 2 }],
        fim: '2026-11-30', fonte_url: FONTE, verificado_em: HOJE,
      },
      {
        id: 'hotel-velho', tipo: 'hotel', programa_id: 'aerea', vendedor: 'Antigo', trechos: 'todos',
        moeda: 'BRL', a_cada: 1, base_de_calculo: 'diária', niveis: [{ id: 'todas', nome: 'Qualquer', pontos: 9 }],
        fim: '2026-11-01', fonte_url: FONTE, verificado_em: HOJE,
      },
    ],
  };
}

const rota = (r, id) => r.opcoes.find((o) => o.rota.id === id);

// ---------------------------------------------------------------------------
// Transferência

test('transferência com bônus da campanha de hoje: milhas, custo do milheiro e ganho', () => {
  const r = calcularTransferencias({ origem_id: 'banco', pontos: 20500 }, null, dadosDeTeste(), HOJE);
  const o = rota(r, 'banco-aerea');
  // Blocos de 1.000: usa 20.000, sobram 500. 1:1 → 20.000. Bônus 40% (faixa de todos) = 8.000. Total 28.000.
  assert.equal(o.pontos_usados, 20000);
  assert.equal(o.sobra, 500);
  assert.equal(o.bonus_percentual, 40);
  assert.equal(o.bonus_de, 'campanha');
  assert.equal(o.milhas_total, 28000n * PT);
  // Custo: 20.000 pontos × R$ 15,00 / 1.000 = R$ 300,00. Milheiro no destino: 300 / 28 = R$ 10,714285714…
  assert.equal(o.custo_total, 30000n * BI);
  assert.equal(o.custo_milheiro_destino, (30000n * BI * 1000n * PT) / (28000n * PT));
  assert.equal(formatarValor(o.custo_milheiro_destino), 'R$ 10,71');
  // Valor das milhas: 28.000 × R$ 20,00 / 1.000 = R$ 560,00. Ganho R$ 260,00.
  assert.equal(o.valor_destino, 56000n * BI);
  assert.equal(o.ganho, 26000n * BI);
  assert.ok(o.avisos.some((a) => a.includes('cadastre-se na campanha')));
  assert.ok(o.avisos.some((a) => a.includes('termina hoje')));
  assert.equal(o.ultima_campanha.id, 'passada');
});

test('faixa "maior" usa o bônus de quem tem clube; o limite da campanha corta o bônus', () => {
  const d = dadosDeTeste();
  const r = calcularTransferencias({ origem_id: 'banco', pontos: 20000, faixa: 'maior' }, null, d, HOJE);
  assert.equal(rota(r, 'banco-aerea').milhas_total, 36000n * PT); // 20.000 + 80%
  d['bonus-transferencia'][0].limite_bonus = 5000;
  const limitado = rota(calcularTransferencias({ origem_id: 'banco', pontos: 20000, faixa: 'maior' }, null, d, HOJE), 'banco-aerea');
  assert.equal(limitado.milhas_bonus, 5000n * PT);
  assert.equal(limitado.bonus_limitado, true);
});

test('bônus digitado vence a campanha; custo digitado vence o milheiro do programa', () => {
  const r = calcularTransferencias({
    origem_id: 'banco', pontos: 10000, bonus_manual: { aerea: 100 }, custo_milheiro_origem: 3500,
  }, null, dadosDeTeste(), HOJE);
  const o = rota(r, 'banco-aerea');
  // 10.000 + 100% = 20.000 milhas. Comprou a R$ 35,00 o milheiro: R$ 350,00 / 20 = R$ 17,50.
  assert.equal(o.bonus_de, 'digitado');
  assert.equal(o.milhas_total, 20000n * PT);
  assert.equal(o.custo_milheiro_destino, 1750n * BI);
  assert.equal(o.ganho, (40000n - 35000n) * BI);
});

test('proporção 3,5 : 1 e múltiplo a confirmar; destino sem milheiro mostra só a quantidade', () => {
  const r = calcularTransferencias({ origem_id: 'banco', pontos: 10000 }, null, dadosDeTeste(), HOJE);
  const o = rota(r, 'banco-hotel');
  // 10.000 ÷ 7 → 1.428 blocos de 7 = 9.996 pontos; ×2 = 2.856 pontos de hotel; sobram 4.
  assert.equal(o.pontos_usados, 9996);
  assert.equal(o.sobra, 4);
  assert.equal(o.milhas_total, 2856n * PT);
  assert.ok(o.avisos.some((a) => a.includes('múltiplo')));
  assert.equal(o.proxima_campanha.id, 'futura');
});

test('valor do ponto em euro: hotel sem milheiro em real usa o valor oficial convertido', () => {
  const d = dadosDeTeste();
  const o = rota(calcularTransferencias({ origem_id: 'banco', pontos: 7000 }, null, d, HOJE), 'banco-hotel');
  // 2.000 pontos × (20 € × R$ 6,0000 = R$ 120,00 por mil) = R$ 240,00.
  assert.equal(o.valor_destino, 24000n * BI);
});

test('rota sem proporção confirmada aparece, mas fica no fim e fora da conta', () => {
  const r = calcularTransferencias({ origem_id: 'banco', pontos: 20000 }, null, dadosDeTeste(), HOJE);
  const ultima = r.opcoes.at(-1);
  assert.equal(ultima.rota.id, 'banco-outra');
  assert.equal(ultima.calculavel, false);
  assert.match(ultima.motivo, /proporção/);
  // Hotel: 20.000 ÷ 7 = 2.857 blocos → 5.714 pontos × R$ 120,00 / mil = R$ 685,68 > aérea (R$ 560,00),
  // mas o ponto do hotel só vale como desconto na rede: as milhas aéreas vêm antes.
  assert.equal(r.opcoes[0].rota.id, 'banco-aerea');
  assert.equal(r.opcoes[1].rota.id, 'banco-hotel');
  assert.ok(r.opcoes[1].valor_destino > r.opcoes[0].valor_destino);
});

test('abaixo do mínimo vai para depois das rotas possíveis', () => {
  const r = calcularTransferencias({ origem_id: 'banco', pontos: 8000 }, null, dadosDeTeste(), HOJE);
  const o = rota(r, 'banco-aerea');
  assert.equal(o.abaixo_do_minimo, true);
  assert.ok(o.avisos.some((a) => a.includes('faltam 2.000')));
  assert.equal(r.opcoes[0].rota.id, 'banco-hotel');
});

test('milheiro do perfil vence o dos dados; sem milheiro de origem pede o custo', () => {
  const d = dadosDeTeste();
  const perfil = { valor_milheiro_brl: { aerea: 1000 } };
  const o = rota(calcularTransferencias({ origem_id: 'banco', pontos: 10000 }, perfil, d, HOJE), 'banco-aerea');
  assert.equal(o.valor_destino, 14000n * BI); // 14.000 × R$ 10,00 / 1.000
  d.programas[0].valor_milheiro_brl = 'A_CONFIRMAR';
  const sem = rota(calcularTransferencias({ origem_id: 'banco', pontos: 10000 }, null, d, HOJE), 'banco-aerea');
  assert.equal(sem.custo_milheiro_destino, null);
  assert.equal(sem.ganho, null);
  assert.ok(sem.avisos.some((a) => a.includes('quanto pagou')));
});

test('sem campanha hoje: bônus 0 e o passo diz isso', () => {
  const o = rota(calcularTransferencias({ origem_id: 'banco', pontos: 10000 }, null, dadosDeTeste(), '2026-11-26'), 'banco-aerea');
  assert.equal(o.bonus_percentual, 0);
  assert.ok(o.passos.some((p) => p.includes('0% de bônus')));
});

test('entrada inválida para', () => {
  const d = dadosDeTeste();
  assert.throws(() => calcularTransferencias({ origem_id: 'banco', pontos: -1 }, null, d, HOJE), /pontos/);
  assert.throws(() => calcularTransferencias({ origem_id: 'banco', pontos: 1.5 }, null, d, HOJE), /pontos/);
  assert.throws(() => calcularTransferencias({ origem_id: 'nada', pontos: 1 }, null, d, HOJE), /não existe/);
  assert.throws(() => calcularTransferencias({ pontos: 1 }, null, d, HOJE), /origem_id/);
  assert.throws(() => calcularTransferencias({ origem_id: 'banco', pontos: 1, faixa: 'x' }, null, d, HOJE), /faixa/);
  assert.throws(() => calcularTransferencias({ origem_id: 'banco', pontos: 1, bonus_manual: { aerea: 2000 } }, null, d, HOJE), /bônus/);
  assert.throws(() => calcularTransferencias({ origem_id: 'banco', pontos: 1, custo_milheiro_origem: 1.2 }, null, d, HOJE), /custo/);
  assert.throws(() => calcularTransferencias({ origem_id: 'banco', pontos: 1 }, null, d, '2026-13-01'), /data/);
});

test('mesma entrada, mesma saída', () => {
  const a = calcularTransferencias({ origem_id: 'banco', pontos: 12345 }, null, dadosDeTeste(), HOJE);
  const b = calcularTransferencias({ origem_id: 'banco', pontos: 12345 }, null, dadosDeTeste(), HOJE);
  assert.deepEqual(a, b);
});

test('campanhas de hoje e origens', () => {
  const c = campanhasDeHoje(dadosDeTeste(), HOJE);
  assert.equal(c.length, 1);
  assert.equal(c[0].maior_bonus, 80);
  assert.equal(c[0].termina_hoje, true);
  assert.equal(c[0].faixas_texto, '40% para todos os clientes; 80% para assinantes do clube');
  assert.deepEqual(origensDeTransferencia(dadosDeTeste()), [{ id: 'banco', nome: 'Banco Pontos' }]);
});

// ---------------------------------------------------------------------------
// Passagem e hotel

test('passagem nacional em real: categoria inicial por padrão, com aviso', () => {
  const r = calcularViagem({ tipo: 'passagem', trechos: 'nacional_e_america_do_sul', vendedor: 'Aérea', valor_centavos: 40000 }, null, dadosDeTeste(), HOJE);
  assert.equal(r.jeitos.length, 1);
  const j = r.jeitos[0];
  // R$ 400,00 × 1,5 = 600 milhas; × R$ 20,00 / 1.000 = R$ 12,00.
  assert.equal(j.pontos, 600n * PT);
  assert.equal(j.valor, 1200n * BI);
  assert.ok(j.avisos.some((a) => a.includes('a inicial')));
  assert.equal(r.respostas.tarifa, 'cheia');
  assert.deepEqual(r.perguntas, [{ pergunta_id: 'tarifa', pergunta: 'Qual tarifa?', respostas: [{ id: 'cheia', texto: 'Cheia' }, { id: 'basica', texto: 'Básica' }] }]);
});

test('passagem: categoria escolhida e categoria A_CONFIRMAR', () => {
  const d = dadosDeTeste();
  const top = calcularViagem({ tipo: 'passagem', trechos: 'nacional_e_america_do_sul', valor_centavos: 40000, niveis: { aerea: 'top' } }, null, d, HOJE);
  assert.equal(top.jeitos[0].pontos, 1400n * PT); // 400 × 3,5
  const nova = calcularViagem({ tipo: 'passagem', trechos: 'nacional_e_america_do_sul', valor_centavos: 40000, niveis: { aerea: 'nova' } }, null, d, HOJE);
  assert.equal(nova.jeitos[0].pontos, null);
  assert.ok(nova.jeitos[0].avisos.some((a) => a.includes('não estão confirmados')));
});

test('tarifa básica em dólar: usa a cotação e a regra que vale para qualquer trecho', () => {
  const r = calcularViagem({
    tipo: 'passagem', trechos: 'nacional_e_america_do_sul', valor_centavos: 50000, respostas: { tarifa: 'basica' },
  }, null, dadosDeTeste(), HOJE);
  // R$ 500,00 ÷ R$ 5,0000 = US$ 100 × 1 = 100 milhas.
  assert.equal(r.jeitos[0].regra.id, 'aerea-basica');
  assert.equal(r.jeitos[0].pontos, 100n * PT);
  assert.ok(r.jeitos[0].passos.some((p) => p.includes('US$ 100,00')));
});

test('internacional: cotação digitada vence a dos dados; teto por trecho avisa', () => {
  const r = calcularViagem({
    tipo: 'passagem', trechos: 'fora_da_america_do_sul', valor_centavos: 200000, cotacoes: { USD: 40000 },
  }, null, dadosDeTeste(), HOJE);
  // R$ 2.000,00 ÷ R$ 4,0000 = US$ 500 × 5 = 2.500 milhas (> teto de 1.000 por trecho).
  assert.equal(r.jeitos[0].pontos, 2500n * PT);
  assert.ok(r.jeitos[0].avisos.some((a) => a.includes('limita a 1.000')));
});

test('sem cotação nenhuma, a regra em dólar não inventa pontos', () => {
  const d = dadosDeTeste();
  d.cambio = [];
  const r = calcularViagem({ tipo: 'passagem', trechos: 'fora_da_america_do_sul', valor_centavos: 100000 }, null, d, HOJE);
  assert.equal(r.jeitos[0].pontos, null);
  assert.equal(r.jeitos[0].valor_total, null);
  assert.ok(r.jeitos[0].avisos.some((a) => a.includes('falta a cotação')));
});

test('hotel: compara reserva direta (euro) e site parceiro (real); regra vencida fica fora', () => {
  const r = calcularViagem({ tipo: 'hotel', valor_centavos: 120000 }, null, dadosDeTeste(), HOJE);
  // Direto: R$ 1.200 ÷ R$ 6,0000 = 200 € → 200/10 × 25 = 500 pontos × R$ 120,00 / mil = R$ 60,00.
  // Parceiro: 1.200 × 2 = 2.400 milhas × R$ 20,00 / mil = R$ 48,00.
  assert.deepEqual(r.jeitos.map((j) => j.regra.id), ['hotel-direto', 'hotel-parceiro']);
  assert.equal(r.jeitos[0].pontos, 500n * PT);
  assert.equal(r.jeitos[0].valor, 6000n * BI);
  assert.equal(r.jeitos[1].valor, 4800n * BI);
  assert.ok(r.jeitos[1].avisos.some((a) => a.includes('vale até 30/11/2026')));
  // Gold: 200/10 × 37 = 740 pontos.
  const gold = calcularViagem({ tipo: 'hotel', valor_centavos: 120000, niveis: { hotel: 'gold' } }, null, dadosDeTeste(), HOJE);
  assert.equal(gold.jeitos[0].pontos, 740n * PT);
});

test('cartão do perfil soma pontos sobre tarifa + taxas; escolhe o que vale mais', () => {
  const perfil = { cartoes: ['cartao-real', 'cartao-dolar', 'nao-existe'] };
  const r = calcularViagem({
    tipo: 'passagem', trechos: 'nacional_e_america_do_sul', valor_centavos: 40000, taxas_centavos: 10000,
  }, perfil, dadosDeTeste(), HOJE);
  // Total R$ 500. Cartão Real: 500 × 2 = 1.000 pontos × R$ 15 = R$ 15,00.
  // Cartão Dólar: 500 ÷ 5 × 4 = 400 milhas × R$ 20 = R$ 8,00. Vence o Real.
  assert.equal(r.cartao.cartao.id, 'cartao-real');
  assert.equal(r.cartao.esc, 1000n * PT);
  assert.equal(r.jeitos[0].valor_total, (1200n + 1500n) * BI);
  assert.equal(r.sem_cartao_no_perfil, false);
  const sem = calcularViagem({ tipo: 'hotel', valor_centavos: 1000 }, { cartoes: [] }, dadosDeTeste(), HOJE);
  assert.equal(sem.cartao, null);
  assert.equal(sem.sem_cartao_no_perfil, true);
});

test('viagem: entrada inválida para', () => {
  const d = dadosDeTeste();
  assert.throws(() => calcularViagem({ tipo: 'carro', valor_centavos: 1 }, null, d, HOJE), /tipo/);
  assert.throws(() => calcularViagem({ tipo: 'hotel', valor_centavos: -1 }, null, d, HOJE), /valor_centavos/);
  assert.throws(() => calcularViagem({ tipo: 'hotel', valor_centavos: 1, taxas_centavos: 0.5 }, null, d, HOJE), /taxas/);
  assert.throws(() => calcularViagem({ tipo: 'passagem', valor_centavos: 1 }, null, d, HOJE), /trechos/);
  assert.throws(() => calcularViagem({ tipo: 'hotel', valor_centavos: 1, cotacoes: { EUR: 0 } }, null, d, HOJE), /cotação/);
  assert.throws(() => calcularViagem({ tipo: 'hotel', valor_centavos: 1 }, { cotacao_dolar: 5.2 }, d, HOJE), /cotacao_dolar/);
  assert.throws(() => calcularViagem({ tipo: 'hotel', valor_centavos: 1 }, { valor_milheiro_brl: { x: -1 } }, d, HOJE), /milheiro/);
});

test('ajudantes da tela: vendedores, perguntas, níveis', () => {
  const d = dadosDeTeste();
  assert.deepEqual(vendedores(d, 'hotel'), ['Hotel direto', 'Site parceiro', 'Antigo']);
  assert.equal(regrasDaCompra(d, { tipo: 'hotel' }, HOJE).length, 2);
  assert.deepEqual(perguntasDasRegras([]), []);
  assert.deepEqual(niveisPorPrograma(d).map((p) => p.programa_id), ['aerea', 'hotel']);
});

// ---------------------------------------------------------------------------
// Dados reais (conferidos em 25/11/2026)

async function dadosReais() {
  const dados = {};
  for (const nome of ['programas', 'cartoes', 'cambio', 'cotacoes', 'transferencias', 'bonus-transferencia', 'viagens']) {
    dados[nome] = JSON.parse(await readFile(new URL(`../dados/${nome}.json`, import.meta.url), 'utf8'));
  }
  return dados;
}

test('dados reais: Livelo → Smiles com o bônus de 25/11/2026 (40% / 80%)', async () => {
  const d = await dadosReais();
  const r = calcularTransferencias({ origem_id: 'livelo', pontos: 50000 }, null, d, '2026-11-25');
  const smiles = rota(r, 'livelo-smiles');
  assert.equal(smiles.milhas_total, 70000n * PT); // 50.000 + 40%
  const clube = rota(calcularTransferencias({ origem_id: 'livelo', pontos: 50000, faixa: 'maior' }, null, d, '2026-11-25'), 'livelo-smiles');
  assert.equal(clube.milhas_total, 90000n * PT); // 50.000 + 80%
  // Milheiro Livelo estimado em R$ 17,00: 50.000 pontos = R$ 850,00; 850 / 90 = R$ 9,44 por mil Smiles.
  assert.equal(formatarValor(clube.custo_milheiro_destino), 'R$ 9,44');
  // Smiles fica em 1º. O ALL Accor vale mais em reais (1.000 pontos ALL = 20 € de desconto em
  // hotel Accor), mas só como desconto em hotel: vem depois das milhas aéreas, com aviso.
  assert.equal(r.opcoes[0].rota.id, 'livelo-smiles');
  const all = rota(r, 'livelo-all-accor');
  assert.equal(all.so_desconto, true);
  assert.ok(all.valor_destino > r.opcoes[0].valor_destino);
  assert.ok(all.avisos.some((a) => a.includes('Só compensa se você vai usar')));
  assert.equal(r.opcoes.filter((o) => o.calculavel && !o.abaixo_do_minimo).at(-1).rota.id, 'livelo-all-accor');
  // ALL: 50.000 ÷ 7 = 7.142 blocos (49.994 pontos Livelo) × 2 = 14.284 pontos ALL.
  assert.equal(rota(r, 'livelo-all-accor').milhas_total, 14284n * PT);
});

test('dados reais: LATAM Platinum, voo nacional de R$ 400 = 1.400 milhas (exemplo da própria LATAM)', async () => {
  const d = await dadosReais();
  const r = calcularViagem({
    tipo: 'passagem', trechos: 'nacional_e_america_do_sul', vendedor: 'LATAM', valor_centavos: 40000, niveis: { 'latam-pass': 'platinum' },
  }, null, d, '2026-11-25');
  assert.equal(formatarPontos(r.jeitos[0].pontos), '1.400');
});

test('dados reais: hotel Ibis de R$ 644,13 no Classic = 12,5 pontos (100 € ÷ 10 × 12,5)', async () => {
  const d = await dadosReais();
  const r = calcularViagem({
    tipo: 'hotel', vendedor: 'Hotéis Accor (reserva direta)', valor_centavos: 64413, respostas: { 'marca-accor': 'ibis' },
  }, null, d, '2026-11-25');
  assert.equal(r.jeitos[0].pontos, 125n * PT);
  // 125 pontos × (20 € × 6,4413 = R$ 128,826 por mil) = R$ 16,10
  assert.equal(formatarValor(r.jeitos[0].valor), 'R$ 16,10');
});
