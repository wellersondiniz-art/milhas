// Confere a assinatura dos avisos (webhooks) do Stripe, sem a biblioteca do
// Stripe: só Web Crypto, que existe no Node 22 e na Cloudflare.
//
// Cabeçalho Stripe-Signature: "t=<segundos>,v1=<hex>[,v1=<hex>...]".
// Conta assinada: HMAC-SHA256(segredo do endpoint, `${t}.${corpo bruto}`).
// https://docs.stripe.com/webhooks#verify-manually
//
// O corpo tem de ser o texto exatamente como chegou: nada de JSON.parse antes.

const codificador = new TextEncoder();

/** Avisos com mais de 5 minutos (para trás ou para frente) são recusados. */
export const TOLERANCIA_SEGUNDOS = 300;

function lerCabecalho(cabecalho) {
  if (typeof cabecalho !== 'string' || cabecalho.length > 2000) return null;
  let t = null;
  const v1 = [];
  for (const parte of cabecalho.split(',')) {
    const i = parte.indexOf('=');
    if (i < 1) continue;
    const chave = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    if (chave === 't' && /^\d{1,12}$/.test(valor)) t = Number(valor);
    if (chave === 'v1' && /^[0-9a-f]{64}$/.test(valor)) v1.push(valor);
  }
  return t === null || !v1.length ? null : { t, v1 };
}

function hexParaBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * @param {object} o
 * @param {string} o.corpo      corpo bruto do pedido
 * @param {string|null} o.cabecalho  valor de Stripe-Signature
 * @param {string} o.segredo    STRIPE_WEBHOOK_SECRET (whsec_...)
 * @param {Date}   o.agora
 * @returns {Promise<boolean>}
 */
export async function avisoDoStripeValido({ corpo, cabecalho, segredo, agora }) {
  if (typeof segredo !== 'string' || !segredo.startsWith('whsec_') || typeof corpo !== 'string') return false;
  const lido = lerCabecalho(cabecalho);
  if (!lido) return false;
  if (Math.abs(Math.floor(agora.getTime() / 1000) - lido.t) > TOLERANCIA_SEGUNDOS) return false;
  const chave = await crypto.subtle.importKey('raw', codificador.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const conteudo = codificador.encode(`${lido.t}.${corpo}`);
  for (const assinatura of lido.v1) {
    // verify da Web Crypto compara em tempo constante.
    if (await crypto.subtle.verify('HMAC', chave, hexParaBytes(assinatura), conteudo)) return true;
  }
  return false;
}

/** Monta um cabeçalho válido. Só para testes e para o simulador local. */
export async function assinarComoStripe({ corpo, segredo, t }) {
  const chave = await crypto.subtle.importKey('raw', codificador.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', chave, codificador.encode(`${t}.${corpo}`)));
  return `t=${t},v1=${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
