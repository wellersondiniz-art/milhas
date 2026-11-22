// Limite de envios do "Essa informação está errada?", guardado no Workers KV.
//
// - Por pessoa: até POR_HORA envios na mesma hora cheia. A "pessoa" é um
//   resumo HMAC-SHA-256 do IP com chave secreta: o IP em si não é guardado, e
//   a chave do KV some sozinha depois de uma hora (expirationTtl).
// - No total: até POR_DIA envios por dia (horário de São Paulo), para um
//   ataque não encher a caixa de issues nem gastar a cota do KV.
//
// O KV é "eventualmente consistente": dois envios no mesmo segundo podem
// passar juntos. Para um formulário de aviso, isso basta. Uma regra de
// limite no painel da Cloudflare (README) é a segunda camada.

export const POR_HORA = 5;
export const POR_DIA = 50;
const HORA_MS = 3_600_000;

/** Resumo do IP: HMAC-SHA-256 em hexadecimal, 32 caracteres. */
export async function resumoDoIp(ip, chave) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(ip)));
  return [...assinatura.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function numero(valor) {
  const n = Number.parseInt(valor ?? '0', 10);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * Lê os dois contadores. Não grava nada: quem cai na armadilha ou manda
 * dado inválido não gasta escrita do KV.
 *
 * @returns {{ ok: true, pessoa: object, dia: object } | { ok: false, motivo: 'pessoa'|'dia', esperarSegundos: number }}
 */
export async function podeEnviar(kv, resumo, agora, hoje) {
  const ms = agora.getTime();
  const hora = Math.floor(ms / HORA_MS);
  const pessoa = { chave: `reporte:pessoa:${resumo}:${hora}`, ttl: 3600 };
  const dia = { chave: `reporte:dia:${hoje}`, ttl: 2 * 86_400 };
  const [nPessoa, nDia] = await Promise.all([kv.get(pessoa.chave), kv.get(dia.chave)]);
  pessoa.valor = numero(nPessoa);
  dia.valor = numero(nDia);
  if (pessoa.valor >= POR_HORA) {
    return { ok: false, motivo: 'pessoa', esperarSegundos: Math.max(60, Math.ceil(((hora + 1) * HORA_MS - ms) / 1000)) };
  }
  if (dia.valor >= POR_DIA) return { ok: false, motivo: 'dia', esperarSegundos: 3600 };
  return { ok: true, pessoa, dia };
}

/** Soma 1 aos dois contadores lidos por podeEnviar. */
export async function consumir(kv, lido) {
  await Promise.all([lido.pessoa, lido.dia].map((c) => kv.put(c.chave, String(c.valor + 1), { expirationTtl: c.ttl })));
}
