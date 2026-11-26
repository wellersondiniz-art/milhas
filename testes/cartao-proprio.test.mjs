// "Meu cartão não está na lista": cartão informado pela pessoa (formato, conta,
// importação) e "Pedir esse cartão" (tela e servidor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ANUIDADE_MAXIMA, CARTOES_PROPRIOS_MAXIMO, PONTOS_MAXIMO, dadosComCartoesDaPessoa, ehCartaoProprio, ehVazio, lerPontosDigitados,
  limparNomeDoCartao, limparPerfil, migrar, novoIdProprio, perfilComCartaoProprio, perfilDeTodos, perfilParaConta, perfilSemCartaoProprio,
  perfilSemCartoesDaPessoa, pontosValidos,
  registroDoCartaoProprio, semNadaParaGuardar, textoParaExportar, validarCartaoProprio, validarImportacao,
} from '../site/js/perfil/formato.js';
import { calcularJeitosDeComprar } from '../site/js/motor/index.js';
import { perfilComAjuste } from '../site/js/tela/primeira-visita.js';
import { lerCartaoDigitado, mascaraAnuidade, resumoDoCartaoProprio } from '../site/js/perfil/cartao-digitado.js';
import { conferirPedidoNaTela, corpoDoPedidoDeCartao, LIMITES_DO_PEDIDO_NA_TELA } from '../site/js/reporte/conferir-pedido.js';
import { montarCorpo } from '../site/js/alertas/pedido.js';
import {
  ETIQUETAS, LIMITES, LIMITES_DO_PEDIDO, montarIssueDoPedido, validarPedidoDeCartao,
} from '../servidor/reportar/regras.js';
import { MENSAGENS, tratarReporte } from '../servidor/reportar/pedido.js';

const FONTE = 'https://exemplo.invalid/teste';
const DADOS = {
  programas: [
    { id: 'prog-a', nome: 'Programa A', tipo: 'milhas', valor_milheiro_brl: 2000, url: FONTE, fonte_url: FONTE, verificado_em: '2026-11-20' },
    { id: 'prog-b', nome: 'Programa B', tipo: 'pontos', valor_milheiro_brl: 'A_CONFIRMAR', url: FONTE, fonte_url: FONTE, verificado_em: '2026-11-20' },
  ],
  cartoes: [
    { id: 'cartao-a', nome: 'Cartão A', emissor: 'X', bandeira: 'Y', programa_id: 'prog-a', pontos_por_real: 1, anuidade_brl: 0, observacoes: '', fonte_url: FONTE, verificado_em: '2026-11-20', status: 'confirmado' },
  ],
  lojas: [
    { id: 'loja-a', nome: 'Loja A', dominio: 'A_CONFIRMAR', categoria: 'A_CONFIRMAR', aceita_cupom: 'A_CONFIRMAR', observacoes: '', fonte_url: FONTE, verificado_em: '2026-11-20' },
  ],
  ofertas: [],
  cambio: [],
};
const HOJE = '2026-11-26';
const PROGRAMAS = new Set(DADOS.programas.map((p) => p.id));
const MEU = Object.freeze({ id: 'meu-1', nome: 'Cartão Z Gold', programa_id: 'prog-a', pontos_por_real: 2.5, anuidade_brl: 48000 });

// ---------------------------------------------------------------------------
// Formato

test('cartão próprio: id "meu-N", que nunca bate com o cadastro', () => {
  assert.equal(ehCartaoProprio('meu-1'), true);
  assert.equal(ehCartaoProprio('meu-10'), true);
  for (const ruim of ['meu-0', 'meu-', 'meu-a', 'meu-1000', 'cartao-a', 'MEU-1', 1, null]) assert.equal(ehCartaoProprio(ruim), false, String(ruim));
  assert.equal(novoIdProprio(undefined), 'meu-1');
  assert.equal(novoIdProprio([{ id: 'meu-1' }, { id: 'meu-3' }]), 'meu-2');
  const cheio = Array.from({ length: CARTOES_PROPRIOS_MAXIMO }, (_, i) => ({ id: `meu-${i + 1}` }));
  assert.equal(novoIdProprio(cheio), null);
});

