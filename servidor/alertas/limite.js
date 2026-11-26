// Limites por pessoa, contados em listas de datas guardadas na própria
// inscrição (sem tabela à parte e sem dado pessoal novo). Funções puras.

import { LIMITES } from './regras.js';

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

function recentes(lista, agora, janelaMs) {
  const desde = agora.getTime() - janelaMs;
  return (Array.isArray(lista) ? lista : [])
    .map((t) => new Date(t))
    .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() > desde && d.getTime() <= agora.getTime());
}

function verificar(lista, agora, janelaMs, maximo) {
  const dentro = recentes(lista, agora, janelaMs);
  return {
    ok: dentro.length < maximo,
    /** Lista nova, já com o envio de agora, para gravar se o envio acontecer. */
    depois: [...dentro.map((d) => d.toISOString()), agora.toISOString()],
  };
}

/**
 * E-mails de alerta: no máximo `maximo` em 7 dias corridos (LIMITES.alertasPorSemana
 * no grátis; o plano pago passa o número dele, servidor/plano/regras.js).
 */
export function podeEnviarAlerta(enviosRecentes, agora, maximo = LIMITES.alertasPorSemana) {
  return verificar(enviosRecentes, agora, 7 * DIA, maximo);
}

/** E-mails de confirmação: no máximo LIMITES.confirmacoesPorDia em 24 horas. */
export function podeEnviarConfirmacao(pedidosRecentes, agora) {
  return verificar(pedidosRecentes, agora, DIA, LIMITES.confirmacoesPorDia);
}

/** Quando vence o link de confirmação criado agora. */
export function validadeDaConfirmacao(agora) {
  return new Date(agora.getTime() + LIMITES.horasParaConfirmar * HORA);
}
