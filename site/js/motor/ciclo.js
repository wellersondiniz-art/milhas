// Ciclo de vida das ofertas e idade dos dados. Funções puras: a data de hoje
// sempre entra como parâmetro ("AAAA-MM-DD" ou "AAAA-MM-DDTHH:MM", no horário
// de São Paulo; veja dataHoraEmSaoPaulo).
//
// Estados de uma oferta, do jeito que a tela e as páginas mostram:
//   ativa           vale hoje e entra no ranking
//   vence_logo      vale hoje, entra no ranking e ganha o selo "vence em N dias"
//                   (faltam DIAS_ALERTA_VENCIMENTO dias ou menos; 0 = último dia)
//   vencida         o último dia (fim) já passou: sai do ranking e vai para o histórico
//   reconferir      conferida há mais de DIAS_RECONFERIR dias: sai do ranking até
//                   alguém conferir de novo (atualizar verificado_em)
//   futura          ainda não começou
//   em_conferencia  status A_CONFIRMAR: não entra na conta
// Além do estado, `dado_antigo` diz se a oferta foi conferida há mais de
// DIAS_DADO_ANTIGO dias (aviso na tela).

import { diasEntre, soData } from './datas.js';

export const A_CONFIRMAR = 'A_CONFIRMAR';
/** Faltando esses dias ou menos para o fim, a oferta ganha o selo de alerta. */
export const DIAS_ALERTA_VENCIMENTO = 3;
/** Conferido há mais que isso: aviso de dado antigo. */
export const DIAS_DADO_ANTIGO = 14;
/** Oferta conferida há mais que isso sai do ranking até ser conferida de novo. */
export const DIAS_RECONFERIR = 30;

export const ESTADOS = Object.freeze({
  ATIVA: 'ativa',
  VENCE_LOGO: 'vence_logo',
  VENCIDA: 'vencida',
  RECONFERIR: 'reconferir',
  FUTURA: 'futura',
  EM_CONFERENCIA: 'em_conferencia',
});

const NO_RANKING = new Set([ESTADOS.ATIVA, ESTADOS.VENCE_LOGO]);

/**
 * Idade de um dado: dias desde `verificado_em` até hoje.
 * nivel: "em_dia" (até 14 dias), "antigo" (15 a 30) ou "reconferir" (mais de 30).
 */
export function idadeDoDado(verificadoEm, hoje) {
  const dias = diasEntre(verificadoEm, soData(hoje));
  let nivel = 'em_dia';
  if (dias > DIAS_RECONFERIR) nivel = 'reconferir';
  else if (dias > DIAS_DADO_ANTIGO) nivel = 'antigo';
  return { dias, nivel };
}

/** "hoje", "amanhã" ou "em N dias". */
export function quandoVence(dias) {
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  return `em ${dias} dias`;
}

/**
 * Situação de uma oferta hoje.
 * @returns {{ estado: string, no_ranking: boolean, no_historico: boolean,
 *   dias_para_vencer: number|null, dias_desde_conferencia: number, dado_antigo: boolean }}
 */
export function situacaoDaOferta(oferta, hoje) {
  const data = soData(hoje);
  const temFim = oferta.fim !== A_CONFIRMAR;
  const diasParaVencer = temFim ? diasEntre(data, oferta.fim) : null;
  const idade = idadeDoDado(oferta.verificado_em, data);

  let estado;
  if (oferta.status === A_CONFIRMAR) estado = ESTADOS.EM_CONFERENCIA;
  else if (temFim && diasParaVencer < 0) estado = ESTADOS.VENCIDA;
  else if (oferta.inicio !== A_CONFIRMAR && oferta.inicio > data) estado = ESTADOS.FUTURA;
  else if (idade.nivel === 'reconferir') estado = ESTADOS.RECONFERIR;
  else if (temFim && diasParaVencer <= DIAS_ALERTA_VENCIMENTO) estado = ESTADOS.VENCE_LOGO;
  else estado = ESTADOS.ATIVA;

  return {
    estado,
    no_ranking: NO_RANKING.has(estado),
    no_historico: estado === ESTADOS.VENCIDA,
    dias_para_vencer: diasParaVencer,
    dias_desde_conferencia: idade.dias,
    dado_antigo: idade.nivel !== 'em_dia',
  };
}
