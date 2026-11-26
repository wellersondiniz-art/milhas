// Peças falsas para testar o plano pago sem Stripe e sem Supabase.
import { assinarComoStripe } from '../../servidor/plano/assinatura.js';
import { clienteStripe } from '../../servidor/plano/stripe.js';

export const SEGREDO_WEBHOOK = 'whsec_teste_0123456789abcdefghij';
export const CHAVE_TESTE = 'rk_test_0123456789abcdef';
export const AGORA = new Date('2026-11-24T12:00:00Z');
export const SEGUNDOS = Math.floor(AGORA.getTime() / 1000);
const DIA = 24 * 60 * 60;

/** Assinatura do Stripe no formato novo (data do período nos itens). */
export function assinaturaStripe(campos = {}) {
  return {
    id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
    created: SEGUNDOS - DIA,
    items: { data: [{ id: 'si_1', current_period_end: SEGUNDOS + 29 * DIA }] },
    ...campos,
  };
}

/**
 * API do Stripe em memória, servida por um fetch falso para exercitar o
 * clienteStripe de verdade. `estado.assinaturas` pode ser trocado entre eventos.
 */
export function stripeFalso({ email = 'Pessoa@Exemplo.com ', assinaturas = [assinaturaStripe()] } = {}) {
  const estado = {
    clientes: { cus_1: { id: 'cus_1', object: 'customer', email } },
    cobrancas: { ch_1: { id: 'ch_1', customer: 'cus_1' } },
    assinaturas,
    chamadas: [],
    falhar: false,
  };
  const buscar = async (url, opcoes = {}) => {
    const u = new URL(url);
    const metodo = opcoes.method ?? 'GET';
    estado.chamadas.push({ metodo, caminho: u.pathname + u.search, cabecalhos: opcoes.headers });
    const json = (status, corpo) => new Response(JSON.stringify(corpo), { status });
    if (estado.falhar) return json(500, { error: { message: 'pessoa@exemplo.com' } });
    let m;
    if ((m = /^\/v1\/customers\/(\w+)$/.exec(u.pathname))) {
      return estado.clientes[m[1]] ? json(200, estado.clientes[m[1]]) : json(404, {});
    }
    if ((m = /^\/v1\/charges\/(\w+)$/.exec(u.pathname))) {
      return estado.cobrancas[m[1]] ? json(200, estado.cobrancas[m[1]]) : json(404, {});
    }
    if (u.pathname === '/v1/subscriptions') {
      const cliente = u.searchParams.get('customer');
      return json(200, { object: 'list', data: estado.assinaturas.filter((a) => a.customer === cliente) });
    }
    if ((m = /^\/v1\/subscriptions\/(\w+)$/.exec(u.pathname)) && metodo === 'DELETE') {
      const a = estado.assinaturas.find((x) => x.id === m[1]);
      if (!a) return json(404, {});
      a.status = 'canceled';
      return json(200, a);
    }
    return json(404, {});
  };
  return { estado, stripe: clienteStripe({ chave: CHAVE_TESTE, fetch: buscar }), buscar };
}

/** Mesmo contrato de servidor/plano/supabase.js, em memória. */
export function repoDoPlano() {
  const assinaturas = new Map();
  const eventos = new Map();
  return {
    assinaturas, eventos,
    falharAoGravar: false,
    async eventoJaProcessado(id) { return eventos.has(id); },
    async registrarEvento(e) {
      if (eventos.has(e.stripe_evento_id)) return false;
      eventos.set(e.stripe_evento_id, e.tipo);
      return true;
    },
    async assinaturaPorStripeId(id) { return assinaturas.has(id) ? structuredClone(assinaturas.get(id)) : null; },
    async gravarAssinatura(linha) {
      if (this.falharAoGravar) { const e = new Error('banco'); e.status = 503; throw e; }
      assinaturas.set(linha.stripe_assinatura_id, { ...(assinaturas.get(linha.stripe_assinatura_id) ?? {}), ...structuredClone(linha) });
    },
  };
}

let contador = 0;
/** Evento do Stripe. */
export function evento(tipo, objeto, campos = {}) {
  contador += 1;
  return { id: `evt_teste${contador}`, object: 'event', type: tipo, created: SEGUNDOS, livemode: false, data: { object: objeto }, ...campos };
}

/** Pedido assinado como o Stripe assinaria. */
export async function pedidoAssinado(corpoObjeto, { segredo = SEGREDO_WEBHOOK, t = SEGUNDOS, cabecalho, metodo = 'POST' } = {}) {
  const corpo = typeof corpoObjeto === 'string' ? corpoObjeto : JSON.stringify(corpoObjeto);
  const assinatura = cabecalho === undefined ? await assinarComoStripe({ corpo, segredo, t }) : cabecalho;
  const headers = { 'Content-Type': 'application/json' };
  if (assinatura !== null) headers['Stripe-Signature'] = assinatura;
  return new Request('https://milhas.exemplo/api/plano/stripe', { method: metodo, headers, body: metodo === 'GET' ? undefined : corpo });
}
