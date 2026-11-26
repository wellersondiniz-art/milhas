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
// Ordem (achado S2 da revisão independente): a vaga é RESERVADA antes de
// chamar o modelo (+1 para a pessoa e o dia, + o custo máximo no mês) e o
// gasto é acertado depois, com o custo real. Antes, o código lia, chamava o
// modelo (segundos) e só então gravava: 50 pedidos ao mesmo tempo passavam
// todos. Além disso, cada cópia do servidor deixa só UM pedido por pessoa de
// cada vez (umPorVez).
//
// O KV continua "eventualmente consistente": pedidos no mesmo instante, em
// pontos diferentes da rede, ainda podem passar juntos. Por isso o limite de
// gasto na conta da Anthropic e a regra de limite no painel da Cloudflare são
// OBRIGATÓRIOS antes de ligar o botão (README).

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

/**
 * Reserva a vaga ANTES de chamar o modelo: +1 para a pessoa e para o dia, e o
 * custo máximo previsto no gasto do mês.
 */
export async function reservar(kv, lido, reservaNano) {
  const escritas = [
    kv.put(lido.pessoa.chave, String(lido.pessoa.valor + 1), { expirationTtl: lido.pessoa.ttl }),
    kv.put(lido.dia.chave, String(lido.dia.valor + 1), { expirationTtl: lido.dia.ttl }),
  ];
  if (reservaNano > 0) {
    escritas.push(kv.put(lido.gasto.chave, String(lido.gasto.valor + reservaNano), { expirationTtl: lido.gasto.ttl }));
  }
  await Promise.all(escritas);
}

/**
 * Depois da chamada, troca a reserva pelo custo real. Lê o valor de novo,
 * porque outros pedidos podem ter reservado no meio tempo.
 */
export async function acertarGasto(kv, lido, reservaNano, gastoNano) {
  if (gastoNano === reservaNano) return;
  const atual = numero(await kv.get(lido.gasto.chave));
  await kv.put(lido.gasto.chave, String(Math.max(0, atual - reservaNano + gastoNano)), { expirationTtl: lido.gasto.ttl });
}

// Pedidos em andamento nesta cópia do servidor, por pessoa (resumo do IP).
const emAndamento = new Set();

/**
 * Deixa só um pedido por pessoa de cada vez nesta cópia do servidor.
 * @returns {null | (() => void)} função para liberar, ou null se já há um em andamento.
 */
export function umPorVez(resumo) {
  if (emAndamento.has(resumo)) return null;
  emAndamento.add(resumo);
  return () => emAndamento.delete(resumo);
}
