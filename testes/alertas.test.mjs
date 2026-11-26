// Alertas por e-mail: regras, avaliação com o motor, limites, tokens, textos,
// duplo opt-in, cancelamento, rodada semanal e as rotas HTTP.
// Tudo sem rede: Supabase e Resend viram peças em memória (testes/alertas/apoio.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITES, dataHoraEmSaoPaulo, formatarMinimo, idValido, lerMinimo, normalizarEmail, retratoDoPerfil, validarInscricao,
} from '../servidor/alertas/regras.js';
import { avaliarAlerta, bateMinimo, centesimosPorReal } from '../servidor/alertas/avaliar.js';
import { podeEnviarAlerta, podeEnviarConfirmacao, validadeDaConfirmacao } from '../servidor/alertas/limite.js';
import { assinaturaDeCancelamento, conferirCancelamento, novoToken, resumo, TOKEN } from '../servidor/alertas/tokens.js';
import { descreverAlerta, emailDeAlerta, emailDeConfirmacao, escaparHtml } from '../servidor/alertas/emails.js';
import { cancelar, confirmar, inscrever } from '../servidor/alertas/fluxo.js';
import { rodarAlertas } from '../servidor/alertas/rodada.js';
import { ESCALA_PONTOS, calcularJeitosDeComprar } from '../site/js/motor/index.js';
import {
  PERFIL_COM_CLUBE, SEGREDO, URL_SITE, cancelarDoEmail, correioFalso, dadosDeTeste, repoEmMemoria, tokenDoEmail,
} from './alertas/apoio.mjs';

const dados = dadosDeTeste();
const HOJE = '2026-11-10T12:00';
const AGORA = new Date('2026-11-10T15:00:00Z'); // 12:00 em São Paulo

// ---------------------------------------------------------------------------
// Regras

test('e-mail: normaliza e recusa o que não parece e-mail', () => {
  assert.equal(normalizarEmail('  Pessoa@Exemplo.COM.br '), 'pessoa@exemplo.com.br');
  for (const ruim of ['', 'sem-arroba', 'a@b', 'a b@c.com', 'x@.com', `${'a'.repeat(65)}@exemplo.com`, `a@${'b'.repeat(250)}.com`, null, 42]) {
    assert.equal(normalizarEmail(ruim), null, String(ruim));
  }
});

test('pontos por real: lê em centésimos exatos e formata de volta', () => {
  assert.equal(lerMinimo('2,5'), 250);
  assert.equal(lerMinimo('2.5'), 250);
  assert.equal(lerMinimo('10'), 1000);
  assert.equal(lerMinimo(' 12,34 '), 1234);
  assert.equal(lerMinimo(7), 700);
  assert.equal(lerMinimo(0.29), 29);
  assert.equal(lerMinimo('1000'), 100_000);
  for (const ruim of ['0', '0,00', '1000,01', '2,555', '-1', 'dez', '', null, Number.NaN, '1e3']) assert.equal(lerMinimo(ruim), null, String(ruim));
  assert.equal(formatarMinimo(250), '2,5');
  assert.equal(formatarMinimo(1000), '10');
  assert.equal(formatarMinimo(1205), '12,05');
  assert.equal(formatarMinimo(123_456), '1.234,56');
});

test('ids: mesmo formato do banco, recusa 6 dígitos seguidos (número de cartão)', () => {
  assert.ok(idValido('azul-fidelidade'));
  assert.ok(!idValido('cartao-411111'));
  assert.ok(!idValido('Magalu'));
  assert.ok(!idValido('a'.repeat(65)));
  assert.ok(!idValido(undefined));
});

