// Regras da pergunta do "explica pra mim", usadas no navegador (para avisar
// quem digita) e de novo no servidor (que é quem vale). Funções puras.

/** Tamanho máximo da pergunta, em caracteres. */
export const TAMANHO_MAXIMO_DA_PERGUNTA = 300;

/** Sugestões mostradas embaixo do campo. */
export const SUGESTOES = Object.freeze([
  'Por que esse é o melhor jeito?',
  'Vale a pena assinar o clube só para essa compra?',
  'O que eu preciso fazer antes de comprar?',
]);

/**
 * Deixa a pergunta inofensiva como TEXTO. Não impede o pedido malicioso (isso
 * é com o prompt e com a conferência da resposta), mas tira o que serve para
 * enganar: caracteres de controle e invisíveis (que escondem texto ou viram a
 * direção da escrita), < e > (para a pergunta não fechar a etiqueta que a
 * cerca no prompt; "＜" largo também, pelo NFKC), espaços repetidos. Corta no
 * tamanho máximo.
 */
export function neutralizarPergunta(bruta) {
  if (typeof bruta !== 'string') return '';
  return bruta
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g, '')
    .replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TAMANHO_MAXIMO_DA_PERGUNTA)
    .trim();
}

/**
 * A pergunta tem dado pessoal que nunca pode sair do aparelho (CLAUDE.md,
 * seção 5)? Número de cartão, CPF, telefone (11 dígitos ou mais seguidos,
 * contando com pontos, traços, barras e espaços no meio) ou e-mail.
 */
export function temDadoPessoal(texto) {
  if (typeof texto !== 'string') return false;
  if (/\d{11,}/.test(texto.replace(/[\s.\-/()]/g, ''))) return true;
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(texto);
}
