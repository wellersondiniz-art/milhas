// Plano pago: regras, assinatura do Stripe, cliente da API, banco e webhook.
// Os quatro estados pedidos (pagou, falhou, cancelou, reembolsou) estão em
// "webhook: ..." mais abaixo.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BENEFICIOS, algumaComBeneficio, fimDoPeriodo, limitesDeAlertas, linhaDaAssinatura, normalizarEmail, situacaoDoStripe, temBeneficio,
} from '../servidor/plano/regras.js';
import { LIMITES } from '../servidor/alertas/regras.js';
import { assinarComoStripe, avisoDoStripeValido, TOLERANCIA_SEGUNDOS } from '../servidor/plano/assinatura.js';
import { chaveAceita, clienteStripe, ErroDoStripe } from '../servidor/plano/stripe.js';
import { repositorioDoPlano } from '../servidor/plano/supabase.js';
import { CORPO_MAXIMO, EVENTOS_TRATADOS, tratarWebhook } from '../servidor/plano/webhook.js';
import { dependenciasDoPlano, modoReal } from '../servidor/plano/cloudflare.js';
import { onRequest } from '../functions/api/plano/stripe.js';
import {
  AGORA, CHAVE_TESTE, SEGREDO_WEBHOOK, SEGUNDOS, assinaturaStripe, evento, pedidoAssinado, repoDoPlano, stripeFalso,
} from './plano/apoio.mjs';

const DIA = 24 * 60 * 60;
// Chaves de produção FALSAS, montadas em tempo de execução para o
// auditor de segredos (seguranca/auditar.sh) não confundir com chave real.
const SK_LIVE = ['sk', 'live', 'abcdefghij1234'].join('_');
const RK_LIVE = ['rk', 'live', 'abcdefghij1234'].join('_');

// ---------------------------------------------------------------------------
// Regras

test('regras: situação do Stripe vira a nossa; desconhecida vira null', () => {
  assert.equal(situacaoDoStripe('active'), 'ativa');
  assert.equal(situacaoDoStripe('trialing'), 'ativa');
  assert.equal(situacaoDoStripe('incomplete'), 'pendente');
  for (const s of ['past_due', 'unpaid', 'incomplete_expired', 'paused']) assert.equal(situacaoDoStripe(s), 'falhou');
  assert.equal(situacaoDoStripe('canceled'), 'cancelada');
  assert.equal(situacaoDoStripe('qualquer'), null);
});

test('regras: fim do período nos itens (API nova) ou na assinatura (API antiga)', () => {
  assert.equal(fimDoPeriodo({ items: { data: [{ current_period_end: 100 }, { current_period_end: 200 }] } }), new Date(200_000).toISOString());
  assert.equal(fimDoPeriodo({ current_period_end: 300 }), new Date(300_000).toISOString());
  assert.equal(fimDoPeriodo({}), null);
  assert.equal(fimDoPeriodo(null), null);
});

test('regras: benefício só ativa, sem contestação e dentro do período', () => {
  const futuro = new Date(AGORA.getTime() + 1000).toISOString();
  const passado = new Date(AGORA.getTime() - 1000).toISOString();
  assert.equal(temBeneficio({ situacao: 'ativa', contestada: false, fim_do_periodo: futuro }, AGORA), true);
  assert.equal(temBeneficio({ situacao: 'ativa', contestada: false, fim_do_periodo: passado }, AGORA), false);
  assert.equal(temBeneficio({ situacao: 'ativa', contestada: true, fim_do_periodo: futuro }, AGORA), false);
  assert.equal(temBeneficio({ situacao: 'ativa', contestada: false, fim_do_periodo: null }, AGORA), false);
  assert.equal(temBeneficio({ situacao: 'ativa', contestada: false, fim_do_periodo: 'lixo' }, AGORA), false);
  for (const s of ['pendente', 'falhou', 'cancelada', 'reembolsada']) {
    assert.equal(temBeneficio({ situacao: s, contestada: false, fim_do_periodo: futuro }, AGORA), false, s);
  }
  assert.equal(temBeneficio(null, AGORA), false);
  assert.equal(algumaComBeneficio([{ situacao: 'cancelada' }, { situacao: 'ativa', fim_do_periodo: futuro }], AGORA), true);
  assert.equal(algumaComBeneficio(null, AGORA), false);
});

