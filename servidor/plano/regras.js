// Regras do plano pago. Funções puras.
//
// O plano NUNCA muda o ranking nem a conta dos pontos: ele só mexe no limite
// de alertas por e-mail (servidor/alertas/). Quem decide se a pessoa tem o
// plano é a situação gravada pelo webhook do Stripe (webhook.js).

import { LIMITES } from '../alertas/regras.js';

/** O que o plano dá. A mesma regra do limite de alertas está na migração (plano_ativo). */
export const BENEFICIOS = Object.freeze({
  alertasPorEmail: 50,
  alertasPorSemana: 7,
});

/** Limites de alertas para quem tem ou não o plano. */
export function limitesDeAlertas(temPlano) {
  return temPlano
    ? { alertasPorEmail: BENEFICIOS.alertasPorEmail, alertasPorSemana: BENEFICIOS.alertasPorSemana }
    : { alertasPorEmail: LIMITES.alertasPorEmail, alertasPorSemana: LIMITES.alertasPorSemana };
}

export const SITUACOES = Object.freeze(['pendente', 'ativa', 'falhou', 'cancelada', 'reembolsada']);

/**
 * Situação do Stripe → situação nossa.
 * https://docs.stripe.com/api/subscriptions/object#subscription_object-status
 */
export function situacaoDoStripe(status) {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'ativa';
    case 'incomplete':
      return 'pendente';
    case 'past_due':
    case 'unpaid':
    case 'incomplete_expired':
    case 'paused':
      return 'falhou';
    case 'canceled':
      return 'cancelada';
    default:
      return null;
  }
}

/**
 * Fim do período pago. Em versões novas da API do Stripe a data fica nos
 * itens da assinatura; nas antigas, na própria assinatura. Aceita as duas.
 * @returns {string|null} data ISO
 */
export function fimDoPeriodo(assinatura) {
  const segundos = [];
  if (Number.isInteger(assinatura?.current_period_end)) segundos.push(assinatura.current_period_end);
  for (const item of assinatura?.items?.data ?? []) {
    if (Number.isInteger(item?.current_period_end)) segundos.push(item.current_period_end);
  }
  return segundos.length ? new Date(Math.max(...segundos) * 1000).toISOString() : null;
}

/** A linha de plano_assinaturas dá o benefício agora? */
export function temBeneficio(linha, agora) {
  if (!linha || linha.situacao !== 'ativa' || linha.contestada) return false;
  const fim = linha.fim_do_periodo ? new Date(linha.fim_do_periodo) : null;
  return Boolean(fim && !Number.isNaN(fim.getTime()) && fim > agora);
}

/** Alguma das linhas (todas do mesmo e-mail) dá o benefício? */
export function algumaComBeneficio(linhas, agora) {
  return (Array.isArray(linhas) ? linhas : []).some((l) => temBeneficio(l, agora));
}

/** E-mail como gravamos: minúsculo, sem espaço nas pontas. null se não parece e-mail. */
export function normalizarEmail(email) {
  if (typeof email !== 'string') return null;
  const limpo = email.trim().toLowerCase();
  if (limpo.length < 6 || limpo.length > 254) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpo) ? limpo : null;
}

/**
 * Linha nova de plano_assinaturas a partir da assinatura do Stripe.
 * @param {object} assinatura  objeto subscription do Stripe
 * @param {string} email       e-mail do cliente no Stripe
 * @param {Date}   eventoEm    data do evento que mandou atualizar
 * @param {object|null} atual  linha que já existe (para manter reembolso e contestação)
 */
export function linhaDaAssinatura(assinatura, email, eventoEm, atual = null) {
  const situacao = situacaoDoStripe(assinatura?.status);
  const emailLimpo = normalizarEmail(email);
  const cliente = typeof assinatura?.customer === 'string' ? assinatura.customer : assinatura?.customer?.id;
  if (!situacao || !emailLimpo || typeof assinatura?.id !== 'string' || typeof cliente !== 'string') return null;
  // Reembolsada é final: só um reembolso nosso leva até ela, e depois a
  // assinatura também é cancelada no Stripe.
  const reembolsada = atual?.situacao === 'reembolsada';
  return {
    stripe_assinatura_id: assinatura.id,
    stripe_cliente_id: cliente,
    email: emailLimpo,
    situacao: reembolsada ? 'reembolsada' : situacao,
    cancela_no_fim: Boolean(assinatura.cancel_at_period_end),
    fim_do_periodo: fimDoPeriodo(assinatura),
    contestada: Boolean(atual?.contestada),
    reembolsada_em: reembolsada ? atual.reembolsada_em : null,
    evento_criado_em: eventoEm.toISOString(),
  };
}
