// Leitura do preço que a extensão achou na página da loja.
//
// O texto vem da página, então é tratado como NÃO confiável: só passa se tiver
// exatamente o formato de um preço em reais, e vira centavos inteiros por
// conta de texto (sem float). Qualquer outra coisa devolve null e a extensão
// não mostra nada.
//
// Função pura: roda no service worker da extensão e no Node (testes).

/** Maior texto aceito: um preço real tem bem menos que isso. */
export const TAMANHO_MAXIMO_TEXTO = 40;
/** Mesmo teto do campo de valor do site: R$ 999.999.999,99. */
export const PRECO_MAXIMO_CENTAVOS = 99_999_999_999;

// "R$ 1.234,56", "R$1234,56", "1.234", "R$ 99". Ponto só como milhar, em grupos de 3.
const TEXTO_BRL = /^(?:R\$)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?$/;
// Atributo de máquina (ex.: <meta itemprop="price" content="1234.56">): ponto decimal.
const DECIMAL = /^(\d+)(?:\.(\d{1,2}))?$/;

function centavosDe(inteiro, fracao) {
  const reais = inteiro.replace(/\./g, '').replace(/^0+(?=\d)/, '');
  if (reais.length > 9) return null;
  const centavos = Number(reais) * 100 + Number((fracao ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(centavos) || centavos <= 0 || centavos > PRECO_MAXIMO_CENTAVOS) return null;
  return centavos;
}

/**
 * @param {unknown} texto   o que foi lido da página
 * @param {'texto'|'decimal'} formato  'texto' = como aparece na tela (R$ 1.234,56);
 *                                     'decimal' = atributo de máquina (1234.56)
 * @returns {number|null}  centavos, ou null se não for um preço válido
 */
export function lerPreco(texto, formato = 'texto') {
  if (typeof texto !== 'string' || texto.length > TAMANHO_MAXIMO_TEXTO) return null;
  // Espaços comuns, sem quebra (U+00A0) e finos (U+202F) somem; nada mais é limpo.
  const limpo = texto.replace(/[\s\u00a0\u202f]+/g, '');
  const m = (formato === 'decimal' ? DECIMAL : TEXTO_BRL).exec(limpo);
  if (!m) return null;
  return centavosDe(m[1], m[2]);
}

/** Maior texto bruto aceito antes de recortar o preço (a página manda até 80). */
export const TAMANHO_MAXIMO_BRUTO = 80;

/**
 * Recorta o preço de um texto maior, com a expressão regular do arquivo de
 * seletores (ex.: "ou R$ 3.699,00 em 10x de R$ 369,90" → "3.699,00").
 * Vale o primeiro grupo de captura que achar algo. O recorte ainda passa por
 * lerPreco depois: a expressão só escolhe o pedaço, não valida.
 *
 * @param {unknown} texto
 * @param {string} padrao  expressão regular com ao menos um grupo de captura
 * @returns {string|null}
 */
export function recortarPreco(texto, padrao) {
  if (typeof texto !== 'string' || texto.length > TAMANHO_MAXIMO_BRUTO) return null;
  const m = new RegExp(padrao).exec(texto.replace(/[\s\u00a0\u202f]+/g, ' ').trim());
  return m?.slice(1).find((g) => g !== undefined) ?? null;
}