test('regras: limites de alertas do grátis e do plano; o plano não mexe em mais nada', () => {
  assert.deepEqual(limitesDeAlertas(false), { alertasPorEmail: LIMITES.alertasPorEmail, alertasPorSemana: LIMITES.alertasPorSemana });
  assert.deepEqual(limitesDeAlertas(true), { alertasPorEmail: BENEFICIOS.alertasPorEmail, alertasPorSemana: BENEFICIOS.alertasPorSemana });
  assert.ok(BENEFICIOS.alertasPorEmail > LIMITES.alertasPorEmail && BENEFICIOS.alertasPorSemana > LIMITES.alertasPorSemana);
  assert.deepEqual(Object.keys(BENEFICIOS).sort(), ['alertasPorEmail', 'alertasPorSemana']);
});

test('regras: e-mail normalizado; lixo vira null', () => {
  assert.equal(normalizarEmail('  Pessoa@Exemplo.COM '), 'pessoa@exemplo.com');
  for (const x of [null, 3, 'a@b', 'sem-arroba.com', `${'a'.repeat(250)}@x.com`, 'a b@c.com']) assert.equal(normalizarEmail(x), null, String(x));
});

test('regras: linha da assinatura; reembolsada é final e a contestação se mantém', () => {
  const em = new Date(SEGUNDOS * 1000);
  const linha = linhaDaAssinatura(assinaturaStripe({ cancel_at_period_end: true }), 'Pessoa@Exemplo.com', em);
  assert.equal(linha.situacao, 'ativa');
  assert.equal(linha.email, 'pessoa@exemplo.com');
  assert.equal(linha.cancela_no_fim, true);
  assert.equal(linha.stripe_cliente_id, 'cus_1');
  assert.equal(linha.contestada, false);
  assert.equal(linha.reembolsada_em, null);
  assert.equal(linhaDaAssinatura(assinaturaStripe({ customer: { id: 'cus_9' } }), 'a@b.com', em).stripe_cliente_id, 'cus_9');
  const depois = linhaDaAssinatura(assinaturaStripe({ status: 'canceled' }), 'a@b.com', em,
    { situacao: 'reembolsada', reembolsada_em: '2026-11-20T00:00:00.000Z', contestada: true });
  assert.equal(depois.situacao, 'reembolsada');
  assert.equal(depois.reembolsada_em, '2026-11-20T00:00:00.000Z');
  assert.equal(depois.contestada, true);
  assert.equal(linhaDaAssinatura(assinaturaStripe({ status: '???' }), 'a@b.com', em), null);
  assert.equal(linhaDaAssinatura(assinaturaStripe(), null, em), null);
  assert.equal(linhaDaAssinatura(assinaturaStripe({ customer: null }), 'a@b.com', em), null);
  assert.equal(linhaDaAssinatura(null, 'a@b.com', em), null);
});

// ---------------------------------------------------------------------------
// Assinatura dos avisos

