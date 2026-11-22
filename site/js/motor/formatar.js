// Formatação para exibição (pt-BR). Só aqui se arredonda.
// Funções puras, sem Intl, para dar o mesmo texto em qualquer navegador.

/** Escala dos pontos: 1 ponto = 1.000.000 unidades internas. */
export const ESCALA_PONTOS = 1_000_000n;
/** Escala do valor: 1 centavo = 1.000.000.000 unidades internas (bilionésimos de centavo). */
export const ESCALA_VALOR = 1_000_000_000n;

function separarMilhar(digitos) {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Centavos inteiros (number ou BigInt) → "R$ 1.234,56". */
export function formatarCentavos(centavos) {
  let v = BigInt(centavos);
  const negativo = v < 0n;
  if (negativo) v = -v;
  const reais = separarMilhar((v / 100n).toString());
  const cent = (v % 100n).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}R$ ${reais},${cent}`;
}

/** Bilionésimos de centavo (BigInt, >= 0) → centavos arredondados (meio para cima). */
export function arredondarParaCentavos(bilionesimos) {
  return (bilionesimos + ESCALA_VALOR / 2n) / ESCALA_VALOR;
}

/** Bilionésimos de centavo (BigInt) → "R$ 1.234,56". */
export function formatarValor(bilionesimos) {
  return formatarCentavos(arredondarParaCentavos(bilionesimos));
}

/** Pontos na escala interna (BigInt) → "1.234" ou "1.234,57" (até 2 casas). */
export function formatarPontos(escalado) {
  const centesimos = (escalado + ESCALA_PONTOS / 200n) / (ESCALA_PONTOS / 100n);
  const inteiro = separarMilhar((centesimos / 100n).toString());
  const fracao = (centesimos % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return fracao ? `${inteiro},${fracao}` : inteiro;
}

/** Pontos na escala interna (BigInt) → number (para a interface; pode perder precisão em valores gigantes). */
export function pontosParaNumero(escalado) {
  return Number(escalado / ESCALA_PONTOS) + Number(escalado % ESCALA_PONTOS) / Number(ESCALA_PONTOS);
}

/** Cotação do dólar × 10.000 (53456) → "R$ 5,3456". */
export function formatarCotacao(x10000) {
  // Sem separador de milhar: a cotação nunca passa de R$ 99,9999.
  const v = BigInt(x10000);
  return `R$ ${v / 10_000n},${(v % 10_000n).toString().padStart(4, '0')}`;
}

/** Número pequeno (ex.: pontos por real) → "1,5". */
export function formatarNumero(n) {
  return String(n).replace('.', ',');
}

/** "1 ponto" / "2 pontos". */
export function pontosPorReal(n) {
  return `${formatarNumero(n)} ${n === 1 ? 'ponto' : 'pontos'} por real`;
}

/** "2026-11-12" → "12/11/2026". */
export function formatarData(iso) {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}
