// Lista do que precisa ser reconferido na semana. Função pura: recebe os dados
// e a data de hoje (horário de Brasília) e devolve a lista em ordem de importância.
//
// Entra na lista todo registro que, até o último dia da semana (hoje + 6),
// já terá sido conferido há mais de 14 dias (DIAS_DADO_ANTIGO). Ofertas que já
// acabaram não entram: elas ficam no histórico e não voltam para a conta.
//
// Ordem:
//   1. Lojas, pela `prioridade` de dados/lojas.json (1 = a mais buscada; sem
//      prioridade vai para o fim, por nome). Em cada loja: as ofertas e o
//      cadastro da própria loja.
//   2. "Vale para todas as lojas": programas, cartões e câmbio.
//   Dentro de cada grupo: o mais urgente primeiro, depois o mais antigo.
//
// A prioridade é PROVISÓRIA: o site não mede buscas (sem métricas e sem
// cookies, de propósito), então a ordem das lojas é escolhida à mão.

import {
  A_CONFIRMAR, DIAS_DADO_ANTIGO, DIAS_RECONFERIR, situacaoDaOferta,
} from '../../site/js/motor/ciclo.js';
import { diasEntre, somarDias } from '../../site/js/motor/datas.js';

export const DIAS_DA_SEMANA = 7;

/** Do mais urgente ao menos urgente. */
export const URGENCIAS = Object.freeze({
  FORA_DO_RANKING: 'fora_do_ranking', // oferta conferida há mais de 30 dias: já saiu da conta
  SAI_DO_RANKING: 'sai_do_ranking', // oferta que passa de 30 dias nesta semana
  ANTIGO: 'antigo', // já passou de 14 dias (aviso na tela)
  FICA_ANTIGO: 'fica_antigo', // passa de 14 dias nesta semana
});
const ORDEM_URGENCIA = Object.values(URGENCIAS);
const ORDEM_TIPO = ['oferta', 'loja', 'cambio', 'programa', 'cartao'];

function urgencia(tipo, dias, diasNoFimDaSemana) {
  if (tipo === 'oferta' && dias > DIAS_RECONFERIR) return { chave: URGENCIAS.FORA_DO_RANKING, prazo: null };
  if (tipo === 'oferta' && diasNoFimDaSemana > DIAS_RECONFERIR) return { chave: URGENCIAS.SAI_DO_RANKING, prazo: DIAS_RECONFERIR };
  if (dias > DIAS_DADO_ANTIGO) return { chave: URGENCIAS.ANTIGO, prazo: null };
  return { chave: URGENCIAS.FICA_ANTIGO, prazo: DIAS_DADO_ANTIGO };
}

function item(tipo, registro, nome, hoje) {
  const dias = diasEntre(registro.verificado_em, hoje);
  const noFim = dias + DIAS_DA_SEMANA - 1;
  if (noFim <= DIAS_DADO_ANTIGO) return null;
  const u = urgencia(tipo, dias, noFim);
  return {
    tipo,
    id: registro.id,
    nome,
    verificado_em: registro.verificado_em,
    dias,
    urgencia: u.chave,
    // Último dia em que a conferência ainda evita o aviso (14) ou a saída do ranking (30).
    conferir_ate: u.prazo === null ? null : somarDias(registro.verificado_em, u.prazo),
    fonte_url: registro.fonte_url,
  };
}

function comparar(a, b) {
  return ORDEM_URGENCIA.indexOf(a.urgencia) - ORDEM_URGENCIA.indexOf(b.urgencia)
    || b.dias - a.dias
    || ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo)
    || a.nome.localeCompare(b.nome, 'pt-BR');
}

function compararLojas(a, b) {
  const pa = Number.isInteger(a.prioridade) ? a.prioridade : Infinity;
  const pb = Number.isInteger(b.prioridade) ? b.prioridade : Infinity;
  return pa - pb || a.nome.localeCompare(b.nome, 'pt-BR');
}

/**
 * @param {object} dados { programas, cartoes, lojas, ofertas, cambio? }
 * @param {string} hoje  "AAAA-MM-DD"
 * @returns {{ semana: {de: string, ate: string}, lojas: {loja: object, itens: object[]}[], geral: object[], total: number }}
 */
export function listarReconferencia(dados, hoje) {
  const nomePrograma = (id) => dados.programas.find((p) => p.id === id)?.nome ?? id;
  const porLoja = new Map(dados.lojas.map((l) => [l.id, []]));
  const geral = [];

  for (const loja of dados.lojas) {
    const i = item('loja', loja, `Cadastro da loja ${loja.nome}`, hoje);
    if (i) porLoja.get(loja.id).push(i);
  }
  for (const oferta of dados.ofertas) {
    if (situacaoDaOferta(oferta, hoje).no_historico) continue;
    const i = item('oferta', oferta, `Oferta ${nomePrograma(oferta.programa_id)}${oferta.status === A_CONFIRMAR ? ' (em conferência)' : ''}`, hoje);
    if (!i) continue;
    if (!porLoja.has(oferta.loja_id)) porLoja.set(oferta.loja_id, []);
    porLoja.get(oferta.loja_id).push(i);
  }
  for (const p of dados.programas) {
    const i = item('programa', p, `Programa ${p.nome}`, hoje);
    if (i) geral.push(i);
  }
  for (const c of dados.cartoes) {
    const i = item('cartao', c, `Cartão ${c.nome}`, hoje);
    if (i) geral.push(i);
  }
  for (const c of dados.cambio ?? []) {
    const i = item('cambio', c, `Cotação ${c.moeda ?? c.id}`, hoje);
    if (i) geral.push(i);
  }

  const lojasConhecidas = new Map(dados.lojas.map((l) => [l.id, l]));
  const lojas = [...porLoja]
    .filter(([, itens]) => itens.length)
    .map(([id, itens]) => ({
      loja: lojasConhecidas.get(id) ?? { id, nome: id },
      itens: itens.sort(comparar),
    }))
    .sort((a, b) => compararLojas(a.loja, b.loja));
  geral.sort(comparar);

  return {
    semana: { de: hoje, ate: somarDias(hoje, DIAS_DA_SEMANA - 1) },
    lojas,
    geral,
    total: lojas.reduce((n, l) => n + l.itens.length, 0) + geral.length,
  };
}