test('assinatura: aceita a do Stripe; recusa segredo errado, corpo mexido e cabeçalho torto', async () => {
  const corpo = '{"id":"evt_1"}';
  const cabecalho = await assinarComoStripe({ corpo, segredo: SEGREDO_WEBHOOK, t: SEGUNDOS });
  const base = { corpo, cabecalho, segredo: SEGREDO_WEBHOOK, agora: AGORA };
  assert.equal(await avisoDoStripeValido(base), true);
  assert.equal(await avisoDoStripeValido({ ...base, segredo: 'whsec_outro_segredo_qualquer_1234' }), false);
  assert.equal(await avisoDoStripeValido({ ...base, corpo: '{"id":"evt_2"}' }), false);
  assert.equal(await avisoDoStripeValido({ ...base, corpo: `${corpo} ` }), false, 'um espaço a mais já muda');
  assert.equal(await avisoDoStripeValido({ ...base, segredo: 'sem-prefixo' }), false);
  assert.equal(await avisoDoStripeValido({ ...base, corpo: null }), false);
  for (const ruim of [null, '', 'v1=abc', `t=${SEGUNDOS}`, `t=abc,v1=${'0'.repeat(64)}`, 'x'.repeat(3000), `=x,t=${SEGUNDOS},v0=${'0'.repeat(64)}`]) {
    assert.equal(await avisoDoStripeValido({ ...base, cabecalho: ruim }), false, String(ruim).slice(0, 30));
  }
});

test('assinatura: várias v1 (troca de segredo) e janela de 5 minutos', async () => {
  const corpo = '{"x":1}';
  const boa = await assinarComoStripe({ corpo, segredo: SEGREDO_WEBHOOK, t: SEGUNDOS });
  const v1 = boa.split('v1=')[1];
  assert.equal(await avisoDoStripeValido({ corpo, segredo: SEGREDO_WEBHOOK, agora: AGORA, cabecalho: `t=${SEGUNDOS},v1=${'a'.repeat(64)},v1=${v1}` }), true);
  const velha = await assinarComoStripe({ corpo, segredo: SEGREDO_WEBHOOK, t: SEGUNDOS - TOLERANCIA_SEGUNDOS - 1 });
  assert.equal(await avisoDoStripeValido({ corpo, segredo: SEGREDO_WEBHOOK, agora: AGORA, cabecalho: velha }), false, 'repetição de aviso antigo');
  const futura = await assinarComoStripe({ corpo, segredo: SEGREDO_WEBHOOK, t: SEGUNDOS + TOLERANCIA_SEGUNDOS + 1 });
  assert.equal(await avisoDoStripeValido({ corpo, segredo: SEGREDO_WEBHOOK, agora: AGORA, cabecalho: futura }), false);
  const limite = await assinarComoStripe({ corpo, segredo: SEGREDO_WEBHOOK, t: SEGUNDOS - TOLERANCIA_SEGUNDOS });
  assert.equal(await avisoDoStripeValido({ corpo, segredo: SEGREDO_WEBHOOK, agora: AGORA, cabecalho: limite }), true);
});

// ---------------------------------------------------------------------------
// Cliente do Stripe

test('stripe: só chave de teste enquanto o modo real não for ligado', () => {
  assert.equal(chaveAceita('sk_test_abcdefghij1234', false), true);
  assert.equal(chaveAceita('rk_test_abcdefghij1234', false), true);
  assert.equal(chaveAceita(SK_LIVE, false), false);
  assert.equal(chaveAceita(RK_LIVE, false), false);
  assert.equal(chaveAceita(RK_LIVE, true), true);
  assert.equal(chaveAceita('pk_test_abcdefghij1234', false), false, 'chave publicável não serve');
  assert.equal(chaveAceita(undefined, true), false);
  assert.equal(clienteStripe({ chave: SK_LIVE }), null);
  assert.equal(clienteStripe({ chave: CHAVE_TESTE }).modoTeste, true);
});

