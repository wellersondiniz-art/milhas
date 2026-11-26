// Chamada ao modelo com tempo-limite, nova tentativa e modelo de reserva.
//
//   - Cada tentativa tem tempo-limite (TEMPO.porTentativa) e o pedido inteiro
//     também (TEMPO.total).
//   - Repete no mesmo modelo só erro passageiro: 408, 409, 429, 500, 502, 503,
//     504, 529, queda de rede e tempo esgotado. Espera base × 2^n com sorteio
//     (jitter) e respeita o cabeçalho retry-after; se ele pedir mais que
//     TEMPO.esperaMaxima, passa direto para o próximo modelo.
//   - 400, 404, 413 e 422 não adiantam repetir: passa para o próximo modelo
//     (ex.: modelo retirado, parâmetro que aquele modelo não aceita).
//   - 401 e 403 são problema da chave: para tudo (o outro modelo usaria a
//     mesma chave).
//   - Recusa do modelo (stop_reason "refusal") não troca de modelo: a
//     pergunta é que não serve, e a pessoa vê o recado fixo.
//   - Antes de cada tentativa confere se o custo máximo cabe no teto do mês.
// O registro (log) diz qual modelo respondeu e por que houve troca, nunca a
// chave nem o texto da pessoa.

import { ENDERECO_API, MODELOS, TEMPO, TENTATIVAS_POR_MODELO, VERSAO_API, custoMaximo, custoReal } from './config.js';

const PASSAGEIRO = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const TROCAR_DE_MODELO = new Set([400, 404, 413, 422]);
const PROBLEMA_DE_CHAVE = new Set([401, 403]);

/** Espera antes da tentativa n (0, 1, ...): base × 2^n, com sorteio entre 50% e 100%. */
export function esperaDaTentativa(n, sorteio) {
  const teto = Math.min(TEMPO.esperaMaxima, TEMPO.esperaBase * 2 ** n);
  return Math.round(teto / 2 + (teto / 2) * sorteio());
}

/** retry-after em milissegundos (segundos ou data HTTP), ou null. */
export function lerRetryAfter(valor, agoraMs) {
  if (!valor) return null;
  if (/^\d+(\.\d+)?$/.test(valor.trim())) return Math.round(Number(valor) * 1000);
  const quando = Date.parse(valor);
  return Number.isNaN(quando) ? null : Math.max(0, quando - agoraMs);
}

function textoDaResposta(json) {
  return (json?.content ?? []).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
}

/**
 * @param {object} o
 * @param {(modelo: object) => object} o.pedidoPara   corpo do pedido para aquele modelo
 * @param {(pedido: object) => number} o.tokensDeEntrada  estimativa por cima
 * @param {string} o.chave                 ANTHROPIC_API_KEY
 * @param {(custo: number) => boolean} o.cabe   o custo máximo da tentativa cabe no teto?
 * @param {typeof fetch} [o.buscar]
 * @param {(ms: number) => Promise<void>} [o.esperar]
 * @param {() => number} [o.sorteio]       0 ≤ x < 1
 * @param {() => number} [o.relogio]       milissegundos
 * @param {(registro: object) => void} [o.log]
 * @param {object[]} [o.modelos]
 * @returns {Promise<{ ok: true, texto: string, modelo: string, gasto: number }
 *   | { ok: false, motivo: 'recusa'|'teto'|'chave'|'falha', gasto: number }>}
 */
export async function chamarComReserva({
  pedidoPara, tokensDeEntrada, chave, cabe,
  buscar = fetch,
  esperar = (ms) => new Promise((r) => setTimeout(r, ms)),
  sorteio = Math.random,
  relogio = Date.now,
  log = () => {},
  modelos = MODELOS,
}) {
  const inicio = relogio();
  let gasto = 0;
  for (const [i, modelo] of modelos.entries()) {
    const pedido = pedidoPara(modelo);
    const maximo = custoMaximo(modelo, tokensDeEntrada(pedido));
    for (let tentativa = 0; tentativa < TENTATIVAS_POR_MODELO; tentativa++) {
      const restante = TEMPO.total - (relogio() - inicio);
      if (restante <= 500) {
        log({ evento: 'tempo_total_esgotado', modelo: modelo.id });
        return { ok: false, motivo: 'falha', gasto };
      }
      if (!cabe(gasto + maximo)) {
        log({ evento: 'teto_do_mes', modelo: modelo.id });
        return { ok: false, motivo: 'teto', gasto };
      }
      let resposta;
      try {
        resposta = await buscar(ENDERECO_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': VERSAO_API },
          body: JSON.stringify(pedido),
          signal: AbortSignal.timeout(Math.min(TEMPO.porTentativa, restante)),
        });
      } catch (erro) {
        // Tempo esgotado ou rede caiu. A API pode ter cobrado: conta o máximo.
        const tempo = erro?.name === 'TimeoutError' || erro?.name === 'AbortError';
        if (tempo) gasto += maximo;
        log({ evento: tempo ? 'tempo_esgotado' : 'erro_de_rede', modelo: modelo.id, tentativa });
        if (tentativa + 1 < TENTATIVAS_POR_MODELO) await esperar(esperaDaTentativa(tentativa, sorteio));
        continue;
      }
      const status = resposta.status;
      if (resposta.ok) {
        const json = await resposta.json().catch(() => null);
        gasto += json?.usage ? custoReal(modelo, json.usage) : maximo;
        if (json?.stop_reason === 'refusal') {
          log({ evento: 'recusa', modelo: modelo.id });
          return { ok: false, motivo: 'recusa', gasto };
        }
        const texto = textoDaResposta(json);
        if (json?.stop_reason === 'max_tokens' || !texto) {
          log({ evento: json?.stop_reason === 'max_tokens' ? 'cortada' : 'sem_texto', modelo: modelo.id });
          break; // próximo modelo
        }
        log({ evento: 'respondeu', modelo: modelo.id, reserva: i > 0, tentativa });
        return { ok: true, texto, modelo: modelo.id, gasto };
      }
      try { await resposta.body?.cancel(); } catch { /* corpo já lido ou ausente */ }
      if (PROBLEMA_DE_CHAVE.has(status)) {
        log({ evento: 'chave_recusada', modelo: modelo.id, status });
        return { ok: false, motivo: 'chave', gasto };
      }
      if (!PASSAGEIRO.has(status)) {
        log({ evento: TROCAR_DE_MODELO.has(status) ? 'pedido_recusado' : 'erro_desconhecido', modelo: modelo.id, status });
        break; // próximo modelo
      }
      log({ evento: 'erro_passageiro', modelo: modelo.id, status, tentativa });
      if (tentativa + 1 >= TENTATIVAS_POR_MODELO) break;
      const pedida = lerRetryAfter(resposta.headers.get('retry-after'), relogio());
      if (pedida !== null && pedida > TEMPO.esperaMaxima) {
        log({ evento: 'retry_after_longo', modelo: modelo.id });
        break; // não dá para esperar tanto: próximo modelo
      }
      await esperar(pedida ?? esperaDaTentativa(tentativa, sorteio));
    }
  }
  return { ok: false, motivo: 'falha', gasto };
}
