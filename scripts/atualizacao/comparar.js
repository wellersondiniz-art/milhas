// Etapa 3 do fluxo semanal: compara as ofertas extraídas com o ofertas.json
// atual e monta a lista final proposta. Funções puras.

import { createHash } from 'node:crypto';

// "Suspeita": pontos por real mais de 3 vezes o normal.
export const FATOR_SUSPEITO = 3;

const CAMPOS_IGNORADOS = new Set(['id', 'verificado_em', 'observacoes']);

/** Chave de uma oferta: o par programa × loja. */
export const chave = (o) => `${o.programa_id}|${o.loja_id}`;

/** Maior pontos_por_real entre as faixas de uma oferta. */
export const maiorPontos = (o) => Math.max(...o.regras.map((r) => r.pontos_por_real));

function mediana(numeros) {
  if (numeros.length === 0) return null;
  const v = [...numeros].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

/**
 * "Normal" de um programa: mediana do maior pontos_por_real das ofertas atuais
 * desse programa; sem histórico do programa, a mediana de todas as ofertas atuais.
 */
export function pontosNormais(atuais, programaId, ignorarId) {
  const outras = atuais.filter((o) => o.id !== ignorarId);
  const doPrograma = mediana(outras.filter((o) => o.programa_id === programaId).map(maiorPontos));
  if (doPrograma !== null) return { valor: doPrograma, base: 'do programa' };
  const geral = mediana(outras.map(maiorPontos));
  return geral === null ? null : { valor: geral, base: 'de todas as ofertas, porque o programa não tem histórico' };
}

const dataBr = (iso) => iso.split('-').reverse().join('/');

/** Lista de campos diferentes entre duas ofertas: [{ campo, antes, depois }]. */
export function diferencas(antes, depois) {
  const campos = [...new Set([...Object.keys(antes), ...Object.keys(depois)])].filter((c) => !CAMPOS_IGNORADOS.has(c));
  return campos
    .filter((c) => JSON.stringify(antes[c]) !== JSON.stringify(depois[c]))
    .map((campo) => ({ campo, antes: antes[campo], depois: depois[campo] }));
}

/**
 * Compara. `cobertos` = chaves programa|loja cujas páginas foram lidas com
 * sucesso nesta semana (só nelas uma oferta pode ser dada como encerrada por sumir).
 * Devolve { novas, alteradas, iguais, encerradas, ignoradas, naoVerificadas, suspeitas, final }.
 */
export function compararOfertas({ atuais, propostas, cobertos, hoje }) {
  const r = { novas: [], alteradas: [], iguais: [], encerradas: [], ignoradas: [], naoVerificadas: [], suspeitas: [], final: [] };
  const pareadas = new Map(); // id atual → proposta

  for (const p of propostas) {
    if (p.fim !== 'A_CONFIRMAR' && p.fim < hoje) {
      r.ignoradas.push({ oferta: p, motivo: `já terminou (fim em ${dataBr(p.fim)})` });
      continue;
    }
    // Oferta atual que já terminou não é "alterada": a nova campanha entra como nova.
    const candidatas = atuais.filter((a) => chave(a) === chave(p) && !pareadas.has(a.id) && !(a.fim !== 'A_CONFIRMAR' && a.fim < hoje));
    const antes = candidatas.find((a) => a.id === p.id) ?? candidatas[0];
    if (!antes) {
      r.novas.push(p);
      continue;
    }
    pareadas.set(antes.id, p);
  }

  for (const a of atuais) {
    const p = pareadas.get(a.id);
    if (p) {
      const depois = { ...p, id: a.id, observacoes: a.observacoes ?? p.observacoes };
      if (a.observacoes === undefined) delete depois.observacoes;
      const mudancas = diferencas(a, depois);
      if (mudancas.length > 0) r.alteradas.push({ antes: a, depois, mudancas, idProposta: p.id });
      else r.iguais.push({ antes: a, depois });
      r.final.push(depois);
    } else if (a.fim !== 'A_CONFIRMAR' && a.fim < hoje) {
      r.encerradas.push({ oferta: a, motivo: `terminou em ${dataBr(a.fim)}` });
    } else if (cobertos.has(chave(a))) {
      r.encerradas.push({ oferta: a, motivo: 'não aparece mais na página oficial lida nesta semana' });
    } else {
      r.naoVerificadas.push(a);
      r.final.push(a);
    }
  }
  r.final.push(...r.novas);

  // Suspeitas: não bloqueiam, mas vêm primeiro no relatório.
  const conferir = (o, antes) => {
    const maior = maiorPontos(o);
    const normal = pontosNormais(atuais, o.programa_id, antes?.id);
    if (normal && normal.valor > 0 && maior > FATOR_SUSPEITO * normal.valor) {
      r.suspeitas.push({ id: o.id, motivo: `${maior} pontos por real é mais de ${FATOR_SUSPEITO} vezes o normal (${normal.valor}, mediana ${normal.base})` });
    }
    if (antes && maior > FATOR_SUSPEITO * maiorPontos(antes)) {
      r.suspeitas.push({ id: o.id, motivo: `pontos por real subiu de ${maiorPontos(antes)} para ${maior}` });
    }
    if (o.regras.some((x) => x.pontos_por_real === 0)) r.suspeitas.push({ id: o.id, motivo: 'faixa com 0 ponto por real' });
    if (o.inicio !== 'A_CONFIRMAR' && o.inicio > hoje) r.suspeitas.push({ id: o.id, motivo: `começa no futuro (${dataBr(o.inicio)})` });
  };
  r.novas.forEach((o) => conferir(o));
  r.alteradas.forEach(({ antes, depois }) => conferir(depois, antes));
  return r;
}

/** Código de aprovação: depende da lista final e do ofertas.json de base. */
export function codigoDeAprovacao(final, baseSha256) {
  return createHash('sha256').update(JSON.stringify({ baseSha256, final })).digest('hex').slice(0, 10);
}

export const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');
