// Configuração do "explica pra mim" (POST /api/explicar).
//
// Escolha do modelo (preços da API da Anthropic, US$ por milhão de tokens,
// conferidos em 23/11/2026):
//
//   claude-haiku-5-5   entrada 0,10   saída 0,50   ← principal
//   claude-haiku-4-5   entrada 1,00   saída 5,00   ← reserva
//
// Por que o Haiku 5.5: a tarefa é reescrever em português simples um
// resultado que o motor JÁ calculou e responder dúvidas curtas sobre ele.
// Não há conta, busca nem raciocínio longo: é o tipo de trabalho para o qual
// o modelo mais barato basta (o fluxo semanal já usa o mesmo modelo). Uma
// explicação custa por volta de US$ 0,0005 (≈ 3.000 tokens de entrada e até
// 1.200 de saída, contando o raciocínio interno).
// Por que o Haiku 4.5 de reserva: é o próximo mais barato e roda em outra
// capacidade da API; só entra quando o principal falha (fora do ar, lento,
// sobrecarregado ou retirado). Custa 10× mais, por isso o teto conta o
// preço do modelo que de fato respondeu.
//
// Dinheiro do teto em NANODÓLARES inteiros (1 dólar = 1.000.000.000), para
// não usar número quebrado em conta de dinheiro.

export const NANO_POR_DOLAR = 1_000_000_000;

/** Ordem de tentativa. `extras` entra no corpo do pedido só para aquele modelo. */
export const MODELOS = Object.freeze([
  Object.freeze({
    id: 'claude-haiku-5-5',
    // US$ 0,10 / milhão = 100 nanodólares por token; US$ 0,50 / milhão = 500.
    nanoPorTokenEntrada: 100,
    nanoPorTokenSaida: 500,
    maxTokens: 1500,
    // O Haiku 5.5 pensa por padrão (esforço "medium"); "low" basta e sai mais barato.
    extras: Object.freeze({ output_config: Object.freeze({ effort: 'low' }) }),
  }),
  Object.freeze({
    id: 'claude-haiku-4-5',
    nanoPorTokenEntrada: 1000,
    nanoPorTokenSaida: 5000,
    maxTokens: 800,
    // O Haiku 4.5 recusa o parâmetro effort: vai sem ele.
    extras: Object.freeze({}),
  }),
]);

export const ENDERECO_API = 'https://api.anthropic.com/v1/messages';
export const VERSAO_API = '2023-06-01';

/** Tempo máximo de cada tentativa e do pedido inteiro, em milissegundos. */
export const TEMPO = Object.freeze({
  porTentativa: 12_000,
  total: 25_000,
  /** Espera antes de tentar de novo: base × 2^n, com sorteio (jitter), até o máximo. */
  esperaBase: 400,
  esperaMaxima: 3_000,
});

/** Tentativas no mesmo modelo antes de passar para o próximo (1 = sem repetir). */
export const TENTATIVAS_POR_MODELO = 2;

/** Teto padrão de gasto por mês (troque com a variável EXPLICAR_TETO_MENSAL_USD). */
export const TETO_MENSAL_PADRAO_USD = 5;

export const LIMITES = Object.freeze({
  /** Explicações por pessoa (resumo do IP) por dia, no horário de São Paulo. */
  porPessoaPorDia: 10,
  /** Explicações por dia no total (troque com EXPLICAR_POR_DIA_TOTAL). */
  porDiaTotal: 200,
  /** Tamanho máximo do corpo do pedido, em bytes. */
  corpoBytes: 8 * 1024,
  /** Tamanho máximo da pergunta, em caracteres (o mesmo de site/js/explicar/pergunta.js). */
  pergunta: 300,
  /** Tamanho máximo da resposta mostrada, em caracteres. */
  resposta: 1500,
  /** Quantos jeitos de comprar vão para o modelo (os melhores). */
  jeitos: 5,
});

/** Custo máximo de uma tentativa, em nanodólares (entrada estimada + saída máxima). */
export function custoMaximo(modelo, tokensDeEntrada) {
  return tokensDeEntrada * modelo.nanoPorTokenEntrada + modelo.maxTokens * modelo.nanoPorTokenSaida;
}

/** Custo real, a partir do `usage` devolvido pela API, em nanodólares. */
export function custoReal(modelo, usage) {
  const n = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);
  const entrada = n(usage?.input_tokens) + n(usage?.cache_creation_input_tokens) + n(usage?.cache_read_input_tokens);
  return entrada * modelo.nanoPorTokenEntrada + n(usage?.output_tokens) * modelo.nanoPorTokenSaida;
}

/** Lê o teto em dólares (texto da variável de ambiente) e devolve nanodólares. */
export function tetoEmNano(texto) {
  const m = /^\s*(\d{1,6})(?:[.,](\d{1,2}))?\s*$/.exec(texto ?? '');
  if (!m) return TETO_MENSAL_PADRAO_USD * NANO_POR_DOLAR;
  const centavos = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return centavos * (NANO_POR_DOLAR / 100);
}

/** Lê um inteiro positivo de variável de ambiente, com padrão. */
export function inteiroDoAmbiente(texto, padrao) {
  const n = Number.parseInt(texto ?? '', 10);
  return Number.isSafeInteger(n) && n > 0 && String(n) === String(texto).trim() ? n : padrao;
}