test('pontos digitados: vírgula ou ponto, até 2 casas', () => {
  assert.equal(lerPontosDigitados(''), undefined);
  assert.equal(lerPontosDigitados('  '), undefined);
  assert.equal(lerPontosDigitados('2'), 2);
  assert.equal(lerPontosDigitados('2,5'), 2.5);
  assert.equal(lerPontosDigitados('1.75'), 1.75);
  for (const ruim of ['2,555', 'abc', '-1', '1e3', '2,', '1.000,5']) assert.equal(lerPontosDigitados(ruim), null, ruim);
  assert.equal(pontosValidos(PONTOS_MAXIMO), true);
  assert.equal(pontosValidos(PONTOS_MAXIMO + 0.01), false);
  assert.equal(pontosValidos(0), false);
  assert.equal(pontosValidos(1.234), false);
  assert.equal(pontosValidos(Number.NaN), false);
});

test('nome do cartão: limpa invisíveis e espaços', () => {
  assert.equal(limparNomeDoCartao('  Cartão​   Z\nGold '), 'Cartão Z Gold');
});

test('conferência do cartão próprio: aceita o certo e devolve só os campos conhecidos', () => {
  const r = validarCartaoProprio({ ...MEU, nome: '  Cartão Z   Gold ' }, PROGRAMAS);
  assert.deepEqual(r, { ok: true, cartao: { ...MEU } });
  const soDolar = validarCartaoProprio({ id: 'meu-2', nome: 'Black', programa_id: 'prog-b', pontos_por_dolar: 3 }, PROGRAMAS);
  assert.deepEqual(soDolar, { ok: true, cartao: { id: 'meu-2', nome: 'Black', programa_id: 'prog-b', pontos_por_dolar: 3 } });
  assert.equal(validarCartaoProprio({ ...MEU, anuidade_brl: 0 }, PROGRAMAS).ok, true);
});

test('conferência do cartão próprio: recusa número de cartão, CPF e valores fora do formato', () => {
  const erros = (extra) => validarCartaoProprio({ ...MEU, ...extra }, PROGRAMAS).erros ?? {};
  assert.match(erros({ nome: '4111 1111 1111 1111' }).nome, /Nunca o número do cartão/);
  assert.match(erros({ nome: '123.456.789-09' }).nome, /Nunca o número do cartão nem o CPF/);
  assert.ok(erros({ nome: 'x' }).nome);
  assert.ok(erros({ nome: 'a'.repeat(61) }).nome);
  assert.ok(erros({ nome: '<script>' }).nome);
  assert.ok(erros({ programa_id: 'nao-existe' }).programa_id);
  assert.ok(erros({ pontos_por_real: 0 }).pontos_por_real);
  assert.ok(erros({ pontos_por_real: 21 }).pontos_por_real);
  assert.ok(erros({ pontos_por_real: '2' }).pontos_por_real);
  assert.ok(erros({ pontos_por_dolar: 1.001 }).pontos_por_dolar);
  assert.ok(erros({ anuidade_brl: 12.5 }).anuidade_brl);
  assert.ok(erros({ anuidade_brl: -1 }).anuidade_brl);
  assert.ok(erros({ anuidade_brl: ANUIDADE_MAXIMA + 1 }).anuidade_brl);
  assert.ok(erros({ id: 'cartao-a' }).id);
  assert.ok(erros({ numero: '4111' }).geral);
  const { pontos_por_real: _p, ...semPontos } = MEU;
  assert.match(validarCartaoProprio(semPontos, PROGRAMAS).erros.pontos_por_real, /por real ou por dólar/);
  assert.equal(validarCartaoProprio(null, PROGRAMAS).ok, false);
  assert.equal(validarCartaoProprio([], PROGRAMAS).ok, false);
});

