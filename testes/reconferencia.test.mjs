// Lista semanal do que reconferir (scripts/reconferir.js e scripts/reconferencia/).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listarReconferencia, URGENCIAS } from '../scripts/reconferencia/lista.js';
import { textoDaReconferencia } from '../scripts/reconferencia/texto.js';
import { reconferir } from '../scripts/reconferir.js';
import { somarDias } from '../site/js/motor/datas.js';

const FONTE = 'https://exemplo.invalid/fonte';
const HOJE = '2026-11-22';
const conferido = (diasAtras) => somarDias(HOJE, -diasAtras);

function dados() {
  const oferta = (id, loja_id, diasAtras, extra = {}) => ({
    id, loja_id, programa_id: 'prog', regras: [{ condicao: {}, pontos_por_real: 5 }], escopo: 'todos_os_produtos',
    acumula_com_cartao: true, exige_cupom: false, inicio: '2026-10-01', fim: '2026-12-31', credito_prazo_dias: 30,
    link_oferta: 'A_CONFIRMAR', fonte_url: FONTE, verificado_em: conferido(diasAtras), ...extra,
  });
  return {
    programas: [{ id: 'prog', nome: 'Alfa Pontos', fonte_url: FONTE, verificado_em: conferido(20) }],
    cartoes: [
      { id: 'c-novo', nome: 'Novo', fonte_url: FONTE, verificado_em: conferido(0) },
      { id: 'c-velho', nome: 'Velho', fonte_url: FONTE, verificado_em: conferido(40) },
    ],
    cambio: [{ id: 'usd-brl', moeda: 'USD', fonte_url: FONTE, verificado_em: conferido(9) }],
    lojas: [
      { id: 'pouco-buscada', nome: 'Zeta', prioridade: 3, fonte_url: FONTE, verificado_em: conferido(0) },
      { id: 'sem-prioridade', nome: 'Alfa', fonte_url: FONTE, verificado_em: conferido(0) },
      { id: 'mais-buscada', nome: 'Beta', prioridade: 1, fonte_url: FONTE, verificado_em: conferido(16) },
      { id: 'em-dia', nome: 'Gama', prioridade: 2, fonte_url: FONTE, verificado_em: conferido(0) },
    ],
    ofertas: [
      oferta('beta-fica-antiga', 'mais-buscada', 9),
      oferta('beta-fora', 'mais-buscada', 31),
      oferta('beta-sai', 'mais-buscada', 25),
      oferta('zeta-antiga', 'pouco-buscada', 15),
      oferta('alfa-antiga', 'sem-prioridade', 20),
      oferta('gama-em-dia', 'em-dia', 8),
      oferta('zeta-vencida', 'pouco-buscada', 60, { fim: '2026-11-21' }),
    ],
  };
}

describe('quem entra na lista', () => {
  test('entra quem passa de 14 dias até o fim da semana (hoje + 6): 9 dias entra, 8 não', () => {
    const l = listarReconferencia(dados(), HOJE);
    const ids = [...l.lojas.flatMap((g) => g.itens), ...l.geral].map((i) => i.id);
    assert.ok(ids.includes('beta-fica-antiga'));
    assert.ok(ids.includes('usd-brl'));
    assert.ok(!ids.includes('gama-em-dia'));
    assert.ok(!ids.includes('c-novo'));
    assert.deepEqual(l.semana, { de: '2026-11-22', ate: '2026-11-28' });
  });

  test('oferta vencida fica no histórico e não entra', () => {
    const l = listarReconferencia(dados(), HOJE);
    assert.ok(!l.lojas.flatMap((g) => g.itens).some((i) => i.id === 'zeta-vencida'));
  });

  test('loja sem nada para reconferir não aparece', () => {
    assert.ok(!listarReconferencia(dados(), HOJE).lojas.some((g) => g.loja.id === 'em-dia'));
  });

  test('sem nada vencendo: lista vazia e texto diz isso', () => {
    const d = dados();
    for (const nome of ['programas', 'cartoes', 'cambio', 'lojas', 'ofertas']) for (const r of d[nome]) r.verificado_em = HOJE;
    const l = listarReconferencia(d, HOJE);
    assert.equal(l.total, 0);
    assert.match(textoDaReconferencia(l), /Nada para reconferir esta semana\./);
  });
});

