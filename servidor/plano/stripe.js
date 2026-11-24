// Chamadas à API do Stripe, sem a biblioteca do Stripe (fetch puro).
//
// Só o servidor usa: a chave fica em STRIPE_SECRET_KEY no ambiente da
// Cloudflare, nunca no site nem no Git. Use uma chave restrita (rk_) com:
//   Customers: leitura · Subscriptions: escrita (ler e cancelar no reembolso)
//
// Modo de teste: enquanto PLANO_MODO_REAL não for "ligado", só aceitamos
// chaves de teste (sk_test_ / rk_test_). Uma chave de produção é recusada e o
// webhook responde 503: nada é cobrado nem gravado.

const API = 'https://api.stripe.com/v1';

export class ErroDoStripe extends Error {
  constructor(operacao, status) {
    super(`Stripe: ${operacao} falhou (status ${status})`);
    this.status = status;
  }
}

/** A chave serve para o modo pedido? */
export function chaveAceita(chave, modoReal) {
  if (typeof chave !== 'string') return false;
  if (/^(sk|rk)_test_[A-Za-z0-9]{10,}$/.test(chave)) return true;
  return modoReal === true && /^(sk|rk)_live_[A-Za-z0-9]{10,}$/.test(chave);
}

const ID = {
  cliente: /^cus_[A-Za-z0-9]{1,250}$/,
  cobranca: /^(ch|py)_[A-Za-z0-9]{1,250}$/,
  assinatura: /^sub_[A-Za-z0-9]{1,250}$/,
};

/**
 * @param {object} o
 * @param {string} o.chave     STRIPE_SECRET_KEY
 * @param {boolean} o.modoReal PLANO_MODO_REAL === "ligado"
 * @param {typeof fetch} [o.fetch]
 * @returns {null|object} null quando a chave não serve
 */
export function clienteStripe({ chave, modoReal = false, fetch: buscar = globalThis.fetch }) {
  if (!chaveAceita(chave, modoReal)) return null;

  async function pedir(operacao, caminho, { method = 'GET', idempotencia } = {}) {
    const resposta = await buscar(`${API}/${caminho}`, {
      method,
      headers: {
        Authorization: `Bearer ${chave}`,
        ...(idempotencia ? { 'Idempotency-Key': idempotencia } : {}),
      },
    });
    if (!resposta.ok) throw new ErroDoStripe(operacao, resposta.status);
    return resposta.json();
  }

  return {
    modoTeste: !modoReal,
    async cliente(id) {
      if (!ID.cliente.test(id ?? '')) return null;
      return pedir('ler cliente', `customers/${id}`);
    },
    /** Cobrança (para achar o cliente de uma contestação). */
    async cobranca(id) {
      if (!ID.cobranca.test(id ?? '')) return null;
      return pedir('ler cobrança', `charges/${id}`);
    },
    /** Todas as assinaturas do cliente, em qualquer situação. */
    async assinaturasDoCliente(id) {
      if (!ID.cliente.test(id ?? '')) return [];
      const lista = await pedir('listar assinaturas', `subscriptions?customer=${id}&status=all&limit=100`);
      return Array.isArray(lista?.data) ? lista.data : [];
    },
    /** Cancela na hora (usado depois de um reembolso integral). */
    async cancelarAssinatura(id) {
      if (!ID.assinatura.test(id ?? '')) return null;
      return pedir('cancelar assinatura', `subscriptions/${id}`, { method: 'DELETE', idempotencia: `cancelar-${id}` });
    },
  };
}