test('registro do cartão próprio: formato de cartoes.json, sem fonte e marcado como informado', () => {
  const r = registroDoCartaoProprio(MEU);
  assert.equal(r.informado_pela_pessoa, true);
  assert.equal(r.status, 'confirmado');
  assert.equal(r.pontos_por_real, 2.5);
  assert.equal(r.anuidade_brl, 48000);
  assert.equal('fonte_url' in r, false);
  assert.equal('verificado_em' in r, false);
  const soDolar = registroDoCartaoProprio({ id: 'meu-2', nome: 'B', programa_id: 'prog-b', pontos_por_dolar: 3 });
  assert.equal(soDolar.pontos_por_real, 'A_CONFIRMAR');
  assert.equal(soDolar.pontos_por_dolar, 3);
  assert.equal(soDolar.anuidade_brl, 'A_CONFIRMAR');
});

test('dados da conta: cartões da pessoa no fim; sem cartão próprio, os mesmos dados', () => {
  assert.equal(dadosComCartoesDaPessoa(DADOS, null), DADOS);
  assert.equal(dadosComCartoesDaPessoa(DADOS, { programas: [], cartoes: [] }), DADOS);
  const d = dadosComCartoesDaPessoa(DADOS, { programas: [], cartoes: [], cartoes_proprios: [MEU] });
  assert.deepEqual(d.cartoes.map((c) => c.id), ['cartao-a', 'meu-1']);
  assert.equal(DADOS.cartoes.length, 1, 'não mexe nos dados do site');
});

test('perfil guardado: cartão próprio sobrevive à limpeza; quebrado ou repetido sai calado', () => {
  const bruto = {
    versao: 2,
    programas: [{ programa_id: 'prog-a', clube_ativo: false }],
    cartoes: ['meu-1', 'meu-9', 'cartao-a'],
    valor_milheiro_brl: {},
    cartoes_proprios: [MEU, { ...MEU }, { id: 'meu-2', nome: '4111111111111111', programa_id: 'prog-a', pontos_por_real: 1 }, 'lixo'],
  };
  const p = limparPerfil(bruto, DADOS);
  assert.deepEqual(p.cartoes_proprios, [MEU]);
  assert.deepEqual(p.cartoes, ['meu-1', 'cartao-a'], 'meu-9 não existe mais');
  assert.equal(limparPerfil({ ...bruto, cartoes_proprios: 'x' }, DADOS).cartoes_proprios, undefined);
  assert.equal(migrar({ programas: [], cartoes: [], cartoes_proprios: [] }).cartoes_proprios, undefined);
  const muitos = Array.from({ length: CARTOES_PROPRIOS_MAXIMO + 3 }, (_, i) => ({ ...MEU, id: `meu-${i + 1}` }));
  assert.equal(limparPerfil({ ...bruto, cartoes_proprios: muitos }, DADOS).cartoes_proprios.length, CARTOES_PROPRIOS_MAXIMO);
});

test('perfil só com cartão próprio desmarcado ainda é guardado (não é "nada")', () => {
  const p = { versao: 2, programas: [], cartoes: [], valor_milheiro_brl: {}, cartoes_proprios: [MEU] };
  assert.equal(ehVazio(p), true);
  assert.equal(semNadaParaGuardar(p), false);
});

test('exportar e importar: o cartão próprio vai e volta igual', () => {
  const perfil = { versao: 2, programas: [{ programa_id: 'prog-a', clube_ativo: false }], cartoes: ['meu-1'], valor_milheiro_brl: {}, cartoes_proprios: [MEU] };
  const texto = textoParaExportar(perfil, '2026-11-26T10:00:00.000Z');
  assert.deepEqual(JSON.parse(texto).cartoes_proprios, [MEU]);
  const r = validarImportacao(texto, DADOS, HOJE);
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.deepEqual(r.perfil.cartoes_proprios, [MEU]);
  assert.deepEqual(r.perfil.cartoes, ['meu-1']);
  // Sem cartão próprio, o campo nem aparece.
  assert.equal('cartoes_proprios' in JSON.parse(textoParaExportar({ ...perfil, cartoes: [], cartoes_proprios: undefined }, 'x')), false);
});

