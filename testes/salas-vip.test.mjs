// Salas VIP pelo cartão (site/js/motor/salas-vip.js) e os dados reais de salas-vip.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  cartoesComSalaVip, ouAConfirmar, pesoDosAcessos, textoDosAcessos, ultimaConferencia,
} from '../site/js/motor/salas-vip.js';

const FONTE = 'https://exemplo.invalid/teste';
const cartao = (id, nome) => ({ id, nome, emissor: 'X', bandeira: 'Visa', programa_id: 'p', fonte_url: FONTE, verificado_em: '2026-11-26' });
const sala = (id, cartao_id, acessos, extra = {}) => ({
  id, cartao_id, rede: 'Rede', acessos_por_ano: acessos, quem_usa: 'Titular', acompanhantes: 'A_CONFIRMAR',
  status: 'confirmado', fonte_url: FONTE, verificado_em: '2026-11-20', ...extra,
});

const DADOS = {
  cartoes: [cartao('dois', 'Cartão Dois'), cartao('livre', 'Cartão Livre'), cartao('quatro', 'Cartão Quatro'),
    cartao('nada', 'Cartão Nada'), cartao('duvida', 'Cartão Dúvida'), cartao('combo', 'Cartão Combo')],
  'salas-vip': [
    sala('s-dois', 'dois', 2),
    sala('s-livre', 'livre', 'ilimitado'),
    sala('s-quatro', 'quatro', 4, { verificado_em: '2026-11-26' }),
    sala('s-duvida', 'duvida', 'A_CONFIRMAR', { status: 'A_CONFIRMAR' }),
    sala('s-combo-a', 'combo', 2),
    sala('s-combo-b', 'combo', 2),
  ],
};

test('peso: ilimitado > número > a confirmar', () => {
  assert.ok(pesoDosAcessos(sala('a', 'x', 'ilimitado')) > pesoDosAcessos(sala('b', 'x', 99)));
  assert.equal(pesoDosAcessos(sala('c', 'x', 3)), 3);
  assert.equal(pesoDosAcessos(sala('d', 'x', 'A_CONFIRMAR', { status: 'A_CONFIRMAR' })), -1);
  assert.equal(pesoDosAcessos(sala('e', 'x', 5, { status: 'A_CONFIRMAR' })), -1);
  // Ilimitado só voando com a companhia vale menos que 1 acesso que serve para qualquer viagem.
  const restrito = pesoDosAcessos(sala('f', 'x', 'ilimitado', { condicoes: 'Só voando com a companhia.' }));
  assert.ok(restrito < pesoDosAcessos(sala('g', 'x', 1)) && restrito > 0);
});

test('texto dos acessos', () => {
  assert.equal(textoDosAcessos(sala('a', 'x', 1)), '1 acesso grátis por ano');
  assert.equal(textoDosAcessos(sala('a', 'x', 4)), '4 acessos grátis por ano');
  assert.equal(textoDosAcessos(sala('a', 'x', 'ilimitado')), 'Acesso ilimitado');
  assert.equal(textoDosAcessos(sala('a', 'x', 'A_CONFIRMAR', { status: 'A_CONFIRMAR' })), 'Número de acessos a confirmar');
  assert.equal(ouAConfirmar('A_CONFIRMAR'), 'A confirmar');
  assert.equal(ouAConfirmar(undefined, 'Rede a confirmar'), 'Rede a confirmar');
  assert.equal(ouAConfirmar('Titular'), 'Titular');
});

test('ordem: ilimitado primeiro, depois mais acessos (somando as redes), a confirmar por último; sem sala à parte', () => {
  const { comSala, semInformacao } = cartoesComSalaVip(DADOS);
  assert.deepEqual(comSala.map((c) => c.cartao.id), ['livre', 'quatro', 'combo', 'dois', 'duvida']);
  assert.deepEqual(comSala.find((c) => c.cartao.id === 'combo').salas.map((s) => s.id), ['s-combo-a', 's-combo-b']);
  assert.deepEqual(semInformacao.map((c) => c.id), ['nada']);
});

test('filtro pelos cartões do perfil', () => {
  const { comSala, semInformacao } = cartoesComSalaVip(DADOS, { cartoes: ['dois', 'nada'] });
  assert.deepEqual(comSala.map((c) => c.cartao.id), ['dois']);
  assert.deepEqual(semInformacao.map((c) => c.id), ['nada']);
  assert.deepEqual(cartoesComSalaVip(DADOS, { cartoes: [] }).comSala, []);
});

test('sem dados não quebra', () => {
  assert.deepEqual(cartoesComSalaVip({}), { comSala: [], semInformacao: [] });
  assert.equal(ultimaConferencia({}), null);
  assert.equal(ultimaConferencia(DADOS), '2026-11-26');
});

test('dados reais: todo registro aponta para cartão do cadastro e tem fonte https', async () => {
  const ler = async (n) => JSON.parse(await readFile(new URL(`../dados/${n}.json`, import.meta.url), 'utf8'));
  const dados = { cartoes: await ler('cartoes'), 'salas-vip': await ler('salas-vip') };
  const ids = new Set(dados.cartoes.map((c) => c.id));
  for (const s of dados['salas-vip']) {
    assert.ok(ids.has(s.cartao_id), s.id);
    assert.match(s.fonte_url, /^https:\/\//, s.id);
  }
  const { comSala, semInformacao } = cartoesComSalaVip(dados);
  assert.equal(comSala.length + semInformacao.length, dados.cartoes.length);
  // Conferido em 26/11/2026: o Aeternum dá acesso ilimitado (Bradesco Lounge e Visa Airport Companion).
  assert.equal(comSala[0].cartao.id, 'bradesco-aeternum');
  assert.equal(comSala[1].cartao.id, 'porto-visa-infinite');
  assert.equal(comSala.at(-1).cartao.id, 'santander-unlimited');
});

test('ilimitado com condição avisa no próprio texto', () => {
  assert.equal(textoDosAcessos(sala('a', 'x', 'ilimitado', { condicoes: 'Só voando com a companhia.' })), 'Acesso ilimitado, com condições');
});
