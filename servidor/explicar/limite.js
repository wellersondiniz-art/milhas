// Limites do "explica pra mim", guardados no Workers KV:
//   - por pessoa: até N explicações por dia (horário de São Paulo). A
//     "pessoa" é um resumo HMAC-SHA-256 do IP com chave secreta; o IP em si
//     não é guardado, e a chave do KV some sozinha em 2 dias;
//   - no total: até N explicações por dia, para um ataque não gastar o teto
//     do mês numa tarde;
//   - teto de gasto do mês: soma o custo real de cada chamada (em
//     nanodólares) e, ANTES de chamar, confere se o custo máximo da próxima
//     tentativa ainda cabe. Se não couber, não chama.
//
// O KV é "eventualmente consistente": pedidos no mesmo segundo podem passar
// juntos, e o teto pode estourar por alguns centavos de dólar. A segunda
// trava é o limite de gasto na própria conta da Anthropic (README).

const DIA = 86_400;

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
 * Lê os contadores, sem gravar nada.
 * @param {string} hoje  "AAAA-MM-DD" em São Paulo
 * @returns {{ ok: true, lido: object } | { ok: false, motivo: 'pessoa'|'dia'|'teto' }}
 */
export async function podeExplicar(kv, { resumo, hoje, porPessoa, porDia, tetoNano }) {
  const mes = hoje.slice(0, 7);
  const lido = {
    pessoa: { chave: `explicar:pessoa:${resumo}:${hoje}`, ttl: 2 * DIA },
    dia: { chave: `explicar:dia:${hoje}`, ttl: 2 * DIA },
    gasto: { chave: `explicar:gasto:${mes}`, ttl: 62 * DIA },
    tetoNano,
  };
  const [p, d, g] = await Promise.all([kv.get(lido.pessoa.chave), kv.get(lido.dia.chave), kv.get(lido.gasto.chave)]);
  lido.pessoa.valor = numero(p);
  lido.dia.valor = numero(d);
  lido.gasto.valor = numero(g);
  if (lido.gasto.valor >= tetoNano) return { ok: false, motivo: 'teto' };
  if (lido.pessoa.valor >= porPessoa) return { ok: false, motivo: 'pessoa' };
  if (lido.dia.valor >= porDia) return { ok: false, motivo: 'dia' };
  return { ok: true, lido };
}

/** A próxima tentativa, com custo máximo `custoNano`, cabe no teto do mês? */
export function cabeNoTeto(lido, gastoNestePedido, custoNano) {
  return lido.gasto.valor + gastoNestePedido + custoNano <= lido.tetoNano;
}

/** Grava o uso: +1 para a pessoa e para o dia, + o custo no mês. */
export async function registrar(kv, lido, gastoNano) {
  const escritas = [
    kv.put(lido.pessoa.chave, String(lido.pessoa.valor + 1), { expirationTtl: lido.pessoa.ttl }),
    kv.put(lido.dia.chave, String(lido.dia.valor + 1), { expirationTtl: lido.dia.ttl }),
  ];
  if (gastoNano > 0) {
    escritas.push(kv.put(lido.gasto.chave, String(lido.gasto.valor + gastoNano), { expirationTtl: lido.gasto.ttl }));
  }
  await Promise.all(escritas);
}