test('importar: cartão próprio fora do formato reprova o arquivo inteiro', () => {
  const base = { app: 'comprador-de-milhas', versao: 2, programas: [], cartoes: [], valor_milheiro_brl: {} };
  const importar = (extra) => validarImportacao(JSON.stringify({ ...base, ...extra }), DADOS, HOJE);
  const comNumero = importar({ cartoes_proprios: [{ ...MEU, nome: '4111 1111 1111 1111' }] });
  assert.equal(comNumero.ok, false);
  assert.match(comNumero.erros[0], /Cartão adicionado nº 1: .*Nunca o número/);
  assert.equal(importar({ cartoes_proprios: {} }).ok, false);
  assert.match(importar({ cartoes_proprios: [MEU, MEU] }).erros[0], /mais de uma vez/);
  const muitos = Array.from({ length: CARTOES_PROPRIOS_MAXIMO + 1 }, (_, i) => ({ ...MEU, id: `meu-${i + 1}` }));
  assert.match(importar({ cartoes_proprios: muitos }).erros[0], /Há mais de 10/);
  // Marcado sem existir: "não conhecemos".
  assert.match(importar({ cartoes: ['meu-1'] }).erros.join(' '), /não conhecemos o cartão "meu-1"/);
});

test('o que sai do aparelho (alertas, "Explica pra mim") vai sem os cartões da pessoa', () => {
  const perfil = { versao: 2, programas: [], cartoes: ['cartao-a', 'meu-1'], valor_milheiro_brl: {}, cartoes_proprios: [MEU] };
  const limpo = perfilSemCartoesDaPessoa(perfil);
  assert.deepEqual(limpo.cartoes, ['cartao-a']);
  assert.equal('cartoes_proprios' in limpo, false);
  assert.equal(perfilSemCartoesDaPessoa(null), null);
  assert.equal(perfilSemCartoesDaPessoa(undefined), null);
  const corpo = montarCorpo({ email: 'a@b.com', loja_id: 'loja-a', programa_id: '', pontos_por_real: '5', consentimento: true }, perfil, 5000);
  assert.deepEqual(corpo.perfil, { programas: [], cartoes: ['cartao-a'] });
});

// ---------------------------------------------------------------------------
// Conta

test('conta: o cartão próprio rende como qualquer cartão e sai marcado como informado', () => {
  const perfil = { versao: 2, programas: [{ programa_id: 'prog-a', clube_ativo: false }], cartoes: ['meu-1'], valor_milheiro_brl: {}, cartoes_proprios: [MEU] };
  const dados = dadosComCartoesDaPessoa(DADOS, perfil);
  const jeitos = calcularJeitosDeComprar(perfilParaConta(perfil), { loja_id: 'loja-a', valor_centavos: 10000, tipo_vendedor: 'loja' }, dados, HOJE);
  assert.equal(jeitos.length, 1);
  assert.deepEqual(jeitos[0].cartao, { id: 'meu-1', nome: 'Cartão Z Gold', informado_pela_pessoa: true });
  assert.equal(jeitos[0].pontos_do_cartao, 250); // R$ 100,00 × 2,5
  assert.equal(jeitos[0].valor_estimado_em_reais.texto, 'R$ 5,00'); // 250 × R$ 20,00 / 1.000
  assert.deepEqual(jeitos[0].conferido_em.filter((c) => c.rotulo.includes('Cartão Z')), [], 'sem selo de fonte para o cartão da pessoa');
});

test('conta: cartão do cadastro não ganha a marca de informado', () => {
  const jeitos = calcularJeitosDeComprar({ programas: [], cartoes: ['cartao-a'] }, { loja_id: 'loja-a', valor_centavos: 10000, tipo_vendedor: 'loja' }, DADOS, HOJE);
  assert.deepEqual(jeitos[0].cartao, { id: 'cartao-a', nome: 'Cartão A' });
});

