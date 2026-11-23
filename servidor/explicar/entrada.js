// Lê e confere o pedido do "explica pra mim". Tudo o que vem do navegador é
// tratado como dado hostil: só passam ids que existem nos nossos dados, um
// valor inteiro em centavos e uma pergunta curta, já "neutralizada".
//
// Corpo esperado (JSON):
// {
//   loja_id: "magalu",
//   valor_centavos: 129900,
//   perfil: null | { versao, programas, cartoes, valor_milheiro_brl, cotacao_dolar? },
//   pergunta: "" | "vale a pena assinar o clube só para essa compra?",
//   conferir: { total_pontos_texto: "12.990", oferta_id: "azul-magalu" | null }
// }
// `conferir` é o melhor jeito que a pessoa vê na tela. O servidor refaz a
// conta com os dados publicados; se não bater (dados mudaram), avisa em vez
// de explicar outra coisa.

import { neutralizarPergunta, temDadoPessoal } from '../../site/js/explicar/pergunta.js';
import { LIMITES } from './config.js';

export { neutralizarPergunta, temDadoPessoal };

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VALOR_MAXIMO_CENTAVOS = 99_999_999_999; // R$ 999.999.999,99, o mesmo da tela

function objetoSimples(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @returns {{ ok: true, pedido: object } | { ok: false, erro: string }}
 * `erro` é uma das chaves de MENSAGENS (pedido.js).
 */
export function lerPedido(json, dados) {
  if (!objetoSimples(json)) return { ok: false, erro: 'formato' };
  const { loja_id: lojaId, valor_centavos: valor, perfil, pergunta, conferir } = json;
  if (typeof lojaId !== 'string' || !ID.test(lojaId)) return { ok: false, erro: 'formato' };
  const loja = dados.lojas.find((l) => l.id === lojaId);
  if (!loja) return { ok: false, erro: 'formato' };
  if (!Number.isSafeInteger(valor) || valor <= 0 || valor > VALOR_MAXIMO_CENTAVOS) return { ok: false, erro: 'formato' };
  if (perfil !== null && perfil !== undefined && !objetoSimples(perfil)) return { ok: false, erro: 'formato' };
  if (pergunta !== undefined && typeof pergunta !== 'string') return { ok: false, erro: 'formato' };
  if (typeof pergunta === 'string' && pergunta.length > LIMITES.pergunta * 4) return { ok: false, erro: 'grande' };
  if (!objetoSimples(conferir) || typeof conferir.total_pontos_texto !== 'string'
    || !(conferir.oferta_id === null || (typeof conferir.oferta_id === 'string' && ID.test(conferir.oferta_id)))) {
    return { ok: false, erro: 'formato' };
  }
  const limpa = neutralizarPergunta(pergunta ?? '');
  if (temDadoPessoal(limpa)) return { ok: false, erro: 'dadoPessoal' };
  return {
    ok: true,
    pedido: {
      loja,
      valor_centavos: valor,
      perfil: perfil ?? null,
      pergunta: limpa,
      conferir: { total_pontos_texto: conferir.total_pontos_texto.slice(0, 40), oferta_id: conferir.oferta_id },
    },
  };
}