test('stripe: chave só no cabeçalho, ids conferidos antes de chamar, erro só com status', async () => {
  const { stripe, estado } = stripeFalso();
  assert.equal((await stripe.cliente('cus_1')).id, 'cus_1');
  assert.equal(estado.chamadas[0].cabecalhos.Authorization, `Bearer ${CHAVE_TESTE}`);
  assert.ok(!estado.chamadas[0].caminho.includes(CHAVE_TESTE));
  assert.equal((await stripe.cobranca('ch_1')).customer, 'cus_1');
  assert.equal((await stripe.assinaturasDoCliente('cus_1')).length, 1);
  assert.match(estado.chamadas.at(-1).caminho, /status=all/);
  await stripe.cancelarAssinatura('sub_1');
  assert.equal(estado.chamadas.at(-1).metodo, 'DELETE');
  assert.equal(estado.chamadas.at(-1).cabecalhos['Idempotency-Key'], 'cancelar-sub_1');
  const antes = estado.chamadas.length;
  assert.equal(await stripe.cliente('../x'), null);
  assert.equal(await stripe.cobranca(null), null);
  assert.deepEqual(await stripe.assinaturasDoCliente('cus_1&status=x'), []);
  assert.equal(await stripe.cancelarAssinatura('sub_1/../'), null);
  assert.equal(estado.chamadas.length, antes, 'id estranho não vira chamada');
  estado.falhar = true;
  await assert.rejects(() => stripe.cliente('cus_1'), (e) => e instanceof ErroDoStripe && e.status === 500 && !e.message.includes('@'));
  const vazio = clienteStripe({ chave: CHAVE_TESTE, fetch: async () => new Response('{}', { status: 200 }) });
  assert.deepEqual(await vazio.assinaturasDoCliente('cus_1'), []);
});

// ---------------------------------------------------------------------------
// Banco

test('supabase do plano: upsert por stripe_assinatura_id, conflito de evento vira false', async () => {
  assert.equal(repositorioDoPlano({ url: '', chave: 'x' }), null);
  assert.equal(repositorioDoPlano({ url: 'http://inseguro.exemplo', chave: 'x' }), null);
  const chamadas = [];
  const respostas = [
    { status: 200, corpo: [{ stripe_evento_id: 'evt_1' }] },
    { status: 200, corpo: [] },
    { status: 201 },
    { status: 409, corpo: { message: 'duplicado' } },
    { status: 200, corpo: [{ stripe_assinatura_id: 'sub_1' }] },
    { status: 200, corpo: [] },
    { status: 201 },
    { status: 500, corpo: { message: 'pessoa@exemplo.com' } },
    { status: 200, corpo: '' },
  ];
  const buscar = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), ...opcoes });
    const r = respostas.shift();
    return new Response(r.corpo === undefined ? null : (typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo)), { status: r.status });
  };
  const repo = repositorioDoPlano({ url: 'https://abc.supabase.co/', chave: 'sb_secret_x', fetch: buscar });
  assert.equal(await repo.eventoJaProcessado('evt_1'), true);
  assert.equal(await repo.eventoJaProcessado('evt_2'), false);
  assert.equal(await repo.registrarEvento({ stripe_evento_id: 'evt_2', tipo: 'invoice.paid' }), true);
  assert.equal(await repo.registrarEvento({ stripe_evento_id: 'evt_2', tipo: 'invoice.paid' }), false);
  assert.equal((await repo.assinaturaPorStripeId('sub_1')).stripe_assinatura_id, 'sub_1');
  assert.equal(await repo.assinaturaPorStripeId('sub_2'), null);
  await repo.gravarAssinatura({ stripe_assinatura_id: 'sub_1' });
  const upsert = chamadas.at(-1);
  assert.match(upsert.url, /plano_assinaturas\?on_conflict=stripe_assinatura_id$/);
  assert.match(upsert.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal(upsert.headers.apikey, 'sb_secret_x');
  await assert.rejects(() => repo.gravarAssinatura({}), (e) => e.status === 500 && !e.message.includes('@'));
  assert.equal(await repo.eventoJaProcessado('evt_3'), false, 'corpo vazio');
  assert.ok(chamadas.every((c) => c.url.startsWith('https://abc.supabase.co/rest/v1/')));
});

// ---------------------------------------------------------------------------
// Webhook: montagem