test('retrato do perfil: só ids, clube e data; sem milheiro nem cotação; vazio = null', () => {
  const retrato = retratoDoPerfil({ ...PERFIL_COM_CLUBE, cotacao_dolar: 53456, cartoes: ['cartao-alfa', 'nao-existe'] }, dados);
  assert.deepEqual(retrato, {
    programas: [{ programa_id: 'programa-alfa', clube_ativo: true, clube_ativo_desde: '2026-10-01' }],
    cartoes: ['cartao-alfa'],
  });
  assert.deepEqual(retratoDoPerfil({ programas: [{ programa_id: 'programa-beta', clube_ativo: false }], cartoes: [] }, dados),
    { programas: [{ programa_id: 'programa-beta', clube_ativo: false }], cartoes: [] });
  assert.equal(retratoDoPerfil({ programas: [], cartoes: [] }, dados), null);
  assert.equal(retratoDoPerfil(null, dados), null);
  assert.equal(retratoDoPerfil({ programas: [], cartoes: ['4111-1111'] }, dados), null);
});

test('retrato do perfil: recusa perfil maior que o limite', () => {
  const muitos = { ...dados, programas: Array.from({ length: 31 }, (_, i) => ({ id: `p-${i}`, nome: `P ${i}` })) };
  const perfil = { programas: muitos.programas.map((p) => ({ programa_id: p.id, clube_ativo: false })), cartoes: [] };
  assert.equal(retratoDoPerfil(perfil, muitos), null);
});

test('validarInscricao: pedido certo vira pedido limpo', () => {
  const r = validarInscricao({
    email: 'Pessoa@Exemplo.com', loja_id: 'loja-teste', programa_id: 'programa-alfa', pontos_por_real: '12,5', perfil: PERFIL_COM_CLUBE, consentimento: true,
  }, dados);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pedido, {
    email: 'pessoa@exemplo.com', loja_id: 'loja-teste', programa_id: 'programa-alfa', minimo_centesimos: 1250,
    perfil: { programas: [{ programa_id: 'programa-alfa', clube_ativo: true, clube_ativo_desde: '2026-10-01' }], cartoes: ['cartao-alfa'] },
  });
  const semPrograma = validarInscricao({ email: 'a@exemplo.com', loja_id: 'loja-teste', programa_id: '', pontos_por_real: '1', perfil: PERFIL_COM_CLUBE, consentimento: true }, dados);
  assert.equal(semPrograma.pedido.programa_id, null);
});

test('validarInscricao: cada campo errado ganha a sua mensagem', () => {
  const r = validarInscricao({ email: 'x', loja_id: 'nao-existe', programa_id: 'nao-existe', pontos_por_real: '0', perfil: {}, consentimento: 'sim' }, dados);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.erros).sort(), ['consentimento', 'email', 'loja_id', 'perfil', 'pontos_por_real', 'programa_id']);
});

test('dataHoraEmSaoPaulo usa o fuso de São Paulo', () => {
  assert.equal(dataHoraEmSaoPaulo(new Date('2026-11-10T02:30:00Z')), '2026-11-09T23:30');
});

// ---------------------------------------------------------------------------
// Avaliação: o MESMO motor

test('avaliar: usa o total do motor para uma compra de referência e compara sem float', () => {
  const perfil = retratoDoPerfil(PERFIL_COM_CLUBE, dados);
  // Clube + cartão Alfa: 15 da oferta + 2 do cartão (acumula) = 17 pontos por real.
  const r = avaliarAlerta({ loja_id: 'loja-teste', programa_id: null, minimo_centesimos: 1700 }, perfil, dados, HOJE);
  assert.equal(r.dispara, true);
  assert.equal(r.melhor.centesimos_por_real, 1700);
  assert.equal(r.melhor.pontos_por_real_texto, '17');
  assert.equal(r.melhor.oferta_id, 'programa-alfa-loja-teste');
  assert.equal(r.chave, 'programa-alfa-loja-teste|1700');
  // Confere contra o motor direto, sem passar pelos alertas.
  const direto = calcularJeitosDeComprar({ ...perfil, valor_milheiro_brl: {} }, { loja_id: 'loja-teste', valor_centavos: 100_000, tipo_vendedor: 'loja' }, dados, HOJE)[0];
  assert.equal(direto.total_pontos, 17_000);
  const acima = avaliarAlerta({ loja_id: 'loja-teste', programa_id: null, minimo_centesimos: 1701 }, perfil, dados, HOJE);
  assert.equal(acima.dispara, false);
  assert.equal(acima.chave, null);
  assert.equal(acima.melhor.centesimos_por_real, 1700);
});

