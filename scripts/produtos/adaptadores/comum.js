// Peças comuns dos adaptadores: chamada HTTP com prazo e erro sem segredo.

/** Quanto esperar cada resposta de API antes de desistir. */
export const PRAZO_MS = 20_000;

export class ErroDeApi extends Error {}

/** Tira do texto qualquer segredo que possa ter vazado na mensagem de erro. */
export function semSegredos(texto, segredos) {
  let saida = String(texto);
  for (const s of segredos) if (typeof s === 'string' && s.length >= 4) saida = saida.split(s).join('***');
  return saida;
}

/**
 * fetch com prazo. Devolve o JSON; status fora de 2xx vira ErroDeApi com o
 * status e o começo da resposta (sem os segredos).
 */
export async function pedirJson(buscar, url, opcoes, { rotulo, segredos = [] }) {
  let resposta;
  try {
    resposta = await buscar(url, { ...opcoes, signal: AbortSignal.timeout(PRAZO_MS) });
  } catch (falha) {
    throw new ErroDeApi(`${rotulo}: sem resposta (${semSegredos(falha.message, segredos)})`);
  }
  const texto = await resposta.text();
  if (!resposta.ok) throw new ErroDeApi(`${rotulo}: HTTP ${resposta.status} ${semSegredos(texto.slice(0, 200), segredos)}`);
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErroDeApi(`${rotulo}: resposta não é JSON`);
  }
}

/** Variáveis de ambiente que faltam. */
export function faltando(env, nomes) {
  return nomes.filter((n) => typeof env[n] !== 'string' || !env[n].trim());
}
