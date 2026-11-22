// Máscara do campo de valor em R$. Função pura: recebe o texto digitado e
// devolve os centavos (inteiro) e o texto formatado.
// Funciona como caixa eletrônico: cada dígito entra pela direita
// ("1" → 0,01; "12" → 0,12; "129900" → 1.299,00).

import { formatarCentavos, formatarCotacao } from '../motor/index.js';
import { COTACAO_MAXIMA } from '../perfil/formato.js';

/** Até 11 dígitos: R$ 999.999.999,99. Bem abaixo do limite do motor. */
export const MAX_DIGITOS = 11;
export const VALOR_MAXIMO_CENTAVOS = 10 ** MAX_DIGITOS - 1;

/**
 * @param {string} texto  o que está no campo (pode ter "R$", pontos, vírgula, letras)
 * @returns {{ centavos: number|null, texto: string, cortado: boolean }}
 *   centavos null quando o campo está vazio; cortado = passou do limite e
 *   os dígitos a mais foram ignorados.
 */
export function aplicarMascara(texto) {
  let digitos = String(texto ?? '').replace(/\D/g, '').replace(/^0+/, '');
  const cortado = digitos.length > MAX_DIGITOS;
  if (cortado) digitos = digitos.slice(0, MAX_DIGITOS);
  if (!digitos) {
    // Só zeros digitados ("0", "000") contam como zero; campo vazio é vazio.
    const soZeros = /\d/.test(String(texto ?? ''));
    return { centavos: soZeros ? 0 : null, texto: soZeros ? '0,00' : '', cortado: false };
  }
  const centavos = Number(digitos);
  return { centavos, texto: formatarCentavos(centavos).replace(/^R\$\s/, ''), cortado };
}

/** Mensagem de erro do valor, ou '' se está tudo certo. */
export function erroDoValor(centavos) {
  if (centavos === null) return 'Digite quanto vai custar a compra.';
  if (centavos === 0) return 'O valor precisa ser maior que zero.';
  return '';
}

const DIGITOS_COTACAO = String(COTACAO_MAXIMA).length;

/**
 * Máscara da cotação do dólar, no mesmo jeito caixa eletrônico, com 4 casas:
 * "5" → 0,0005; "53456" → 5,3456. Devolve { valor (reais × 10.000) | null, texto }.
 * Vazio ou só zeros dá null: sem cotação.
 */
export function mascaraCotacao(texto) {
  const digitos = String(texto ?? '').replace(/\D/g, '').replace(/^0+/, '').slice(0, DIGITOS_COTACAO);
  if (!digitos) return { valor: null, texto: '' };
  const valor = Number(digitos);
  return { valor, texto: formatarCotacao(valor).replace(/^R\$\s/, '') };
}
