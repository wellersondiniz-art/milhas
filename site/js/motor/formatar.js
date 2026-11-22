// Formatação para exibição (pt-BR). Só aqui se arredonda.
// Funções puras. Moeda, números e datas saem do Intl com locale "pt-BR"
// (R$ 1.234,56; 12/11/2026). O arredondamento continua com BigInt, e o Intl
// recebe o número já arredondado como texto decimal ("1234.56"), então nenhum
// valor passa por float. O Intl separa "R$" do número com espaço sem quebra
// (U+00A0); aqui ele vira espaço comum, para o texto ser o mesmo em todo lugar.
// Quem desenha a tela (el() e h()) põe o espaço sem quebra de volta.

/** Escala dos pontos: 1 ponto = 1.000.000 unidades internas. */
export const ESCALA_PONTOS = 1_000_000n;
/** Escala do valor: 1 centavo = 1.000.000.000 unidades internas (bilionésimos de centavo). */
export const ESCALA_VALOR = 1_000_000_000n;

const LOCALE = 'pt-BR';
const MOEDA = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'BRL' });
const NUMERO = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const NUMERO_LIVRE = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 20 });
const DATA = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });

const espacoComum = (texto) => texto.replace(/[\u00a0\u202f]/g, ' ');

/** BigInt em centésimos → "1234.56" (texto decimal exato, para o Intl). */
function centesimosParaDecimal(v) {
  const negativo = v < 0n;
  const a = negativo ? -v : v;
  return `${negativo ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
}

/** Centavos inteiros (number ou BigInt) → "R$ 1.234,56". */
export function formatarCentavos(centavos) {
  const texto = espacoComum(MOEDA.format(centesimosParaDecimal(BigInt(centavos))));
  // Sinal antes do R$ ("-R$ 1,00"), igual em qualquer motor de Intl.
  return texto.replace(/^R\$ -/, '-R$ ');
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
  return NUMERO.format(centesimosParaDecimal(centesimos));
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
  return NUMERO_LIVRE.format(String(n));
}

/** "1 ponto" / "2 pontos". */
export function pontosPorReal(n) {
  return `${formatarNumero(n)} ${n === 1 ? 'ponto' : 'pontos'} por real`;
}

/** "2026-11-12" → "12/11/2026". */
export function formatarData(iso) {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return DATA.format(Date.UTC(ano, mes - 1, dia));
}
