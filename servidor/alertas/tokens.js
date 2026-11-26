// Tokens dos links dos e-mails. Usa só a Web Crypto, que existe no Node 22 e
// na Cloudflare. Nada de e-mail nos links: só ids aleatórios e assinaturas.
//
// - Confirmação: token aleatório de 32 bytes. O banco guarda só o SHA-256
//   dele; quem lê o banco não consegue confirmar por ninguém.
// - Cancelamento: HMAC-SHA256(segredo, "cancelar:" + id da inscrição). Não
//   precisa guardar nada e vale em todo e-mail, inclusive no de confirmação.

const codificador = new TextEncoder();

export function base64url(bytes) {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function novoToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 em hexadecimal (o que vai para o banco). */
export async function resumo(texto) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', codificador.encode(texto)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function chaveHmac(segredo) {
  if (typeof segredo !== 'string' || segredo.length < 32) throw new Error('ALERTAS_SEGREDO precisa ter pelo menos 32 caracteres');
  return crypto.subtle.importKey('raw', codificador.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function assinaturaDeCancelamento(segredo, inscricaoId) {
  const chave = await chaveHmac(segredo);
  const assinatura = await crypto.subtle.sign('HMAC', chave, codificador.encode(`cancelar:${inscricaoId}`));
  return base64url(new Uint8Array(assinatura));
}

/** Compara em tempo constante (o verify da Web Crypto já é). */
export async function conferirCancelamento(segredo, inscricaoId, assinatura) {
  if (typeof assinatura !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(assinatura)) return false;
  const chave = await chaveHmac(segredo);
  const binario = atob(assinatura.replace(/-/g, '+').replace(/_/g, '/') + '=');
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return crypto.subtle.verify('HMAC', chave, bytes, codificador.encode(`cancelar:${inscricaoId}`));
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