test('conta: cartão próprio só por dólar usa a cotação; sem cotação, conta 0', () => {
  const meu = { id: 'meu-2', nome: 'Cartão W', programa_id: 'prog-a', pontos_por_dolar: 2 };
  const perfil = { versao: 2, programas: [], cartoes: ['meu-2'], valor_milheiro_brl: {}, cartoes_proprios: [meu] };
  const dados = dadosComCartoesDaPessoa(DADOS, perfil);
  const compra = { loja_id: 'loja-a', valor_centavos: 50000, tipo_vendedor: 'loja' };
  const sem = calcularJeitosDeComprar(perfilParaConta(perfil), compra, dados, HOJE);
  assert.equal(sem[0].pontos_do_cartao, 0);
  const com = calcularJeitosDeComprar(perfilParaConta({ ...perfil, cotacao_dolar: 50000 }), compra, dados, HOJE);
  assert.equal(com[0].pontos_do_cartao, 200); // R$ 500 ÷ 5,00 × 2
});

test('perfil vazio: "todos os cartões" inclui os da pessoa', () => {
  const perfil = { versao: 2, programas: [], cartoes: [], valor_milheiro_brl: {}, cartoes_proprios: [MEU] };
  const todos = perfilDeTodos(dadosComCartoesDaPessoa(DADOS, perfil));
  assert.deepEqual(todos.cartoes, ['cartao-a', 'meu-1']);
});

test('ajuste rápido guarda os cartões da pessoa e aceita escolher um deles', () => {
  const perfil = { versao: 2, programas: [{ programa_id: 'prog-b', clube_ativo: false }], cartoes: ['cartao-a'], valor_milheiro_brl: {}, cartoes_proprios: [MEU] };
  const novo = perfilComAjuste(perfil, dadosComCartoesDaPessoa(DADOS, perfil), { cartao: 'meu-1' });
  assert.deepEqual(novo.cartoes, ['meu-1']);
  assert.deepEqual(novo.cartoes_proprios, [MEU]);
  assert.ok(novo.programas.some((p) => p.programa_id === 'prog-a'), 'o programa do cartão entra');
  assert.notEqual(novo.cartoes_proprios[0], perfil.cartoes_proprios[0], 'cópia, não a mesma referência');
  assert.equal('cartoes_proprios' in perfilComAjuste(null, DADOS, { cartao: 'nenhum' }), false);
});

// ---------------------------------------------------------------------------
// Tela (partes puras)

test('formulário "Adicionar meu cartão": lê o que foi digitado', () => {
  const nomes = new Map(DADOS.programas.map((p) => [p.id, p.nome]));
  const r = lerCartaoDigitado({ nome: 'Cartão Z Gold', programa_id: 'prog-a', pontos_por_real: '2,5', pontos_por_dolar: '', anuidade: '48000' }, nomes, 'meu-1');
  assert.deepEqual(r, { ok: true, cartao: MEU });
  const ruim = lerCartaoDigitado({ nome: '', programa_id: '', pontos_por_real: 'dois', pontos_por_dolar: '', anuidade: '' }, nomes, 'meu-1');
  assert.deepEqual(Object.keys(ruim.erros).sort(), ['nome', 'pontos_por_real', 'programa_id']);
  const vazio = lerCartaoDigitado({ nome: 'X Black', programa_id: 'prog-a', pontos_por_real: '', pontos_por_dolar: '', anuidade: '' }, nomes, 'meu-1');
  assert.match(vazio.erros.pontos_por_real, /por real ou por dólar/);
  const dolarRuim = lerCartaoDigitado({ nome: 'X Black', programa_id: 'prog-a', pontos_por_real: '', pontos_por_dolar: '3,333', anuidade: '0' }, nomes, 'meu-1');
  assert.ok(dolarRuim.erros.pontos_por_dolar);
});

