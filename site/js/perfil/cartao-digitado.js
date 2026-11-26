// Partes puras do "Adicionar meu cartão" (testadas com node --test): ler o que
// foi digitado e resumir o cartão na lista do perfil. A tela fica em
// js/tela/meu-cartao-tela.js.

import { formatarCentavos } from '../motor/index.js';
import { ANUIDADE_MAXIMA, lerPontosDigitados, validarCartaoProprio } from './formato.js';
import { aplicarMascara } from '../tela/moeda.js';

const DIGITOS_ANUIDADE = String(ANUIDADE_MAXIMA).length;

/** Anuidade digitada, no jeito caixa eletrônico do campo de valor (centavos inteiros). */
export function mascaraAnuidade(texto) {
  return aplicarMascara(String(texto ?? '').replace(/\D/g, '').slice(0, DIGITOS_ANUIDADE));
}

/**
 * Lê o que foi digitado e devolve o cartão (sem id) ou os erros por campo.
 * Função pura, para testar sem navegador.
 *
 * @param {{ nome: string, programa_id: string, pontos_por_real: string, pontos_por_dolar: string, anuidade: string }} valores
 * @param {Map<string,string>} programas  id → nome
 * @param {string} id                     id que o cartão vai ter ("meu-1")
 */
export function lerCartaoDigitado(valores, programas, id) {
  const ppr = lerPontosDigitados(valores.pontos_por_real);
  const ppd = lerPontosDigitados(valores.pontos_por_dolar);
  const { centavos } = mascaraAnuidade(valores.anuidade);
  const bruto = { id, nome: valores.nome ?? '', programa_id: valores.programa_id ?? '' };
  if (ppr !== undefined) bruto.pontos_por_real = ppr ?? Number.NaN;
  if (ppd !== undefined) bruto.pontos_por_dolar = ppd ?? Number.NaN;
  if (centavos !== null) bruto.anuidade_brl = centavos;
  return validarCartaoProprio(bruto, programas);
}

/** "Livelo · 2,5 pontos por real · anuidade R$ 480,00" */
export function resumoDoCartaoProprio(cartao, nomePrograma) {
  const numero = (n) => String(n).replace('.', ',');
  const partes = [nomePrograma.get(cartao.programa_id) ?? 'pontos'];
  if (cartao.pontos_por_real !== undefined) partes.push(`${numero(cartao.pontos_por_real)} ${cartao.pontos_por_real === 1 ? 'ponto' : 'pontos'} por real`);
  if (cartao.pontos_por_dolar !== undefined) partes.push(`${numero(cartao.pontos_por_dolar)} ${cartao.pontos_por_dolar === 1 ? 'ponto' : 'pontos'} por dólar`);
  if (cartao.anuidade_brl !== undefined) partes.push(cartao.anuidade_brl === 0 ? 'sem anuidade' : `anuidade ${formatarCentavos(cartao.anuidade_brl)}`);
  return partes.join(' · ');
}