test('avaliar: sem clube vale a faixa sem clube; filtro de programa; loja sem oferta não dispara', () => {
  const semClube = { programas: [{ programa_id: 'programa-alfa', clube_ativo: false }], cartoes: ['cartao-beta'] };
  // 7 da oferta + 3 do cartão Beta = 10.
  assert.equal(avaliarAlerta({ loja_id: 'loja-teste', programa_id: null, minimo_centesimos: 1000 }, semClube, dados, HOJE).dispara, true);
  assert.equal(avaliarAlerta({ loja_id: 'loja-teste', programa_id: 'programa-beta', minimo_centesimos: 100 }, semClube, dados, HOJE).dispara, false);
  assert.equal(avaliarAlerta({ loja_id: 'outra-loja', programa_id: null, minimo_centesimos: 1 }, semClube, dados, HOJE).dispara, false);
  assert.equal(avaliarAlerta({ loja_id: 'sumiu-do-cadastro', programa_id: null, minimo_centesimos: 1 }, semClube, dados, HOJE).dispara, false);
});

test('avaliar: oferta vencida não dispara (o motor já tira do ranking)', () => {
  const perfil = retratoDoPerfil(PERFIL_COM_CLUBE, dados);
  assert.equal(avaliarAlerta({ loja_id: 'loja-teste', programa_id: null, minimo_centesimos: 100 }, perfil, dados, '2026-12-15T12:00').dispara, false);
});

test('bateMinimo e centesimosPorReal: contas inteiras na borda', () => {
  const dezPorReal = 10n * 1000n * ESCALA_PONTOS; // 10.000 pontos em R$ 1.000
  assert.equal(centesimosPorReal(dezPorReal), 1000);
  assert.equal(bateMinimo(dezPorReal, 1000), true);
  assert.equal(bateMinimo(dezPorReal - 1n, 1000), false);
  assert.equal(centesimosPorReal(dezPorReal - 1n), 999);
});

// ---------------------------------------------------------------------------
// Limites

test('limite semanal: 2 e-mails de alerta em 7 dias corridos', () => {
  const agora = new Date('2026-11-20T12:00:00Z');
  assert.equal(podeEnviarAlerta([], agora).ok, true);
  assert.equal(podeEnviarAlerta(['2026-11-19T12:00:00Z'], agora).ok, true);
  assert.equal(podeEnviarAlerta(['2026-11-15T12:00:00Z', '2026-11-19T12:00:00Z'], agora).ok, false);
  // O de 8 dias atrás já saiu da janela, e some da lista gravada.
  const r = podeEnviarAlerta(['2026-11-12T11:00:00Z', '2026-11-19T12:00:00Z', 'lixo'], agora);
  assert.equal(r.ok, true);
  assert.deepEqual(r.depois, ['2026-11-19T12:00:00.000Z', '2026-11-20T12:00:00.000Z']);
  assert.equal(podeEnviarAlerta(null, agora).ok, true);
});