describe('ordem de importância', () => {
  test('lojas pela prioridade (1 primeiro); sem prioridade no fim', () => {
    const l = listarReconferencia(dados(), HOJE);
    assert.deepEqual(l.lojas.map((g) => g.loja.nome), ['Beta', 'Zeta', 'Alfa']);
  });

  test('dentro da loja: fora do ranking, sai do ranking, antigo, fica antigo', () => {
    const beta = listarReconferencia(dados(), HOJE).lojas[0];
    assert.deepEqual(beta.itens.map((i) => [i.id, i.urgencia]), [
      ['beta-fora', URGENCIAS.FORA_DO_RANKING],
      ['beta-sai', URGENCIAS.SAI_DO_RANKING],
      ['mais-buscada', URGENCIAS.ANTIGO],
      ['beta-fica-antiga', URGENCIAS.FICA_ANTIGO],
    ]);
  });

  test('prazos: 30 dias de 25 atrás cai em 5 dias; 14 de 9 atrás, em 5', () => {
    const beta = listarReconferencia(dados(), HOJE).lojas[0];
    assert.equal(beta.itens.find((i) => i.id === 'beta-sai').conferir_ate, '2026-11-27');
    assert.equal(beta.itens.find((i) => i.id === 'beta-fica-antiga').conferir_ate, '2026-11-27');
    assert.equal(beta.itens.find((i) => i.id === 'beta-fora').conferir_ate, null);
  });

  test('cadastro geral: mais antigo primeiro; cartão com 40 dias só fica "antigo" (não sai da conta)', () => {
    const { geral } = listarReconferencia(dados(), HOJE);
    assert.deepEqual(geral.map((i) => [i.id, i.urgencia]), [
      ['c-velho', URGENCIAS.ANTIGO],
      ['prog', URGENCIAS.ANTIGO],
      ['usd-brl', URGENCIAS.FICA_ANTIGO],
    ]);
  });

  test('oferta de loja que não está no cadastro vai para o fim, com o id', () => {
    const d = dados();
    d.ofertas.push({ ...d.ofertas[0], id: 'orfa', loja_id: 'sumida', verificado_em: conferido(20) });
    const l = listarReconferencia(d, HOJE);
    assert.equal(l.lojas.at(-1).loja.nome, 'sumida');
  });
});

describe('texto e linha de comando', () => {
  test('texto em português, com fonte e prazos', () => {
    const texto = textoDaReconferencia(listarReconferencia(dados(), HOJE));
    assert.match(texto, /O que reconferir na semana de 22\/11\/2026 a 28\/11\/2026/);
    assert.match(texto, /1\. Beta \(prioridade 1\)\n {3}- Oferta Alfa Pontos: conferido em 22\/10\/2026, há 31 dias\. JÁ SAIU DO RANKING/);
    assert.match(texto, /Sai do ranking se não for conferida até 27\/11\/2026\./);
    assert.match(texto, /Já aparece com aviso de dado antigo\./);
    assert.match(texto, /Ganha aviso de dado antigo se não for conferido até 27\/11\/2026\./);
    assert.match(texto, /3\. Alfa \(sem prioridade\)/);
    assert.match(texto, /Vale para todas as lojas\n {3}- Cartão Velho/);
    assert.match(texto, /Fonte: https:\/\/exemplo\.invalid\/fonte/);
    assert.match(texto, /Total: 9 itens\./);
  });

  test('oferta em conferência aparece marcada', () => {
    const d = dados();
    d.ofertas[0].status = 'A_CONFIRMAR';
    assert.match(textoDaReconferencia(listarReconferencia(d, HOJE)), /Oferta Alfa Pontos \(em conferência\)/);
  });

  test('reconferir() com os dados do repositório: texto e JSON; data inválida é recusada', async () => {
    const pastaDados = new URL('../dados/', import.meta.url);
    assert.match(await reconferir({ pastaDados, hoje: '2026-12-03' }), /O que reconferir na semana de 03\/12\/2026/);
    const json = JSON.parse(await reconferir({ pastaDados, hoje: '2026-12-03', json: true }));
    assert.equal(json.lojas[0].loja.id, 'magalu');
    await assert.rejects(reconferir({ pastaDados, hoje: '2026-02-30' }), /data inválida/);
  });

  test('npm run reconferir roda na linha de comando', () => {
    const script = fileURLToPath(new URL('../scripts/reconferir.js', import.meta.url));
    const saida = execFileSync(process.execPath, [script, '--hoje', '2026-11-22']).toString();
    assert.match(saida, /O que reconferir na semana de 22\/11\/2026 a 28\/11\/2026/);
  });
});