function montar(opcoes = {}) {
  const falso = stripeFalso(opcoes);
  const repo = repoDoPlano();
  const deps = { repo, stripe: falso.stripe, segredo: SEGREDO_WEBHOOK, modoReal: false, agora: () => AGORA };
  const enviar = async (e, extras) => {
    const resposta = await tratarWebhook(await pedidoAssinado(e, extras), deps);
    return { status: resposta.status, corpo: await resposta.json(), resposta };
  };
  const linha = (id = 'sub_1') => repo.assinaturas.get(id);
  return { ...falso, repo, deps, enviar, linha };
}

// ---------------------------------------------------------------------------
// Webhook: os quatro estados

test('webhook: PAGOU — checkout concluído e fatura paga ligam o plano', async (t) => {
  t.mock.method(console, 'error', () => {});
  const m = montar({ assinaturas: [assinaturaStripe({ status: 'incomplete' })] });
  let r = await m.enviar(evento('checkout.session.completed', { id: 'cs_1', object: 'checkout.session', customer: 'cus_1', subscription: 'sub_1' }));
  assert.equal(r.status, 200);
  assert.equal(m.linha().situacao, 'pendente');
  assert.equal(temBeneficio(m.linha(), AGORA), false, 'antes do pagamento confirmado, nada');

  m.estado.assinaturas[0].status = 'active';
  r = await m.enviar(evento('invoice.paid', { id: 'in_1', object: 'invoice', customer: 'cus_1' }));
  assert.equal(r.status, 200);
  const linha = m.linha();
  assert.equal(linha.situacao, 'ativa');
  assert.equal(linha.email, 'pessoa@exemplo.com');
  assert.equal(linha.fim_do_periodo, new Date((SEGUNDOS + 29 * DIA) * 1000).toISOString());
  assert.equal(temBeneficio(linha, AGORA), true);
  assert.ok(!JSON.stringify(linha).match(/\d{13,19}/), 'nenhum número de cartão');
});

test('webhook: FALHOU — cobrança recusada desliga o benefício; pagar depois religa', async () => {
  const m = montar();
  await m.enviar(evento('invoice.paid', { customer: 'cus_1' }));
  assert.equal(temBeneficio(m.linha(), AGORA), true);
  m.estado.assinaturas[0].status = 'past_due';
  const r = await m.enviar(evento('invoice.payment_failed', { customer: 'cus_1' }));
  assert.equal(r.status, 200);
  assert.equal(m.linha().situacao, 'falhou');
  assert.equal(temBeneficio(m.linha(), AGORA), false);
  m.estado.assinaturas[0].status = 'active';
  await m.enviar(evento('invoice.paid', { customer: 'cus_1' }));
  assert.equal(m.linha().situacao, 'ativa');
});

test('webhook: CANCELOU — vale até o fim do mês pago e depois acaba', async () => {
  const m = montar();
  await m.enviar(evento('customer.subscription.created', assinaturaStripe()));
  m.estado.assinaturas[0].cancel_at_period_end = true;
  await m.enviar(evento('customer.subscription.updated', assinaturaStripe({ cancel_at_period_end: true })));
  assert.equal(m.linha().situacao, 'ativa');
  assert.equal(m.linha().cancela_no_fim, true);
  assert.equal(temBeneficio(m.linha(), AGORA), true, 'o mês pago continua valendo');
  assert.equal(temBeneficio(m.linha(), new Date((SEGUNDOS + 30 * DIA) * 1000)), false, 'depois do fim, acaba');
  m.estado.assinaturas[0].status = 'canceled';
  await m.enviar(evento('customer.subscription.deleted', assinaturaStripe({ status: 'canceled' })));
  assert.equal(m.linha().situacao, 'cancelada');
  assert.equal(temBeneficio(m.linha(), AGORA), false);
});

