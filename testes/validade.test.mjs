// Validade dos pontos (site/js/motor/validade.js) e os dados reais de programas.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DIAS_ATENCAO, DIAS_URGENTE, avisosDeVencimento, avisosQuePedemAtencao, nivelDoVencimento, prazoDoPrograma, textoDoPrazo,
} from '../site/js/motor/validade.js';

const FONTE = 'https://exemplo.invalid/teste';
const HOJE = '2026-11-26';
const PROGRAMAS = [
  { id: 'aerea', nome: 'Aérea', validade_pontos: { meses: 24, resumo: 'R.', como_prorrogar: 'Voar.', fonte_url: FONTE, verificado_em: HOJE } },
  { id: 'banco', nome: 'Banco', validade_pontos: { meses: 'depende_do_cartao', resumo: 'R.', fonte_url: FONTE, verificado_em: HOJE } },
  { id: 'nunca', nome: 'Nunca', validade_pontos: { meses: 'nao_expira', resumo: 'R.', fonte_url: FONTE, verificado_em: HOJE } },
  { id: 'duvida', nome: 'Dúvida', validade_pontos: { meses: 'A_CONFIRMAR', resumo: 'R.', fonte_url: FONTE, verificado_em: HOJE } },
  { id: 'sem', nome: 'Sem regra' },
];

test('nível do aviso: vencido, até 30 dias, até 90 dias, depois disso', () => {
  assert.equal(nivelDoVencimento(-1), 'vencido');
  assert.equal(nivelDoVencimento(0), 'urgente');
  assert.equal(nivelDoVencimento(DIAS_URGENTE), 'urgente');
  assert.equal(nivelDoVencimento(DIAS_URGENTE + 1), 'atencao');
  assert.equal(nivelDoVencimento(DIAS_ATENCAO), 'atencao');
  assert.equal(nivelDoVencimento(DIAS_ATENCAO + 1), 'tranquilo');
});

test('texto do prazo em português simples', () => {
  assert.equal(textoDoPrazo(0), 'vence hoje');
  assert.equal(textoDoPrazo(1), 'vence amanhã');
  assert.equal(textoDoPrazo(12), 'vence em 12 dias');
  assert.equal(textoDoPrazo(-1), 'venceu ontem');
  assert.equal(textoDoPrazo(-3), 'venceu há 3 dias');
});

test('avisos: só programas marcados com data, do mais perto ao mais longe, contando o virar do mês', () => {
  const perfil = {
    programas: [
      { programa_id: 'banco', clube_ativo: false, pontos_vencem_em: '2027-03-01' }, // 95 dias
      { programa_id: 'aerea', clube_ativo: false, pontos_vencem_em: '2026-12-01' }, // 5 dias (novembro tem 30)
      { programa_id: 'nunca', clube_ativo: false },
      { programa_id: 'sumiu', clube_ativo: false, pontos_vencem_em: '2026-12-01' },
      { programa_id: 'duvida', clube_ativo: false, pontos_vencem_em: '2026-11-20' }, // venceu há 6 dias
    ],
  };
  const avisos = avisosDeVencimento(perfil, PROGRAMAS, HOJE);
  assert.deepEqual(avisos.map((a) => [a.programa_id, a.dias, a.nivel]), [
    ['duvida', -6, 'vencido'],
    ['aerea', 5, 'urgente'],
    ['banco', 95, 'tranquilo'],
  ]);
  assert.equal(avisos[1].texto, 'vence em 5 dias');
  assert.deepEqual(avisosQuePedemAtencao(avisos).map((a) => a.programa_id), ['duvida', 'aerea']);
});

test('avisos: sem perfil ou sem datas, lista vazia', () => {
  assert.deepEqual(avisosDeVencimento(null, PROGRAMAS, HOJE), []);
  assert.deepEqual(avisosDeVencimento({ programas: [{ programa_id: 'aerea', clube_ativo: false }] }, PROGRAMAS, HOJE), []);
});

test('regra do programa: frase curta para cada tipo de prazo', () => {
  assert.equal(prazoDoPrograma(PROGRAMAS[0]).curto, 'Prazo padrão: 24 meses');
  assert.equal(prazoDoPrograma(PROGRAMAS[0]).comoProrrogar, 'Voar.');
  assert.equal(prazoDoPrograma(PROGRAMAS[1]).curto, 'O prazo depende do cartão');
  assert.equal(prazoDoPrograma(PROGRAMAS[1]).comoProrrogar, null);
  assert.equal(prazoDoPrograma(PROGRAMAS[2]).curto, 'Os pontos não expiram');
  assert.equal(prazoDoPrograma(PROGRAMAS[3]).curto, 'Prazo padrão a confirmar');
  assert.equal(prazoDoPrograma(PROGRAMAS[4]), null);
});

test('dados reais: todo programa tem validade com fonte oficial https e data de conferência', async () => {
  const programas = JSON.parse(await readFile(new URL('../dados/programas.json', import.meta.url), 'utf8'));
  for (const p of programas) {
    const v = p.validade_pontos;
    assert.ok(v, `${p.id} sem validade_pontos`);
    assert.match(v.fonte_url, /^https:\/\//, p.id);
    assert.match(v.verificado_em, /^\d{4}-\d{2}-\d{2}$/, p.id);
    if (v.como_prorrogar_fonte_url) assert.match(v.como_prorrogar_fonte_url, /^https:\/\//, p.id);
  }
  const porId = Object.fromEntries(programas.map((p) => [p.id, p.validade_pontos.meses]));
  // Números conferidos nas páginas oficiais em 26/11/2026.
  assert.equal(porId['latam-pass'], 24);
  assert.equal(porId.smiles, 36);
  assert.equal(porId['all-accor'], 12);
  assert.equal(porId['c6-atomos'], 'nao_expira');
  assert.equal(porId.esfera, 'depende_do_cartao');
});
