// Validade dos pontos. Funções puras: recebem o perfil, os programas e a data
// de hoje ("AAAA-MM-DD", no fuso de São Paulo) e devolvem os avisos prontos.
//
// O site não sabe o saldo de ninguém: a data de vencimento é a que a pessoa
// copiou do extrato do programa, guardada só no aparelho dela.

import { diasEntre } from './datas.js';

/** A partir de quantos dias antes o aviso aparece. */
export const DIAS_URGENTE = 30;
export const DIAS_ATENCAO = 90;

/**
 * Nível do aviso para uma data de vencimento.
 * vencido (antes de hoje), urgente (até 30 dias), atencao (até 90 dias) ou tranquilo.
 */
export function nivelDoVencimento(dias) {
  if (dias < 0) return 'vencido';
  if (dias <= DIAS_URGENTE) return 'urgente';
  if (dias <= DIAS_ATENCAO) return 'atencao';
  return 'tranquilo';
}

/** "vence hoje", "vence amanhã", "vence em 12 dias", "venceu há 3 dias". */
export function textoDoPrazo(dias) {
  if (dias === 0) return 'vence hoje';
  if (dias === 1) return 'vence amanhã';
  if (dias > 1) return `vence em ${dias} dias`;
  if (dias === -1) return 'venceu ontem';
  return `venceu há ${-dias} dias`;
}

/**
 * Avisos de vencimento do perfil, do mais perto ao mais longe.
 * Só entram programas marcados que têm data de vencimento.
 *
 * @param {object|null} perfil    { programas: [{ programa_id, pontos_vencem_em? }] }
 * @param {object[]} programas    programas.json
 * @param {string} hoje           "AAAA-MM-DD"
 * @returns {Array<{ programa_id, nome, data, dias, nivel, texto }>}
 */
export function avisosDeVencimento(perfil, programas, hoje) {
  const nomes = new Map((programas ?? []).map((p) => [p.id, p.nome]));
  const avisos = [];
  for (const p of perfil?.programas ?? []) {
    if (typeof p.pontos_vencem_em !== 'string' || !nomes.has(p.programa_id)) continue;
    const dias = diasEntre(hoje, p.pontos_vencem_em);
    avisos.push({
      programa_id: p.programa_id,
      nome: nomes.get(p.programa_id),
      data: p.pontos_vencem_em,
      dias,
      nivel: nivelDoVencimento(dias),
      texto: textoDoPrazo(dias),
    });
  }
  return avisos.sort((a, b) => a.dias - b.dias || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Só os que pedem atenção agora: vencidos, urgentes e de atenção. */
export function avisosQuePedemAtencao(avisos) {
  return avisos.filter((a) => a.nivel !== 'tranquilo');
}

/**
 * Frase da regra geral do programa, para mostrar ao lado do campo.
 * Devolve null se o programa não tem validade cadastrada.
 */
export function prazoDoPrograma(programa) {
  const v = programa?.validade_pontos;
  if (!v) return null;
  let curto;
  if (v.meses === 'nao_expira') curto = 'Os pontos não expiram';
  else if (v.meses === 'depende_do_cartao') curto = 'O prazo depende do cartão';
  else if (Number.isSafeInteger(v.meses)) curto = `Prazo padrão: ${v.meses} meses`;
  else curto = 'Prazo padrão a confirmar';
  return { curto, resumo: v.resumo, comoProrrogar: v.como_prorrogar ?? null, fonte: v.fonte_url, verificadoEm: v.verificado_em };
}