test('webhook: REEMBOLSOU — reembolso integral cancela no Stripe e encerra; parcial não', async () => {
  const m = montar();
  await m.enviar(evento('invoice.paid', { customer: 'cus_1' }));
  let r = await m.enviar(evento('charge.refunded', { id: 'ch_1', object: 'charge', customer: 'cus_1', refunded: false, amount_refunded: 100 }));
  assert.equal(r.status, 200);
  assert.equal(m.linha().situacao, 'ativa', 'reembolso parcial não mexe no plano');
  assert.equal(m.estado.chamadas.filter((c) => c.metodo === 'DELETE').length, 0);

  r = await m.enviar(evento('charge.refunded', { id: 'ch_1', object: 'charge', customer: 'cus_1', refunded: true }));
  assert.equal(r.status, 200);
  assert.equal(m.estado.chamadas.filter((c) => c.metodo === 'DELETE').length, 1, 'cancelou no Stripe para não cobrar de novo');
  assert.equal(m.linha().situacao, 'reembolsada');
  assert.equal(m.linha().reembolsada_em, AGORA.toISOString());
  assert.equal(temBeneficio(m.linha(), AGORA), false);

  // O aviso de "assinatura apagada" que o Stripe manda depois não desfaz o reembolso.
  await m.enviar(evento('customer.subscription.deleted', assinaturaStripe({ status: 'canceled' })));
  assert.equal(m.linha().situacao, 'reembolsada');
});

test('webhook: reembolso depois de cancelar (arrependimento em 7 dias) marca a mais recente', async () => {
  const m = montar({
    assinaturas: [
      assinaturaStripe({ id: 'sub_velha', status: 'canceled', created: SEGUNDOS - 90 * DIA }),
      assinaturaStripe({ id: 'sub_nova', status: 'canceled', created: SEGUNDOS - 2 * DIA }),
    ],
  });
  await m.enviar(evento('charge.refunded', { id: 'ch_1', customer: 'cus_1', refunded: true }));
  assert.equal(m.estado.chamadas.filter((c) => c.metodo === 'DELETE').length, 0, 'nada para cancelar');
  assert.equal(m.linha('sub_nova').situacao, 'reembolsada');
  assert.equal(m.linha('sub_velha').situacao, 'cancelada');
});

test('webhook: contestação no cartão suspende; ganha a contestação, volta', async () => {
  const m = montar();
  await m.enviar(evento('invoice.paid', { customer: 'cus_1' }));
  await m.enviar(evento('charge.dispute.created', { id: 'dp_1', object: 'dispute', charge: 'ch_1', status: 'needs_response' }));
  assert.equal(m.linha().contestada, true);
  assert.equal(temBeneficio(m.linha(), AGORA), false);
  await m.enviar(evento('invoice.paid', { customer: 'cus_1' }));
  assert.equal(m.linha().contestada, true, 'continua suspensa até fechar');
  await m.enviar(evento('charge.dispute.closed', { id: 'dp_1', charge: 'ch_1', status: 'lost' }));
  assert.equal(m.linha().contestada, true);
  await m.enviar(evento('charge.dispute.closed', { id: 'dp_1', charge: 'ch_1', status: 'won' }));
  assert.equal(m.linha().contestada, false);
  assert.equal(temBeneficio(m.linha(), AGORA), true);
});

// ---------------------------------------------------------------------------
// Webhook: idempotência

test('webhook: o mesmo aviso duas vezes é processado uma vez só', async () => {
  const m = montar();
  const e = evento('charge.refunded', { id: 'ch_1', customer: 'cus_1', refunded: true });
  const primeira = await m.enviar(e);
  const chamadas = m.estado.chamadas.length;
  const segunda = await m.enviar(e);
  assert.equal(primeira.status, 200);
  assert.equal(segunda.status, 200);
  assert.equal(segunda.corpo.repetido, true);
  assert.equal(m.estado.chamadas.length, chamadas, 'nenhuma chamada nova ao Stripe');
  assert.equal(m.estado.chamadas.filter((c) => c.metodo === 'DELETE').length, 1);
  assert.equal(m.repo.eventos.size, 1);
});

