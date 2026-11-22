// Perfil da pessoa: programas, clubes, cartões e o valor do milheiro que ela
// quiser informar. Fica só no localStorage do aparelho (CLAUDE.md, seção 5).
// Nada de número de cartão ou CPF: só os ids dos cadastros.
//
// As funções daqui são puras, menos lerDoAparelho e salvarNoAparelho.

export const CHAVE = 'comprador-de-milhas:perfil:v1';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Perfil para quem ainda não disse nada: todos os programas (sem clube) e todos os cartões. */
export function perfilDeTodos(dados) {
  return {
    programas: dados.programas.map((p) => ({ programa_id: p.id, clube_ativo: false })),
    cartoes: dados.cartoes.map((c) => c.id),
    valor_milheiro_brl: {},
  };
}

/**
 * Limpa o que veio do aparelho: só ids que existem nos dados, booleanos de
 * verdade, datas AAAA-MM-DD e centavos inteiros. Devolve null se não houver
 * perfil (ou se estiver ilegível).
 */
export function limparPerfil(bruto, dados) {
  if (!bruto || typeof bruto !== 'object' || !Array.isArray(bruto.programas) || !Array.isArray(bruto.cartoes)) {
    return null;
  }
  const programasConhecidos = new Set(dados.programas.map((p) => p.id));
  const cartoesConhecidos = new Set(dados.cartoes.map((c) => c.id));
  const vistos = new Set();
  const programas = [];
  for (const p of bruto.programas) {
    if (!p || !programasConhecidos.has(p.programa_id) || vistos.has(p.programa_id)) continue;
    vistos.add(p.programa_id);
    const item = { programa_id: p.programa_id, clube_ativo: p.clube_ativo === true };
    if (item.clube_ativo && typeof p.clube_ativo_desde === 'string' && DATA.test(p.clube_ativo_desde)) {
      item.clube_ativo_desde = p.clube_ativo_desde;
    }
    programas.push(item);
  }
  const cartoes = [...new Set(bruto.cartoes.filter((id) => cartoesConhecidos.has(id)))];
  const valor_milheiro_brl = {};
  for (const [id, v] of Object.entries(bruto.valor_milheiro_brl ?? {})) {
    if (programasConhecidos.has(id) && Number.isSafeInteger(v) && v > 0) valor_milheiro_brl[id] = v;
  }
  return { programas, cartoes, valor_milheiro_brl };
}

/** Perfil salvo neste aparelho, já limpo, ou null. Nunca lança erro. */
export function lerDoAparelho(dados, armazenamento = globalThis.localStorage) {
  try {
    const texto = armazenamento?.getItem(CHAVE);
    return texto ? limparPerfil(JSON.parse(texto), dados) : null;
  } catch {
    return null;
  }
}

/** Salva o perfil neste aparelho. Devolve false se o navegador não deixar. */
export function salvarNoAparelho(perfil, armazenamento = globalThis.localStorage) {
  try {
    armazenamento.setItem(CHAVE, JSON.stringify(perfil));
    return true;
  } catch {
    return false;
  }
}

/** Apaga o perfil deste aparelho. */
export function apagarDoAparelho(armazenamento = globalThis.localStorage) {
  try {
    armazenamento.removeItem(CHAVE);
    return true;
  } catch {
    return false;
  }
}
