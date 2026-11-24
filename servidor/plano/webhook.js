// Webhook do Stripe: POST /api/plano/stripe (functions/api/plano/stripe.js).
//
// É o ÚNICO caminho que muda a situação do plano. Não há rota do navegador
// que grave plano_assinaturas.
//
// Passos:
//  1. Confere a assinatura do aviso (Stripe-Signature) com o corpo bruto.
//  2. Confere o modo: aviso de teste só com o site em modo de teste, e vice-versa.
//  3. Idempotência: se o id do evento já foi processado, responde 200 e para.
//  4. Não confia no conteúdo do aviso para a situação: busca o cliente e as
//     assinaturas dele na API do Stripe e grava o estado de agora. Assim,
//     avisos repetidos, atrasados ou fora de ordem dão o mesmo resultado.
//  5. Só depois de gravar marca o evento como processado. Se algo falhar no
//     meio, responde 500 e o Stripe manda de novo.

import { avisoDoStripeValido } from './assinatura.js';
import { linhaDaAssinatura } from './regras.js';

/** Maior corpo aceito. Avisos do Stripe têm poucos KB. */
export const CORPO_MAXIMO = 256 * 1024;

/** Tipos de evento que mexem no plano. Ligue estes no painel do Stripe. */
export const EVENTOS_TRATADOS = Object.freeze([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
]);

const CABECALHOS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
});
const responder = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });

const idDe = (x) => (typeof x === 'string' ? x : (typeof x?.id === 'string' ? x.id : null));

function eventoBemFormado(e) {
  return e && typeof e === 'object'
    && typeof e.id === 'string' && /^evt_[A-Za-z0-9]{1,250}$/.test(e.id)
    && typeof e.type === 'string' && e.type.length <= 100
    && Number.isInteger(e.created)
    && typeof e.livemode === 'boolean'
    && e.data && typeof e.data.object === 'object' && e.data.object !== null;
}

/** Acha o cliente do Stripe dono do evento. */
async function clienteDoEvento(evento, stripe) {
  const objeto = evento.data.object;
  if (evento.type.startsWith('charge.dispute.')) {
    const cobranca = await stripe.cobranca(idDe(objeto.charge));
    return idDe(cobranca?.customer);
  }
  return idDe(objeto.customer);
}

/**
 * Processa um evento já conferido. Exportada para os testes.
 * @returns {Promise<{gravadas: number, canceladas: number}>}
 */
export async function processarEvento(evento, { repo, stripe }) {
  const resultado = { gravadas: 0, canceladas: 0 };
  const clienteId = await clienteDoEvento(evento, stripe);
  if (!clienteId) return resultado;
  const cliente = await stripe.cliente(clienteId);
  if (!cliente || cliente.deleted) return resultado;
  let assinaturas = await stripe.assinaturasDoCliente(clienteId);
  const eventoEm = new Date(evento.created * 1000);
  const objeto = evento.data.object;
  const marcas = new Map(); // id da assinatura → campos que o evento decide

  if (evento.type === 'charge.refunded' && objeto.refunded === true) {
    // Reembolso integral = fim do plano. Cancela no Stripe o que ainda está
    // de pé, para não cobrar de novo. Se já estava cancelada (a pessoa
    // cancelou e pediu o dinheiro de volta nos 7 dias), marca a mais recente.
    const dePe = assinaturas.filter((a) => a.status !== 'canceled' && a.status !== 'incomplete_expired');
    const alvos = dePe.length ? dePe : [...assinaturas].sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).slice(0, 1);
    for (const alvo of alvos) {
      if (alvo.status !== 'canceled') {
        const cancelada = await stripe.cancelarAssinatura(alvo.id);
        resultado.canceladas += 1;
        assinaturas = assinaturas.map((a) => (a.id === alvo.id ? (cancelada ?? { ...a, status: 'canceled' }) : a));
      }
      marcas.set(alvo.id, { situacao: 'reembolsada', reembolsada_em: eventoEm.toISOString() });
    }
  }
  if (evento.type === 'charge.dispute.created') {
    for (const a of assinaturas) marcas.set(a.id, { contestada: true });
  }
  if (evento.type === 'charge.dispute.closed' && objeto.status === 'won') {
    for (const a of assinaturas) marcas.set(a.id, { contestada: false });
  }

  for (const assinatura of assinaturas) {
    const atual = await repo.assinaturaPorStripeId(assinatura.id);
    const linha = linhaDaAssinatura(assinatura, cliente.email, eventoEm, atual);
    if (!linha) continue;
    await repo.gravarAssinatura({ ...linha, ...(marcas.get(assinatura.id) ?? {}) });
    resultado.gravadas += 1;
  }
  return resultado;
}

/**
 * @param {Request} request
 * @param {object} deps { repo, stripe, segredo, modoReal, agora }
 */
export async function tratarWebhook(request, deps) {
  if (request.method !== 'POST') return responder(405, { erro: 'use POST' });
  if (!deps.repo || !deps.stripe || !deps.segredo) return responder(503, { erro: 'plano fora do ar' });

  const tamanho = Number(request.headers.get('content-length') ?? 0);
  if (tamanho > CORPO_MAXIMO) return responder(413, { erro: 'grande demais' });
  const corpo = await request.text();
  if (corpo.length > CORPO_MAXIMO) return responder(413, { erro: 'grande demais' });

  const valido = await avisoDoStripeValido({
    corpo, cabecalho: request.headers.get('stripe-signature'), segredo: deps.segredo, agora: deps.agora(),
  });
  if (!valido) return responder(400, { erro: 'assinatura inválida' });

  let evento;
  try {
    evento = JSON.parse(corpo);
  } catch {
    return responder(400, { erro: 'formato' });
  }
  if (!eventoBemFormado(evento)) return responder(400, { erro: 'formato' });
  if (evento.livemode !== Boolean(deps.modoReal)) {
    console.error(`plano: evento ${evento.livemode ? 'real' : 'de teste'} recusado (site em modo ${deps.modoReal ? 'real' : 'de teste'})`);
    return responder(400, { erro: 'modo errado' });
  }

  try {
    if (await deps.repo.eventoJaProcessado(evento.id)) return responder(200, { recebido: true, repetido: true });
    if (EVENTOS_TRATADOS.includes(evento.type)) await processarEvento(evento, deps);
    await deps.repo.registrarEvento({ stripe_evento_id: evento.id, tipo: evento.type });
  } catch (erro) {
    // Sem corpo nem e-mail no log. O Stripe tenta de novo com 5xx.
    console.error(`plano: ${evento.type} falhou (${erro?.status ?? 'sem status'})`);
    return responder(500, { erro: 'tente de novo' });
  }
  return responder(200, { recebido: true });
}