test('webhook: se o banco falha, responde 500, não marca o evento, e o reenvio funciona', async (t) => {
  const erro = t.mock.method(console, 'error', () => {});
  const m = montar();
  m.repo.falharAoGravar = true;
  const e = evento('invoice.paid', { customer: 'cus_1' });
  assert.equal((await m.enviar(e)).status, 500);
  assert.equal(m.repo.eventos.size, 0);
  assert.doesNotMatch(erro.mock.calls[0].arguments[0], /@/);
  m.repo.falharAoGravar = false;
  assert.equal((await m.enviar(e)).status, 200);
  assert.equal(m.linha().situacao, 'ativa');
  assert.equal(m.repo.eventos.size, 1);
});

test('webhook: evento que não mexe no plano é só marcado; sem cliente, nada muda', async (t) => {
  t.mock.method(console, 'error', () => {});
  const m = montar();
  assert.equal((await m.enviar(evento('product.created', { id: 'prod_1' }))).status, 200);
  assert.equal(m.estado.chamadas.length, 0);
  assert.equal(m.repo.eventos.size, 1);
  assert.equal((await m.enviar(evento('invoice.paid', { customer: null }))).status, 200);
  assert.equal((await m.enviar(evento('charge.dispute.created', { charge: 'ch_naoexiste' }))).status, 500, 'cobrança sumida: Stripe tenta de novo');
  m.estado.clientes.cus_1 = { id: 'cus_1', deleted: true };
  assert.equal((await m.enviar(evento('invoice.paid', { customer: 'cus_1' }))).status, 200);
  m.estado.clientes.cus_1 = { id: 'cus_1', email: 'nao-e-email' };
  assert.equal((await m.enviar(evento('invoice.paid', { customer: 'cus_1' }))).status, 200);
  assert.equal(m.repo.assinaturas.size, 0);
  assert.ok(EVENTOS_TRATADOS.includes('charge.refunded'));
});

// ---------------------------------------------------------------------------
// Webhook: o navegador não muda nada

test('webhook: sem assinatura, assinatura falsa ou de outro segredo → 400 e nada gravado', async () => {
  const m = montar();
  const e = evento('invoice.paid', { customer: 'cus_1' });
  for (const extras of [{ cabecalho: null }, { cabecalho: 't=1,v1=abc' }, { segredo: 'whsec_de_outro_endpoint_0000000' }, { t: SEGUNDOS - 3600 }]) {
    const r = await m.enviar(e, extras);
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro, 'assinatura inválida');
  }
  assert.equal(m.repo.assinaturas.size, 0);
  assert.equal(m.estado.chamadas.length, 0);
});