test('anuidade digitada: centavos inteiros, até R$ 99.999,99', () => {
  assert.deepEqual(mascaraAnuidade('R$ 1.356,00').centavos, 135600);
  assert.equal(mascaraAnuidade('').centavos, null);
  assert.equal(mascaraAnuidade('99999999999').centavos, ANUIDADE_MAXIMA);
});

test('resumo do cartão próprio na lista do perfil', () => {
  const nomes = new Map(DADOS.programas.map((p) => [p.id, p.nome]));
  assert.equal(resumoDoCartaoProprio(MEU, nomes), 'Programa A · 2,5 pontos por real · anuidade R$ 480,00');
  assert.equal(resumoDoCartaoProprio({ id: 'meu-2', nome: 'B', programa_id: 'x', pontos_por_dolar: 1, anuidade_brl: 0 }, nomes), 'pontos · 1 ponto por dólar · sem anuidade');
  assert.equal(resumoDoCartaoProprio({ id: 'meu-2', nome: 'B', programa_id: 'prog-b', pontos_por_real: 1 }, nomes), 'Programa B · 1 ponto por real');
});

test('adicionar ao perfil: com perfil, entra marcado com o programa; vazio, fica em "todos"', () => {
  const comPerfil = perfilComCartaoProprio({ versao: 2, programas: [{ programa_id: 'prog-b', clube_ativo: true }], cartoes: ['cartao-a'], valor_milheiro_brl: {} }, MEU);
  assert.deepEqual(comPerfil.cartoes, ['cartao-a', 'meu-1']);
  assert.deepEqual(comPerfil.programas.map((p) => p.programa_id), ['prog-b', 'prog-a']);
  assert.deepEqual(comPerfil.cartoes_proprios, [MEU]);
  const jaTemPrograma = perfilComCartaoProprio({ versao: 2, programas: [{ programa_id: 'prog-a', clube_ativo: true }], cartoes: [], valor_milheiro_brl: {} }, MEU);
  assert.equal(jaTemPrograma.programas.length, 1);
  assert.equal(jaTemPrograma.programas[0].clube_ativo, true);
  const vazio = perfilComCartaoProprio(null, MEU);
  assert.deepEqual(vazio.cartoes, []);
  assert.deepEqual(vazio.programas, []);
  assert.deepEqual(vazio.cartoes_proprios, [MEU]);

  const removido = perfilSemCartaoProprio(comPerfil, 'meu-1');
  assert.deepEqual(removido.cartoes, ['cartao-a']);
  assert.equal('cartoes_proprios' in removido, false);
  const doisSoUm = perfilSemCartaoProprio({ ...comPerfil, cartoes_proprios: [MEU, { ...MEU, id: 'meu-2' }] }, 'meu-1');
  assert.deepEqual(doisSoUm.cartoes_proprios.map((c) => c.id), ['meu-2']);
});

// ---------------------------------------------------------------------------
// "Pedir esse cartão": tela

test('pedido de cartão na tela: mesmos limites do servidor', () => {
  for (const chave of ['nomeMin', 'nomeMax', 'bancoMin', 'bancoMax', 'digitosMax']) {
    assert.equal(LIMITES_DO_PEDIDO_NA_TELA[chave], LIMITES_DO_PEDIDO[chave], chave);
  }
  assert.equal(LIMITES_DO_PEDIDO_NA_TELA.linkMax, LIMITES.linkMax);
});

test('pedido de cartão na tela: confere nome, banco e link', () => {
  assert.deepEqual(conferirPedidoNaTela({ nome_do_cartao: 'Cartão Z Gold', banco: 'Banco Z', link_da_fonte: '' }), {});
  assert.deepEqual(conferirPedidoNaTela({ nome_do_cartao: 'Cartão Z Gold', banco: 'Banco Z', link_da_fonte: 'https://bancoz.com.br/gold' }), {});
  const erros = conferirPedidoNaTela({ nome_do_cartao: '4111 1111 1111 1111', banco: 'B', link_da_fonte: 'http://x' });
  assert.match(erros.nome_do_cartao, /Nunca o número/);
  assert.ok(erros.banco);
  assert.ok(erros.link_da_fonte);
  assert.ok(conferirPedidoNaTela({}).nome_do_cartao);
  assert.match(conferirPedidoNaTela({ nome_do_cartao: 'Cartão', banco: '123456789' }).banco, /só o nome do banco/);
});