test('limite de confirmações: 3 por dia; link vale 48 horas', () => {
  const agora = new Date('2026-11-20T12:00:00Z');
  const tres = ['2026-11-20T01:00:00Z', '2026-11-20T02:00:00Z', '2026-11-20T03:00:00Z'];
  assert.equal(podeEnviarConfirmacao(tres, agora).ok, false);
  assert.equal(podeEnviarConfirmacao(tres.slice(1), agora).ok, true);
  assert.equal(validadeDaConfirmacao(agora).toISOString(), '2026-11-22T12:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Tokens

test('tokens: aleatórios, guardados só como SHA-256; cancelar assinado com HMAC', async () => {
  const a = novoToken();
  assert.match(a, TOKEN);
  assert.notEqual(a, novoToken());
  assert.match(await resumo(a), /^[0-9a-f]{64}$/);
  assert.equal(await resumo('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const id = 'a0000000-0000-4000-8000-00000000000b';
  const assinatura = await assinaturaDeCancelamento(SEGREDO, id);
  assert.equal(await conferirCancelamento(SEGREDO, id, assinatura), true);
  assert.equal(await conferirCancelamento(SEGREDO, 'a0000000-0000-4000-8000-00000000000c', assinatura), false);
  assert.equal(await conferirCancelamento(`${SEGREDO}x`, id, assinatura), false);
  assert.equal(await conferirCancelamento(SEGREDO, id, 'curta'), false);
  assert.equal(await conferirCancelamento(SEGREDO, id, null), false);
  await assert.rejects(() => assinaturaDeCancelamento('curto', id), /32 caracteres/);
});

// ---------------------------------------------------------------------------
// Textos dos e-mails

test('e-mail de confirmação: link, prazo, cancelar no corpo e no cabeçalho', () => {
  const e = emailDeConfirmacao({
    urlConfirmar: 'https://x/c?t=1', urlCancelar: 'https://x/cancelar?i=1&a=2',
    alerta: { loja: 'Loja <Teste>', programa: null, minimo_centesimos: 250 }, horas: 48,
  });
  assert.match(e.assunto, /Confirme/);
  assert.match(e.texto, /https:\/\/x\/c\?t=1/);
  assert.match(e.texto, /48 horas/);
  assert.match(e.texto, /Loja <Teste>: 2,5 pontos por real ou mais/);
  assert.ok(e.html.includes('Loja &lt;Teste&gt;'));
  assert.ok(!e.html.includes('<Teste>'));
  assert.ok(e.html.includes('https://x/cancelar?i=1&amp;a=2'));
  assert.deepEqual(e.cabecalhos, { 'List-Unsubscribe': '<https://x/cancelar?i=1&a=2>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
});

test('e-mail de alerta: uma ou várias lojas, condições, avisos e cancelar', () => {
  const melhor = {
    programa: { nome: 'Programa Alfa' }, cartao: { nome: 'Cartão "Alfa"' }, pontos_por_real_texto: '17',
    condicoes: ['Estar com o clube ativo.'], avisos: ['A oferta vence amanhã.'], validade: 'De 01/11/2026 até 30/11/2026.',
  };
  const um = emailDeAlerta({ disparos: [{ alerta: { loja: 'Loja Teste', programa: null, minimo_centesimos: 1000 }, melhor, urlLoja: 'https://x/loja/loja-teste/' }], urlCancelar: 'https://x/cancelar' });
  assert.equal(um.assunto, 'Loja Teste chegou no seu alvo de pontos');
  assert.match(um.texto, /Loja Teste: 17 pontos por real \(seu alvo: 10\)/);
  assert.match(um.texto, /Com Programa Alfa \+ cartão Cartão "Alfa"\./);
  assert.match(um.texto, /Condição: Estar com o clube ativo\./);
  assert.match(um.texto, /Atenção: A oferta vence amanhã\./);
  assert.match(um.texto, /no máximo 2 e-mails/);
  assert.ok(um.html.includes('Cartão &quot;Alfa&quot;'));
  assert.ok(um.cabecalhos['List-Unsubscribe']);
  const dois = emailDeAlerta({
    disparos: [
      { alerta: { loja: 'A', programa: 'P', minimo_centesimos: 100 }, melhor: { ...melhor, cartao: null, programa: null, condicoes: [], avisos: [], validade: null }, urlLoja: 'https://x/a' },
      { alerta: { loja: 'B', programa: null, minimo_centesimos: 100 }, melhor, urlLoja: 'https://x/b' },
    ],
    urlCancelar: 'https://x/cancelar',
  });
  assert.equal(dois.assunto, '2 lojas chegaram no seu alvo de pontos');
  assert.equal(descreverAlerta({ loja: 'A', programa: 'P', minimo_centesimos: 100 }), 'A: 1 pontos por real ou mais, no programa P');
  assert.equal(escaparHtml(`<a href='x'>&</a>`), '&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;');
});

// ---------------------------------------------------------------------------
// Duplo opt-in, confirmação e cancelamento

function pedidoDe(email, extra = {}) {
  return validarInscricao({ email, loja_id: 'loja-teste', pontos_por_real: '10', perfil: PERFIL_COM_CLUBE, consentimento: true, ...extra }, dados).pedido;
}

function ambiente() {
  return { repo: repoEmMemoria(), correio: correioFalso(), segredo: SEGREDO, urlSite: URL_SITE, dados, agora: AGORA };
}

test('inscrição: nada vale antes da confirmação; o banco só guarda o hash do token', async () => {
  const amb = ambiente();
  const r = await inscrever(pedidoDe('pessoa@exemplo.com'), amb);
  assert.equal(r.resultado, 'enviado');
  assert.equal(amb.correio.enviados.length, 1);
  const [email] = amb.correio.enviados;
  assert.equal(email.para, 'pessoa@exemplo.com');
  const [linha] = amb.repo.inscricoes.values();
  assert.equal(linha.confirmado_em, null);
  assert.equal(linha.perfil, null);
  assert.equal(amb.repo.alertas.size, 0);
  const token = tokenDoEmail(email);
  assert.equal(linha.token_hash, await resumo(token));
  assert.ok(!JSON.stringify(linha).includes(token), 'o token puro não fica no banco');
  assert.deepEqual(amb.repo.log, [{ tipo: 'confirmacao', resultado: 'enviado', quantidade_alertas: 1 }]);
  // Log sem dado pessoal.
  assert.ok(!JSON.stringify(amb.repo.log).includes('@'));
});

test('confirmação: aplica o pedido uma vez só; link vencido ou trocado não vale', async () => {
  const amb = ambiente();
  await inscrever(pedidoDe('pessoa@exemplo.com'), amb);
  const token = tokenDoEmail(amb.correio.enviados[0]);
  assert.deepEqual(await confirmar('nao-e-token', amb), { resultado: 'invalido' });
  assert.deepEqual(await confirmar('a'.repeat(43), amb), { resultado: 'invalido' });
  const r = await confirmar(token, amb);
  assert.equal(r.resultado, 'confirmado');
  const [linha] = amb.repo.inscricoes.values();
  assert.equal(linha.confirmado_em, AGORA.toISOString());
  assert.deepEqual(linha.perfil.cartoes, ['cartao-alfa']);
  assert.equal(linha.token_hash, null);
  assert.equal(linha.pendente, null);
  const [alerta] = amb.repo.alertas.values();
  assert.deepEqual({ loja: alerta.loja_id, prog: alerta.programa_id, min: alerta.minimo_centesimos }, { loja: 'loja-teste', prog: null, min: 1000 });
  assert.deepEqual(await confirmar(token, amb), { resultado: 'invalido' }, 'o link vale uma vez');

  const amb2 = ambiente();
  await inscrever(pedidoDe('outra@exemplo.com'), amb2);
  const vencido = tokenDoEmail(amb2.correio.enviados[0]);
  assert.deepEqual(await confirmar(vencido, { ...amb2, agora: new Date(AGORA.getTime() + 49 * 3600_000) }), { resultado: 'invalido' });
});

test('nova inscrição no mesmo e-mail: mesmo alerta é atualizado, outro é somado; até 10', async () => {
  const amb = ambiente();
  const confirmarNovo = async (pedido) => {
    await inscrever(pedido, amb);
    return confirmar(tokenDoEmail(amb.correio.enviados.at(-1)), amb);
  };
  await confirmarNovo(pedidoDe('p@exemplo.com'));
  await confirmarNovo(pedidoDe('p@exemplo.com', { pontos_por_real: '12' }));
  assert.equal(amb.repo.alertas.size, 1);
  assert.equal([...amb.repo.alertas.values()][0].minimo_centesimos, 1200);
  await confirmarNovo(pedidoDe('p@exemplo.com', { programa_id: 'programa-alfa' }));
  assert.equal(amb.repo.alertas.size, 2);
  assert.equal(amb.repo.inscricoes.size, 1);

  // Limite de 10 alertas (o resto do dia ficaria barrado pelo limite de confirmações; avança o relógio).
  const lojas = Array.from({ length: 8 }, (_, i) => ({ id: `loja-${i}`, nome: `Loja ${i}` }));
  const dadosMais = { ...dados, lojas: [...dados.lojas, ...lojas, { id: 'loja-extra', nome: 'Extra' }] };
  for (const [i, loja] of lojas.entries()) {
    const agora = new Date(AGORA.getTime() + (i + 1) * 86_400_000);
    const pedido = validarInscricao({ email: 'p@exemplo.com', loja_id: loja.id, pontos_por_real: '1', perfil: PERFIL_COM_CLUBE, consentimento: true }, dadosMais).pedido;
    await inscrever(pedido, { ...amb, dados: dadosMais, agora });
    assert.equal((await confirmar(tokenDoEmail(amb.correio.enviados.at(-1)), { ...amb, agora })).resultado, 'confirmado');
  }
  assert.equal(amb.repo.alertas.size, 10);
  const agora = new Date(AGORA.getTime() + 20 * 86_400_000);
  const extra = validarInscricao({ email: 'p@exemplo.com', loja_id: 'loja-extra', pontos_por_real: '1', perfil: PERFIL_COM_CLUBE, consentimento: true }, dadosMais).pedido;
  await inscrever(extra, { ...amb, dados: dadosMais, agora });
  const tokenExtra = tokenDoEmail(amb.correio.enviados.at(-1));
  assert.equal((await confirmar(tokenExtra, { ...amb, agora })).resultado, 'limite_de_alertas');
  assert.equal(amb.repo.alertas.size, 10);
  assert.equal((await confirmar(tokenExtra, { ...amb, agora })).resultado, 'invalido', 'link usado mesmo quando recusado');
});

test('inscrição: limite de 3 confirmações por dia, sem dizer nada diferente para quem pediu', async () => {
  const amb = ambiente();
  for (let i = 0; i < 3; i++) assert.equal((await inscrever(pedidoDe('alvo@exemplo.com'), amb)).resultado, 'enviado');
  assert.equal((await inscrever(pedidoDe('alvo@exemplo.com'), amb)).resultado, 'limite');
  assert.equal(amb.correio.enviados.length, 3);
  assert.equal(amb.repo.log.at(-1).resultado, 'limite');
  // Só o último link vale.
  const [primeiro, , ultimo] = amb.correio.enviados;
  assert.equal((await confirmar(tokenDoEmail(primeiro), amb)).resultado, 'invalido');
  assert.equal((await confirmar(tokenDoEmail(ultimo), amb)).resultado, 'confirmado');
});

test('inscrição: erro do serviço de e-mail fica no log, sem o e-mail', async () => {
  const amb = ambiente();
  amb.correio.falhar = true;
  assert.equal((await inscrever(pedidoDe('pessoa@exemplo.com'), amb)).resultado, 'erro_envio');
  assert.deepEqual(amb.repo.log, [{ tipo: 'confirmacao', resultado: 'erro', quantidade_alertas: 1, status_http: 500 }]);
});

test('inscrição: duas ao mesmo tempo no mesmo e-mail (criar devolve nada) acha a que já existe', async () => {
  const amb = ambiente();
  const repo = amb.repo;
  const original = repo.inscricaoPorEmail.bind(repo);
  let primeira = true;
  repo.inscricaoPorEmail = async (email) => {
    if (primeira) { primeira = false; await repo.criarInscricao({ email, confirmacoes_recentes: [] }); return null; }
    return original(email);
  };
  assert.equal((await inscrever(pedidoDe('corrida@exemplo.com'), amb)).resultado, 'enviado');
  assert.equal(repo.inscricoes.size, 1);
});

test('cancelar: apaga o e-mail e os alertas; assinatura errada não apaga nada', async () => {
  const amb = ambiente();
  await inscrever(pedidoDe('pessoa@exemplo.com'), amb);
  await confirmar(tokenDoEmail(amb.correio.enviados[0]), amb);
  const { i, a } = cancelarDoEmail(amb.correio.enviados[0]);
  assert.deepEqual(await cancelar(i, 'x'.repeat(43), amb), { resultado: 'invalido' });
  assert.deepEqual(await cancelar('nao-e-uuid', a, amb), { resultado: 'invalido' });
  assert.equal(amb.repo.inscricoes.size, 1);
  assert.deepEqual(await cancelar(i, a, amb), { resultado: 'cancelado' });
  assert.equal(amb.repo.inscricoes.size, 0);
  assert.equal(amb.repo.alertas.size, 0);
  assert.deepEqual(amb.repo.log.at(-1), { tipo: 'cancelamento', resultado: 'feito', quantidade_alertas: 0 });
  // De novo: mesma resposta, nada quebra.
  assert.deepEqual(await cancelar(i, a, amb), { resultado: 'cancelado' });
});

// ---------------------------------------------------------------------------
// Rodada semanal

async function confirmado(amb, email, extra) {
  await inscrever(pedidoDe(email, extra), amb);
  await confirmar(tokenDoEmail(amb.correio.enviados.at(-1)), amb);
  amb.correio.enviados.length = 0;
}

test('rodada: avisa quem chegou no alvo, um e-mail por pessoa, cada um só com os próprios dados', async () => {
  const amb = ambiente();
  await confirmado(amb, 'a@exemplo.com', { pontos_por_real: '15' });
  await confirmado(amb, 'b@exemplo.com', { pontos_por_real: '20' }); // 17 não chega em 20
  await confirmado(amb, 'c@exemplo.com', { pontos_por_real: '10' });
  amb.repo.log.length = 0;
  const resumoRodada = await rodarAlertas(amb);
  assert.deepEqual(resumoRodada, {
    simulacao: false, pedidos_vencidos_apagados: 0, inscricoes: 3, alertas_avaliados: 3, alertas_no_alvo: 2,
    emails_enviados: 2, emails_barrados_pelo_limite: 0, erros_de_envio: 0, erros_de_avaliacao: 0,
  });
  assert.deepEqual(amb.correio.enviados.map((e) => e.para).sort(), ['a@exemplo.com', 'c@exemplo.com']);
  for (const e of amb.correio.enviados) {
    const outros = ['a@exemplo.com', 'b@exemplo.com', 'c@exemplo.com'].filter((x) => x !== e.para);
    for (const outro of outros) assert.ok(!JSON.stringify(e).includes(outro), 'nunca o e-mail de outra pessoa');
    assert.match(e.texto, /Loja Teste: 17 pontos por real/);
    assert.match(e.texto, /cancelar\?i=/);
    assert.ok(e.cabecalhos['List-Unsubscribe']);
    assert.match(e.idempotencia, /^alerta-[0-9a-f-]{36}-2026-11-10$/);
  }
  assert.ok(amb.repo.log.every((l) => !JSON.stringify(l).includes('@') && Object.keys(l).every((k) => ['tipo', 'resultado', 'quantidade_alertas', 'status_http'].includes(k))));

  // Mesma oferta e mesmos pontos na semana seguinte: não repete.
  const semanaQueVem = { ...amb, agora: new Date('2026-11-17T15:00:00Z') };
  amb.correio.enviados.length = 0;
  assert.equal((await rodarAlertas(semanaQueVem)).emails_enviados, 0);
});

test('rodada: alerta que sai do alvo volta a poder avisar; limite de 2 por semana', async () => {
  const amb = ambiente();
  await confirmado(amb, 'a@exemplo.com', { pontos_por_real: '15' });
  await rodarAlertas(amb);
  assert.equal(amb.correio.enviados.length, 1);
  const [alerta] = amb.repo.alertas.values();
  assert.equal(alerta.ultimo_aviso_chave, 'programa-alfa-loja-teste|1700');

  // Oferta some (vencida): o alerta "volta ao normal".
  const semOferta = { ...dados, ofertas: [] };
  await rodarAlertas({ ...amb, dados: semOferta, agora: new Date('2026-11-11T15:00:00Z') });
  assert.equal([...amb.repo.alertas.values()][0].ultimo_aviso_chave, null);

  // Volta: avisa de novo (2º e-mail na semana).
  await rodarAlertas({ ...amb, agora: new Date('2026-11-12T15:00:00Z') });
  assert.equal(amb.correio.enviados.length, 2);

  // Sai e volta de novo na mesma semana: o 3º e-mail é barrado e a chave não é gravada.
  await rodarAlertas({ ...amb, dados: semOferta, agora: new Date('2026-11-13T15:00:00Z') });
  const barrado = await rodarAlertas({ ...amb, agora: new Date('2026-11-14T15:00:00Z') });
  assert.equal(barrado.emails_barrados_pelo_limite, 1);
  assert.equal(amb.correio.enviados.length, 2);
  assert.equal([...amb.repo.alertas.values()][0].ultimo_aviso_chave, null);
  assert.deepEqual(amb.repo.log.at(-1), { tipo: 'alerta', resultado: 'limite', quantidade_alertas: 1 });

  // Uma semana depois do 1º, libera.
  const liberado = await rodarAlertas({ ...amb, agora: new Date('2026-11-17T16:00:00Z') });
  assert.equal(liberado.emails_enviados, 1);
});

test('rodada: junta vários alertas da mesma pessoa num e-mail só', async () => {
  const amb = ambiente();
  await confirmado(amb, 'a@exemplo.com', { pontos_por_real: '15' });
  await confirmado(amb, 'a@exemplo.com', { pontos_por_real: '16', programa_id: 'programa-alfa' });
  const r = await rodarAlertas(amb);
  assert.equal(r.emails_enviados, 1);
  assert.equal(r.alertas_no_alvo, 2);
  assert.equal(amb.repo.log.at(-1).quantidade_alertas, 2);
});

test('rodada: apaga pedidos não confirmados vencidos; simulação não envia nem grava', async () => {
  const amb = ambiente();
  await inscrever(pedidoDe('nunca.confirmou@exemplo.com'), amb);
  await confirmado(amb, 'a@exemplo.com', { pontos_por_real: '15' });
  const simulado = await rodarAlertas({ ...amb, correio: null });
  assert.equal(simulado.simulacao, true);
  assert.equal(simulado.emails_enviados, 1);
  assert.equal(amb.correio.enviados.length, 0);
  assert.equal([...amb.repo.alertas.values()][0].ultimo_aviso_chave, null);
  const depois = { ...amb, agora: new Date(AGORA.getTime() + 3 * 86_400_000) };
  assert.equal((await rodarAlertas(depois)).pedidos_vencidos_apagados, 1);
  assert.equal(amb.repo.inscricoes.size, 1);
});

test('rodada: erro de envio e perfil quebrado contam, sem parar as outras pessoas', async () => {
  const amb = ambiente();
  await confirmado(amb, 'a@exemplo.com', { pontos_por_real: '15' });
  await confirmado(amb, 'b@exemplo.com', { pontos_por_real: '15' });
  const [, b] = amb.repo.inscricoes.values();
  b.perfil = { programas: 'quebrado', cartoes: [] };
  amb.correio.falhar = true;
  const r = await rodarAlertas(amb);
  assert.equal(r.erros_de_avaliacao, 1);
  assert.equal(r.erros_de_envio, 1);
  assert.equal([...amb.repo.alertas.values()][0].ultimo_aviso_chave, null, 'sem envio, sem chave: tenta de novo na próxima');
  assert.deepEqual(amb.repo.log.at(-1), { tipo: 'alerta', resultado: 'erro', quantidade_alertas: 1, status_http: 500 });
});

test('LIMITES: os números que os textos prometem', () => {
  assert.equal(LIMITES.alertasPorSemana, 2);
  assert.equal(LIMITES.horasParaConfirmar, 48);
  assert.equal(LIMITES.alertasPorEmail, 10);
});
