// Avalia os alertas com o MESMO motor da calculadora (site/js/motor/).
// Nada de conta própria aqui: o motor diz os pontos de cada jeito de comprar,
// e este arquivo só compara o total com o mínimo do alerta. Funções puras.

import { calcularJeitosDeComprar, ESCALA_PONTOS } from '../../site/js/motor/index.js';
import { VALOR_DE_REFERENCIA_CENTAVOS, formatarMinimo } from './regras.js';

const VALOR = BigInt(VALOR_DE_REFERENCIA_CENTAVOS);

/**
 * Pontos por real exatos de um jeito de comprar, cortados para centésimos.
 * pontos por real = (total escalado ÷ ESCALA_PONTOS) ÷ (valor ÷ 100)
 * centésimos      = total escalado × 10.000 ÷ (ESCALA_PONTOS × valor)
 */
export function centesimosPorReal(totalEscalado) {
  return Number((totalEscalado * 10_000n) / (ESCALA_PONTOS * VALOR));
}

/** O total bate o mínimo? Conta inteira, sem float. */
export function bateMinimo(totalEscalado, minimoCentesimos) {
  return totalEscalado * 10_000n >= BigInt(minimoCentesimos) * ESCALA_PONTOS * VALOR;
}

/**
 * @param {object} alerta  { loja_id, programa_id|null, minimo_centesimos }
 * @param {object} perfil  retrato do perfil { programas, cartoes }
 * @param {object} dados   { programas, cartoes, lojas, ofertas, cambio? }
 * @param {string} hoje    "AAAA-MM-DDTHH:MM" em São Paulo
 * @returns {{ dispara: boolean, melhor: object|null, chave: string|null }}
 *   melhor: o jeito com oferta que mais rende (já filtrado pelo programa do alerta);
 *   chave: identifica o que foi avisado (oferta + pontos), para não avisar de novo a mesma coisa.
 */
export function avaliarAlerta(alerta, perfil, dados, hoje) {
  if (!dados.lojas.some((l) => l.id === alerta.loja_id)) return { dispara: false, melhor: null, chave: null };
  const compra = { loja_id: alerta.loja_id, valor_centavos: VALOR_DE_REFERENCIA_CENTAVOS, tipo_vendedor: 'loja' };
  const perfilDoMotor = { programas: perfil.programas, cartoes: perfil.cartoes, valor_milheiro_brl: {} };
  const jeitos = calcularJeitosDeComprar(perfilDoMotor, compra, dados, hoje)
    // O alerta é sobre a oferta da loja: só os jeitos com oferta contam.
    .filter((j) => j.tipo === 'oferta')
    .filter((j) => !alerta.programa_id || j.programa?.id === alerta.programa_id);
  const melhor = jeitos[0] ?? null; // o motor já devolve do melhor para o pior
  if (!melhor) return { dispara: false, melhor: null, chave: null };
  const centesimos = centesimosPorReal(melhor.total_pontos_escalado);
  const dispara = bateMinimo(melhor.total_pontos_escalado, alerta.minimo_centesimos);
  return {
    dispara,
    melhor: {
      oferta_id: melhor.oferta_id,
      programa: melhor.programa,
      cartao: melhor.cartao,
      centesimos_por_real: centesimos,
      pontos_por_real_texto: formatarMinimo(centesimos),
      condicoes: melhor.condicoes_a_cumprir,
      validade: melhor.validade_da_oferta?.texto ?? null,
      avisos: melhor.avisos,
    },
    chave: dispara ? `${melhor.oferta_id}|${centesimos}` : null,
  };
}