test('pedido de cartão na tela: corpo do POST só com o necessário', () => {
  const corpo = corpoDoPedidoDeCartao({ nome_do_cartao: '  Cartão\n Z ', banco: ' Banco Z ', programa_id: '', link_da_fonte: ' https://a.com.br ' }, { isca: '', tempoMs: 5000.4 });
  assert.deepEqual(corpo, {
    tipo: 'pedido_de_cartao', nome_do_cartao: 'Cartão Z', banco: 'Banco Z', programa_id: null, link_da_fonte: 'https://a.com.br', site: '', tempo_no_formulario_ms: 5000,
  });
  assert.equal(corpoDoPedidoDeCartao({ nome_do_cartao: 'a', banco: 'b', programa_id: 'prog-a' }).programa_id, 'prog-a');
  assert.equal(corpoDoPedidoDeCartao({ nome_do_cartao: 'a', banco: 'b' }, { tempoMs: -3 }).tempo_no_formulario_ms, 0);
});

// ---------------------------------------------------------------------------
// "Pedir esse cartão": servidor

const PEDIDO = Object.freeze({
  tipo: 'pedido_de_cartao', nome_do_cartao: 'Cartão Z Gold', banco: 'Banco Z', programa_id: 'prog-a',
  link_da_fonte: 'https://www.bancoz.com.br/cartoes/gold', site: '', tempo_no_formulario_ms: 9000,
});

test('servidor: valida o pedido de cartão', () => {
  const r = validarPedidoDeCartao(PEDIDO, DADOS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pedido, { nome: 'Cartão Z Gold', banco: 'Banco Z', programa: DADOS.programas[0], link: 'https://www.bancoz.com.br/cartoes/gold' });
  const semNada = validarPedidoDeCartao({ ...PEDIDO, programa_id: null, link_da_fonte: '' }, DADOS);
  assert.deepEqual(semNada.pedido, { nome: 'Cartão Z Gold', banco: 'Banco Z', programa: null, link: null });
  assert.equal(validarPedidoDeCartao({ ...PEDIDO, link_da_fonte: undefined }, DADOS).ok, true);
  assert.equal(validarPedidoDeCartao(null, DADOS).ok, false);
  assert.equal(validarPedidoDeCartao([], DADOS).ok, false);
  const erros = (extra) => validarPedidoDeCartao({ ...PEDIDO, ...extra }, DADOS).erros ?? {};
  assert.match(erros({ nome_do_cartao: '4111 1111 1111 1111' }).nome_do_cartao, /Nunca o número/);
  assert.ok(erros({ nome_do_cartao: 'x' }).nome_do_cartao);
  assert.ok(erros({ nome_do_cartao: 42 }).nome_do_cartao);
  assert.ok(erros({ banco: 'b'.repeat(61) }).banco);
  assert.match(erros({ banco: '123.456.789-09' }).banco, /só o nome do banco/);
  assert.ok(erros({ programa_id: 'nao-existe' }).programa_id);
  assert.ok(erros({ programa_id: 'Ruim!' }).programa_id);
  assert.ok(erros({ link_da_fonte: 'http://banco.com.br' }).link_da_fonte);
  assert.ok(erros({ link_da_fonte: 42 }).link_da_fonte);
});

test('servidor: issue do pedido com o texto da pessoa só em bloco de código', () => {
  const { pedido } = validarPedidoDeCartao({ ...PEDIDO, nome_do_cartao: 'Gold @fulano [x](https://mal.com)' }, DADOS);
  const issue = montarIssueDoPedido(pedido, '2026-11-26');
  assert.equal(issue.title, '[Pedido de cartão] Programa A');
  assert.deepEqual(issue.labels, [ETIQUETAS.pedidoDeCartao]);
  assert.ok(issue.body.includes('```text\nGold @fulano [x](https://mal.com)\n```'));
  assert.equal(issue.title.includes('fulano'), false);
  const sem = montarIssueDoPedido({ ...pedido, programa: null, link: null }, '2026-11-26');
  assert.equal(sem.title, '[Pedido de cartão] programa não informado');
  assert.ok(sem.body.includes('Não informado.'));
});

