// Peças puras do "explica pra mim" no navegador: o corpo do pedido e a
// leitura da resposta. O DOM fica em painel.js.

import { neutralizarPergunta, temDadoPessoal, TAMANHO_MAXIMO_DA_PERGUNTA } from './pergunta.js';

export const TEXTOS = Object.freeze({
  dadoPessoal: 'Tire da pergunta números de cartão, CPF, telefone ou e-mail. A gente não precisa deles para explicar.',
  grande: `A pergunta pode ter até ${TAMANHO_MAXIMO_DA_PERGUNTA} letras.`,
  semInternet: 'Sem internet agora. A explicação precisa de conexão; o resultado acima continua valendo.',
  falhou: 'Não consegui explicar agora. Tente de novo em alguns minutos.',
});

/** Problema na pergunta, para avisar antes de enviar. '' se estiver ok. */
export function problemaDaPergunta(texto) {
  if (typeof texto === 'string' && texto.length > TAMANHO_MAXIMO_DA_PERGUNTA) return TEXTOS.grande;
  if (temDadoPessoal(neutralizarPergunta(texto))) return TEXTOS.dadoPessoal;
  return '';
}

/**
 * Corpo do POST /api/explicar. Vai só o que o servidor precisa para refazer
 * a MESMA conta: a loja, o valor, o perfil (ids, clube e milheiro; nada
 * pessoal) e o melhor jeito que a pessoa está vendo, para conferir.
 */
export function corpoDoPedido({ lojaId, centavos, perfil, melhor, pergunta }) {
  return {
    loja_id: lojaId,
    valor_centavos: centavos,
    perfil: perfil ?? null,
    pergunta: neutralizarPergunta(pergunta ?? ''),
    conferir: { total_pontos_texto: melhor.total_pontos_texto, oferta_id: melhor.oferta_id },
  };
}

/**
 * Lê a resposta do servidor. Só aceita o formato esperado; o texto continua
 * sendo só texto (a tela usa textContent).
 * @returns {{ ok: true, blocos: object[], fixa: boolean } | { ok: false, mensagem: string }}
 */
export function lerResposta(status, json) {
  if (json && json.ok === true && Array.isArray(json.blocos)) {
    const blocos = json.blocos.filter((b) => (b?.tipo === 'paragrafo' && typeof b.texto === 'string')
      || (b?.tipo === 'lista' && Array.isArray(b.itens) && b.itens.every((i) => typeof i === 'string')));
    if (blocos.length) return { ok: true, blocos, fixa: json.fixa === true };
  }
  if (json && typeof json.mensagem === 'string' && json.mensagem && status >= 400) return { ok: false, mensagem: json.mensagem };
  return { ok: false, mensagem: TEXTOS.falhou };
}
