// Tela "Quanto rende abastecer": leitura dos campos e textos (funções puras).
// O caminho completo no navegador está em testes/navegador/abastecer.spec.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  anuncioDoAbastecimento, fraseDoAbastecimento, lerLitros, mascaraPreco, textosAntesDeAbastecer,
  textoValidadeDoAbastecimento, tituloDoAbastecimento,
} from '../site/js/tela/abastecer-textos.js';

test('lerLitros: vírgula ou ponto, até 3 casas, em mililitros inteiros', () => {
  assert.deepEqual(lerLitros('40'), { ml: 40_000, erro: '' });
  assert.deepEqual(lerLitros('40,5'), { ml: 40_500, erro: '' });
  assert.deepEqual(lerLitros(' 40.25 L'), { ml: 40_250, erro: '' });
  assert.deepEqual(lerLitros('0,001 litros'), { ml: 1, erro: '' });
  assert.deepEqual(lerLitros('99999'), { ml: 99_999_000, erro: '' });
});

test('lerLitros: vazio, zero, texto e passou do limite dão erro em português', () => {
  assert.equal(lerLitros('').erro, 'Digite quantos litros você vai abastecer.');
  assert.equal(lerLitros(undefined).ml, null);
  assert.equal(lerLitros('0').erro, 'A quantidade precisa ser maior que zero.');
  assert.match(lerLitros('quarenta').erro, /^Use só números/);
  assert.match(lerLitros('40,5555').erro, /^Use só números/);
  assert.match(lerLitros('1.000,5').erro, /^Use só números/);
  assert.equal(lerLitros('99999,001').erro, 'O máximo é 99.999 litros.');
});

test('mascaraPreco: 3 casas, jeito caixa eletrônico; vazio = não informado', () => {
  assert.deepEqual(mascaraPreco('6299'), { milesimos: 6299, texto: '6,299' });
  assert.deepEqual(mascaraPreco('R$ 6,299'), { milesimos: 6299, texto: '6,299' });
  assert.deepEqual(mascaraPreco('6'), { milesimos: 6, texto: '0,006' });
  assert.deepEqual(mascaraPreco('123456'), { milesimos: 12345, texto: '12,345' });
  assert.deepEqual(mascaraPreco(''), { milesimos: null, texto: '' });
  assert.deepEqual(mascaraPreco('000'), { milesimos: null, texto: '' });
  assert.deepEqual(mascaraPreco(null), { milesimos: null, texto: '' });
});

const rede = { id: 'shell', nome: 'Shell' };
const comPrograma = {
  tipo: 'combustivel', rede, programa: { id: 'stix', nome: 'Stix' }, programa_do_posto: { id: 'stix', nome: 'Stix' }, cartao: null,
  total_pontos: 50, total_pontos_texto: '50', valor_estimado_em_reais: null,
  condicoes_a_cumprir: ['Pagar pelo app.'], prazo_de_credito: { texto: 'Caem em 2 dias úteis.' }, validade_dos_pontos: { texto: 'Valem 12 meses.' },
  validade_da_regra: { texto: 'Regra fixa do programa.' },
};

test('frase do card: programa do posto, com e sem cartão; só cartão; nada', () => {
  assert.equal(fraseDoAbastecimento(comPrograma), 'Abasteça nos postos Shell usando o Stix.');
  assert.equal(fraseDoAbastecimento({ ...comPrograma, cartao: { nome: 'Cartão A' } }), 'Abasteça nos postos Shell usando o Stix e pague com o cartão Cartão A.');
  const soCartao = { tipo: 'combustivel_so_cartao', rede: null, programa: { nome: 'Livelo' }, cartao: { nome: 'Cartão A' } };
  assert.equal(fraseDoAbastecimento(soCartao), 'Abasteça em qualquer posto e pague com o cartão Cartão A. Os pontos vão para o Livelo.');
  assert.equal(fraseDoAbastecimento({ ...soCartao, rede }), 'Abasteça nos postos Shell e pague com o cartão Cartão A. Os pontos vão para o Livelo.');
  assert.equal(fraseDoAbastecimento({ ...soCartao, cartao: null, programa: null }), 'Sem programa do posto e sem cartão, este abastecimento não rende pontos.');
});

test('validade e "antes de abastecer"', () => {
  assert.equal(textoValidadeDoAbastecimento(comPrograma), 'Validade da regra: Regra fixa do programa.');
  assert.equal(textoValidadeDoAbastecimento({ validade_da_regra: null }), 'Sem programa do posto: são só os pontos de sempre do cartão.');
  assert.deepEqual(textosAntesDeAbastecer(comPrograma), ['Pagar pelo app.', 'Caem em 2 dias úteis.', 'Valem 12 meses.']);
  assert.deepEqual(textosAntesDeAbastecer({ condicoes_a_cumprir: [], prazo_de_credito: null, validade_dos_pontos: null }), []);
});

test('título: litros ou reais, combustível no meio da frase e rede', () => {
  const comb = (nome) => ({ id: 'x', nome });
  assert.equal(tituloDoAbastecimento({ informado: 'litros', litros_texto: '40 litros', combustivel: comb('Gasolina comum') }), '40 litros de gasolina comum');
  assert.equal(tituloDoAbastecimento({ informado: 'reais', reais_texto: 'R$ 200,00', combustivel: comb('GNV (gás natural veicular)') }, 'Shell'), 'R$ 200,00 de GNV (gás natural veicular), nos postos Shell');
});

test('anúncio para leitor de tela', () => {
  const vazio = { jeitos: [], falta_preco: [] };
  assert.equal(anuncioDoAbastecimento(vazio, '40 litros de gnv'), 'Resultado para 40 litros de gnv: nenhum jeito de ganhar pontos encontrado.');
  assert.equal(anuncioDoAbastecimento({ ...vazio, falta_preco: [{}] }, 'X'), 'Resultado para X: informe o preço do litro para calcular.');
  assert.equal(anuncioDoAbastecimento({ jeitos: [comPrograma] }, 'X'), 'Resultado para X. O melhor jeito rende 50 pontos. Abasteça nos postos Shell usando o Stix.');
  const emReais = { ...comPrograma, total_pontos_texto: '1', total_pontos: 1, valor_estimado_em_reais: { texto: 'R$ 0,02' } };
  assert.equal(anuncioDoAbastecimento({ jeitos: [emReais, comPrograma] }, 'X'), 'Resultado para X. O melhor jeito rende R$ 0,02 em pontos (1 ponto). Abasteça nos postos Shell usando o Stix. Há mais 1 jeito logo abaixo.');
  const zero = { ...comPrograma, total_pontos: 0, total_pontos_texto: '0' };
  assert.match(anuncioDoAbastecimento({ jeitos: [zero, comPrograma, comPrograma] }, 'X'), /rende nenhum ponto\..*Há mais 2 jeitos/);
});

test('tela de abastecer não usa innerHTML nem guarda o preço do litro', async () => {
  for (const arquivo of ['../site/js/abastecer.js', '../site/js/tela/abastecer-resultado.js', '../site/js/tela/abastecer-textos.js']) {
    const texto = await readFile(new URL(arquivo, import.meta.url), 'utf8');
    assert.doesNotMatch(texto, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, arquivo);
    assert.doesNotMatch(texto, /localStorage\.setItem|sessionStorage|indexedDB|\.salvar\(/, arquivo);
  }
});