function kv() {
  const mapa = new Map();
  return { async get(k) { return mapa.get(k) ?? null; }, async put(k, v) { mapa.set(k, v); } };
}
function github() {
  return {
    issues: [], comentarios: [],
    async criarIssue(i) { this.issues.push(i); return { number: 1 }; },
    async comentar(n, b) { this.comentarios.push(b); },
  };
}
const ORIGEM = 'https://milhasdavez.com.br';
async function enviar(corpo, gh = github()) {
  const request = new Request(`${ORIGEM}/api/reportar`, {
    method: 'POST',
    headers: { Origin: ORIGEM, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
    body: JSON.stringify(corpo),
  });
  const resposta = await tratarReporte(request, {
    kv: kv(), chaveDoResumo: 'chave', github: gh, buscarDados: async () => DADOS, agora: () => new Date('2026-11-26T12:00:00-03:00'),
  });
  return { status: resposta.status, corpo: await resposta.json(), gh };
}

test('servidor: pedido de cartão vira issue, sem comentário de e-mail', async () => {
  const r = await enviar({ ...PEDIDO, email: 'alguem@exemplo.com' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.mensagem, MENSAGENS.pedidoEnviado);
  assert.equal(r.gh.issues.length, 1);
  assert.deepEqual(r.gh.issues[0].labels, ['pedido de cartão']);
  assert.equal(r.gh.comentarios.length, 0);
  assert.equal(r.gh.issues[0].body.includes('alguem@exemplo.com'), false);
});

test('servidor: pedido de cartão com erro dá 422; robô recebe "ok" e nada acontece; tipo estranho dá 400', async () => {
  const ruim = await enviar({ ...PEDIDO, banco: '' });
  assert.equal(ruim.status, 422);
  assert.ok(ruim.corpo.erros.banco);
  const robo = await enviar({ ...PEDIDO, tempo_no_formulario_ms: 10 });
  assert.equal(robo.status, 200);
  assert.equal(robo.corpo.mensagem, MENSAGENS.pedidoEnviado);
  assert.equal(robo.gh.issues.length, 0);
  assert.equal((await enviar({ ...PEDIDO, tipo: 'outra-coisa' })).status, 400);
});

// ---------------------------------------------------------------------------
// Dados de verdade: o cartão próprio com os dados do site

test('com os dados do site, o cartão próprio entra na conta de uma loja real', async () => {
  const ler = async (n) => JSON.parse(await readFile(new URL(`../dados/${n}.json`, import.meta.url), 'utf8'));
  const dados = { programas: await ler('programas'), cartoes: await ler('cartoes'), lojas: await ler('lojas'), ofertas: await ler('ofertas'), cambio: await ler('cambio') };
  const programa = dados.programas[0].id;
  const meu = { id: 'meu-1', nome: 'Cartão Teste', programa_id: programa, pontos_por_real: 3 };
  const perfil = { versao: 2, programas: [{ programa_id: programa, clube_ativo: false }], cartoes: ['meu-1'], valor_milheiro_brl: {}, cartoes_proprios: [meu] };
  const limpo = limparPerfil(perfil, dados);
  assert.deepEqual(limpo.cartoes, ['meu-1']);
  const jeitos = calcularJeitosDeComprar(perfilParaConta(limpo), { loja_id: dados.lojas[0].id, valor_centavos: 10000, tipo_vendedor: 'loja' }, dadosComCartoesDaPessoa(dados, limpo), HOJE);
  assert.ok(jeitos.some((j) => j.cartao?.id === 'meu-1' && j.pontos_do_cartao === 300));
});
