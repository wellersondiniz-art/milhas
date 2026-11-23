// Ponto de entrada do motor de cálculo (funções puras, roda no navegador e no Node).
export { calcularJeitosDeComprar, A_CONFIRMAR, DIAS_AVISO_VENCIMENTO, DIAS_DADO_ANTIGO, ESCALA_COTACAO, ID_COTACAO_DOLAR } from './calcular.js';
export {
  ESCALA_PONTOS, ESCALA_VALOR, arredondarParaCentavos, formatarCentavos, formatarCotacao, formatarData, formatarPontos, formatarValor,
} from './formatar.js';
export {
  COMBUSTIVEIS, LITROS_MAXIMOS_ML, PRECO_MAXIMO_MILESIMOS, calcularAbastecimento, formatarLitros, formatarPrecoLitro,
} from './combustivel.js';