test('webhook: método, tamanho, formato, modo e configuração', async (t) => {
  t.mock.method(console, 'error', () => {});
  const m = montar();
  assert.equal((await tratarWebhook(await pedidoAssinado('', { metodo: 'GET' }), m.deps)).status, 405);
  assert.equal((await tratarWebhook(await pedidoAssinado({}), { ...m.deps, stripe: null })).status, 503);
  assert.equal((await tratarWebhook(await pedidoAssinado({}), { ...m.deps, repo: null })).status, 503);
  assert.equal((await tratarWebhook(await pedidoAssinado({}), { ...m.deps, segredo: '' })).status, 503);

  const grande = 'x'.repeat(CORPO_MAXIMO + 1);
  assert.equal((await tratarWebhook(await pedidoAssinado(grande), m.deps)).status, 413);
  const mentiroso = { method: 'POST', headers: new Headers({ 'content-length': '10' }), text: async () => grande };
  assert.equal((await tratarWebhook(mentiroso, m.deps)).status, 413);

  assert.equal((await m.enviar('isto não é json')).corpo.erro, 'formato');
  assert.equal((await m.enviar({ id: 'evt_1' })).corpo.erro, 'formato');
  assert.equal((await m.enviar(evento('invoice.paid', { customer: 'cus_1' }, { id: 'evt_../x' }))).corpo.erro, 'formato');

  const real = await m.enviar(evento('invoice.paid', { customer: 'cus_1' }, { livemode: true }));
  assert.equal(real.status, 400);
  assert.equal(real.corpo.erro, 'modo errado', 'site em modo de teste não aceita evento real');
  const r = await tratarWebhook(await pedidoAssinado(evento('invoice.paid', { customer: 'cus_1' })), { ...m.deps, modoReal: true });
  assert.equal((await r.json()).erro, 'modo errado', 'site em modo real não aceita evento de teste');
  assert.equal(m.repo.assinaturas.size, 0);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

// ---------------------------------------------------------------------------
// Cloudflare

test('cloudflare: sem configuração o webhook responde 503; chave real recusada no modo de teste', async () => {
  assert.equal(modoReal({}), false);
  assert.equal(modoReal({ PLANO_MODO_REAL: 'sim' }), false);
  assert.equal(modoReal({ PLANO_MODO_REAL: 'ligado' }), true);
  const vazio = dependenciasDoPlano({});
  assert.equal(vazio.repo, null);
  assert.equal(vazio.stripe, null);
  assert.equal(vazio.segredo, '');
  assert.ok(vazio.agora() instanceof Date);
  const comReal = dependenciasDoPlano({ STRIPE_SECRET_KEY: SK_LIVE, SUPABASE_URL: 'https://a.supabase.co', SUPABASE_SECRET_KEY: 'x' });
  assert.equal(comReal.stripe, null, 'chave de produção sem PLANO_MODO_REAL=ligado');
  assert.ok(comReal.repo);
  const ligado = dependenciasDoPlano({ STRIPE_SECRET_KEY: SK_LIVE, PLANO_MODO_REAL: 'ligado', STRIPE_WEBHOOK_SECRET: SEGREDO_WEBHOOK });
  assert.equal(ligado.stripe.modoTeste, false);
  assert.equal(ligado.segredo, SEGREDO_WEBHOOK);
  const resposta = await onRequest({ request: await pedidoAssinado({}), env: {} });
  assert.equal(resposta.status, 503);
});

// ---------------------------------------------------------------------------
// Alertas lendo o plano

test('alertas: o banco dos alertas pergunta pelo plano com a mesma regra', async () => {
  const { repositorioSupabase } = await import('../servidor/alertas/supabase.js');
  const futuro = new Date(AGORA.getTime() + DIA * 1000).toISOString();
  const chamadas = [];
  const respostas = [
    [{ situacao: 'cancelada', contestada: false, fim_do_periodo: futuro }, { situacao: 'ativa', contestada: false, fim_do_periodo: futuro }],
    [],
    [{ email: 'a@exemplo.com', situacao: 'ativa', contestada: false, fim_do_periodo: futuro },
      { email: 'b@exemplo.com', situacao: 'ativa', contestada: true, fim_do_periodo: futuro }],
    null,
  ];
  const buscar = async (url) => {
    chamadas.push(String(url));
    const corpo = respostas.shift();
    return new Response(corpo === null ? '' : JSON.stringify(corpo), { status: 200 });
  };
  const repo = repositorioSupabase({ url: 'https://abc.supabase.co', chave: 'sb_secret_x', fetch: buscar });
  assert.equal(await repo.temPlano('a+b@exemplo.com', AGORA), true);
  assert.match(chamadas[0], /plano_assinaturas\?select=situacao,contestada,fim_do_periodo&email=eq\.a%2Bb%40exemplo\.com$/);
  assert.equal(await repo.temPlano('c@exemplo.com', AGORA), false);
  assert.deepEqual([...await repo.emailsComPlano(AGORA)], ['a@exemplo.com']);
  assert.deepEqual([...await repo.emailsComPlano(AGORA)], []);
});
