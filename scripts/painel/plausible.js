// Busca os números da semana na Stats API v2 do Plausible.
//
// A chave fica só na variável de ambiente PLAUSIBLE_API_KEY (nunca no Git).
// Cada evento do site precisa existir como "meta" (goal) de evento
// personalizado no Plausible, com o mesmo nome (veja a seção "Métricas" do README.md).

import { EVENTOS } from '../../site/js/metricas/metricas.js';

export const BASE_PADRAO = 'https://plausible.io';

// Para cada evento: por quais propriedades o painel quebra os números.
export const CONSULTAS = {
  busca_loja: ['loja', 'origem'],
  calculo: ['loja'],
  clique_saida: ['destino', 'pagina', 'loja'],
  instalacao: [],
  oferta_vencida_vista: ['pagina', 'loja'],
};

/** Corpo da consulta: total de eventos de um tipo, quebrado pelas propriedades. */
export function corpoDaConsulta({ site, inicio, fim, evento, propriedades }) {
  return {
    site_id: site,
    metrics: ['events'],
    date_range: [inicio, fim],
    filters: [['is', 'event:goal', [evento]]],
    dimensions: propriedades.map((p) => `event:props:${p}`),
  };
}

/** Linhas da resposta em { props, total }. "(none)" (propriedade ausente) vira null. */
export function lerResposta(resposta, propriedades) {
  return (resposta?.results ?? []).map((linha) => ({
    props: Object.fromEntries(propriedades.map((p, i) => {
      const v = linha.dimensions?.[i];
      return [p, v === undefined || v === '(none)' ? null : v];
    })),
    total: Number(linha.metrics?.[0] ?? 0),
  })).filter((l) => l.total > 0);
}

/** Uma consulta. Erros saem com mensagem clara e sem a chave. */
export async function consultar({ base = BASE_PADRAO, chave, site, inicio, fim, evento, propriedades, buscar = fetch }) {
  const resposta = await buscar(`${base}/api/v2/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpoDaConsulta({ site, inicio, fim, evento, propriedades })),
  });
  if (!resposta.ok) {
    let detalhe = '';
    try { detalhe = (await resposta.json())?.error ?? ''; } catch { /* sem corpo */ }
    const dica = resposta.status === 401 ? ' Confira a PLAUSIBLE_API_KEY.'
      : resposta.status === 400 ? ` Confira se a meta "${evento}" existe no Plausible.` : '';
    throw new Error(`Plausible respondeu ${resposta.status} para "${evento}".${dica}${detalhe ? ` (${detalhe})` : ''}`);
  }
  return lerResposta(await resposta.json(), propriedades);
}

/** Todos os eventos da semana: { busca_loja: [...], calculo: [...], ... }. */
export async function buscarSemana(opcoes) {
  const eventos = {};
  for (const [evento, propriedades] of Object.entries(CONSULTAS)) {
    if (!Object.hasOwn(EVENTOS, evento)) throw new Error(`evento desconhecido: ${evento}`);
    eventos[evento] = await consultar({ ...opcoes, evento, propriedades });
  }
  return eventos;
}
