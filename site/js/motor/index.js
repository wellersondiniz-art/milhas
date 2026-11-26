// Ponto de entrada do motor de cálculo (funções puras, roda no navegador e no Node).
export { calcularJeitosDeComprar, A_CONFIRMAR, DIAS_AVISO_VENCIMENTO, DIAS_DADO_ANTIGO, ESCALA_COTACAO, ID_COTACAO_DOLAR, naLoja } from './calcular.js';
export {
  ESCALA_PONTOS, ESCALA_VALOR, arredondarParaCentavos, formatarCentavos, formatarCotacao, formatarData, formatarPontos, formatarValor,
} from './formatar.js';
export { calcularAnuidade, compararComDinheiro, formatarPorcento, PORCENTO_MAXIMO } from './decisao.js';
