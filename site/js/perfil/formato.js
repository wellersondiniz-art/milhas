// Formato do perfil "Meu perfil": versão, migração, limpeza, exportação e
// validação rígida do arquivo importado.
//
// Tudo aqui é função pura (sem localStorage, sem DOM). O perfil só guarda
// ids dos cadastros, booleanos, datas e centavos: nada de número de cartão,
// CPF ou nome da pessoa (CLAUDE.md, seção 5).
//
// Formato atual (versão 2):
// {
//   versao: 2,
//   programas: [{ programa_id, clube_ativo, clube_ativo_desde? }],
//   cartoes: [cartao_id],
//   valor_milheiro_brl: { programa_id: centavos },
//   cotacao_dolar?: reais × 10.000 (53456 = R$ 5,3456)
// }
// cotacao_dolar é opcional e entrou depois, sem mudar a versão: perfis
// antigos simplesmente não têm o campo.
// Versão 1 (tela inicial, antes desta tela): o mesmo, mas sem o campo versao.

export const VERSAO_ATUAL = 2;
export const APP = 'comprador-de-milhas';

/** Maior milheiro aceito: R$ 999,99 (em centavos). */
export const MILHEIRO_MAXIMO = 99999;
/** Cotação do dólar aceita, em reais × 10.000: de R$ 0,0001 a R$ 99,9999. */
export const COTACAO_MAXIMA = 999999;
/** Maior arquivo de importação aceito, em caracteres. Um perfil real tem poucos KB. */
export const TAMANHO_MAXIMO = 50000;

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function perfilVazio() {
  return { versao: VERSAO_ATUAL, programas: [], cartoes: [], valor_milheiro_brl: {} };
}

/** Sem programa e sem cartão marcado. null também conta como vazio. */
export function ehVazio(perfil) {
  return !perfil || (perfil.programas.length === 0 && perfil.cartoes.length === 0);
}

/** "2026-02-30" não existe; "2026-02-28" existe. */
export function dataValida(texto) {
  const m = typeof texto === 'string' ? DATA.exec(texto) : null;
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return ano >= 1990 && d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function objetoSimples(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function cotacaoValida(v) {
  return Number.isSafeInteger(v) && v > 0 && v <= COTACAO_MAXIMA;
}

/** Copia a cotação para o perfil só se ela for válida. */
function comCotacao(perfil, v) {
  if (cotacaoValida(v)) perfil.cotacao_dolar = v;
  return perfil;
}

/**
 * Leva um perfil de qualquer versão conhecida para a versão atual.
 * Devolve null se não for perfil ou se for de uma versão mais nova que esta.
 * Não confere ids: isso é com limparPerfil.
 */
export function migrar(bruto) {
  if (!objetoSimples(bruto)) return null;
  const versao = bruto.versao === undefined ? 1 : bruto.versao;
  if (!Number.isSafeInteger(versao) || versao < 1 || versao > VERSAO_ATUAL) return null;
  if (!Array.isArray(bruto.programas) || !Array.isArray(bruto.cartoes)) return null;
  // 1 → 2: só ganhou o campo versao.
  return comCotacao({
    versao: VERSAO_ATUAL,
    programas: bruto.programas,
    cartoes: bruto.cartoes,
    valor_milheiro_brl: objetoSimples(bruto.valor_milheiro_brl) ? bruto.valor_milheiro_brl : {},
  }, bruto.cotacao_dolar);
}

/**
 * Limpa o perfil lido do aparelho, sem reclamar: tira o que não existe mais
 * no cadastro (o cadastro muda com o tempo) e o que estiver quebrado.
 * Devolve null se não der para ler.
 */
export function limparPerfil(bruto, dados) {
  const perfil = migrar(bruto);
  if (!perfil) return null;
  const programasConhecidos = new Set(dados.programas.map((p) => p.id));
  const cartoesConhecidos = new Set(dados.cartoes.map((c) => c.id));
  const vistos = new Set();
  const programas = [];
  for (const p of perfil.programas) {
    if (!objetoSimples(p) || !programasConhecidos.has(p.programa_id) || vistos.has(p.programa_id)) continue;
    vistos.add(p.programa_id);
    const item = { programa_id: p.programa_id, clube_ativo: p.clube_ativo === true };
    if (item.clube_ativo && dataValida(p.clube_ativo_desde)) item.clube_ativo_desde = p.clube_ativo_desde;
    programas.push(item);
  }
  const cartoes = [...new Set(perfil.cartoes.filter((id) => cartoesConhecidos.has(id)))];
  const valor_milheiro_brl = {};
  for (const id of Object.keys(perfil.valor_milheiro_brl)) {
    const v = perfil.valor_milheiro_brl[id];
    if (vistos.has(id) && Number.isSafeInteger(v) && v > 0 && v <= MILHEIRO_MAXIMO) valor_milheiro_brl[id] = v;
  }
  return comCotacao({ versao: VERSAO_ATUAL, programas, cartoes, valor_milheiro_brl }, perfil.cotacao_dolar);
}

/** O que o motor recebe: programas, cartões, milheiro e cotação (sem o campo versao). */
export function perfilParaConta(perfil) {
  return comCotacao(
    { programas: perfil.programas, cartoes: perfil.cartoes, valor_milheiro_brl: perfil.valor_milheiro_brl },
    perfil.cotacao_dolar,
  );
}

/** Perfil para quem não marcou nada: todos os programas (sem clube) e todos os cartões, com a cotação que a pessoa informou, se houver. */
export function perfilDeTodos(dados, cotacaoDolar) {
  return comCotacao({
    programas: dados.programas.map((p) => ({ programa_id: p.id, clube_ativo: false })),
    cartoes: dados.cartoes.map((c) => c.id),
    valor_milheiro_brl: {},
  }, cotacaoDolar);
}

/** Nada para guardar: nem marcação nem cotação. */
export function semNadaParaGuardar(perfil) {
  return ehVazio(perfil) && !cotacaoValida(perfil?.cotacao_dolar);
}

// ---------------------------------------------------------------------------
// Exportar

/** Texto do arquivo exportado. `agora` em ISO, para o arquivo dizer quando foi feito. */
export function textoParaExportar(perfil, agora) {
  const p = perfil ?? perfilVazio();
  return `${JSON.stringify({
    app: APP,
    versao: VERSAO_ATUAL,
    exportado_em: agora,
    programas: p.programas,
    cartoes: p.cartoes,
    valor_milheiro_brl: p.valor_milheiro_brl,
    ...(cotacaoValida(p.cotacao_dolar) ? { cotacao_dolar: p.cotacao_dolar } : {}),
  }, null, 2)}\n`;
}

/** Nome do arquivo: meu-perfil-milhas-AAAA-MM-DD.json */
export function nomeDoArquivo(hoje) {
  return `meu-perfil-milhas-${hoje}.json`;
}

// ---------------------------------------------------------------------------
// Importar (validação rígida)

/** Mostra um valor qualquer do arquivo como texto curto, para a mensagem de erro. */
export function trecho(valor) {
  let t;
  if (typeof valor === 'string') t = `"${valor}"`;
  else try { t = JSON.stringify(valor); } catch { t = String(valor); }
  if (t === undefined) t = String(valor);
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}

function chavesSobrando(objeto, permitidas) {
  return Object.keys(objeto).filter((k) => !permitidas.includes(k));
}

/**
 * Lê o texto de um arquivo importado. Qualquer coisa fora do formato
 * reprova o arquivo inteiro: nada é importado pela metade.
 *
 * @param {string} texto   conteúdo do arquivo
 * @param {object} dados   { programas, cartoes } do cadastro
 * @param {string} hoje    "AAAA-MM-DD" (data do clube não pode ser depois disso)
 * @returns {{ ok: true, perfil: object } | { ok: false, erros: string[] }}
 */
export function validarImportacao(texto, dados, hoje) {
  const falha = (...erros) => ({ ok: false, erros });
  if (typeof texto !== 'string' || !texto.trim()) return falha('O arquivo está vazio.');
  if (texto.length > TAMANHO_MAXIMO) return falha('O arquivo é grande demais para ser um perfil.');

  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return falha('O arquivo não é um JSON válido. Use o arquivo que este site gerou em "Exportar perfil".');
  }
  if (!objetoSimples(bruto)) return falha('O arquivo não tem o formato de um perfil.');

  const erros = [];
  const sobra = chavesSobrando(bruto, ['app', 'versao', 'exportado_em', 'programas', 'cartoes', 'valor_milheiro_brl', 'cotacao_dolar']);
  if (sobra.length) erros.push(`Campo que não conhecemos: ${sobra.map(trecho).join(', ')}.`);
  if (bruto.app !== APP) erros.push('O arquivo não foi gerado pelo site Milhas da Vez.');
  if (!Number.isSafeInteger(bruto.versao) || bruto.versao < 1) {
    erros.push('Falta a versão do formato (campo "versao").');
  } else if (bruto.versao > VERSAO_ATUAL) {
    erros.push('O arquivo é de uma versão mais nova do site. Atualize a página e tente de novo.');
  }
  if (bruto.exportado_em !== undefined && (typeof bruto.exportado_em !== 'string' || !dataValida(bruto.exportado_em.slice(0, 10)))) {
    erros.push('A data de exportação está fora do formato.');
  }

  const nomePrograma = new Map(dados.programas.map((p) => [p.id, p.nome]));
  const cartoesConhecidos = new Set(dados.cartoes.map((c) => c.id));
  const programas = [];
  const marcados = new Set();

  if (!Array.isArray(bruto.programas)) {
    erros.push('Falta a lista de programas.');
  } else {
    if (bruto.programas.length > dados.programas.length) erros.push('Há mais programas no arquivo do que no nosso cadastro.');
    bruto.programas.forEach((p, i) => {
      const onde = `Programa nº ${i + 1}`;
      if (!objetoSimples(p)) { erros.push(`${onde}: formato inválido.`); return; }
      const sobraP = chavesSobrando(p, ['programa_id', 'clube_ativo', 'clube_ativo_desde']);
      if (sobraP.length) erros.push(`${onde}: campo que não conhecemos: ${sobraP.map(trecho).join(', ')}.`);
      if (typeof p.programa_id !== 'string' || !nomePrograma.has(p.programa_id)) {
        erros.push(`${onde}: não conhecemos o programa ${trecho(p.programa_id)}.`);
        return;
      }
      const nome = nomePrograma.get(p.programa_id);
      if (marcados.has(p.programa_id)) { erros.push(`${nome} aparece mais de uma vez.`); return; }
      marcados.add(p.programa_id);
      if (typeof p.clube_ativo !== 'boolean') erros.push(`${nome}: "clube_ativo" precisa ser true ou false.`);
      const item = { programa_id: p.programa_id, clube_ativo: p.clube_ativo === true };
      if (p.clube_ativo_desde !== undefined) {
        if (p.clube_ativo !== true) erros.push(`${nome}: tem data do clube, mas o clube não está ativo.`);
        else if (!dataValida(p.clube_ativo_desde)) erros.push(`${nome}: a data do clube ${trecho(p.clube_ativo_desde)} não é uma data válida (AAAA-MM-DD).`);
        else if (p.clube_ativo_desde > hoje) erros.push(`${nome}: a data do clube está no futuro.`);
        else item.clube_ativo_desde = p.clube_ativo_desde;
      }
      programas.push(item);
    });
  }

  let cartoes = [];
  if (!Array.isArray(bruto.cartoes)) {
    erros.push('Falta a lista de cartões.');
  } else {
    if (bruto.cartoes.length > dados.cartoes.length) erros.push('Há mais cartões no arquivo do que no nosso cadastro.');
    const vistos = new Set();
    bruto.cartoes.forEach((id, i) => {
      if (typeof id !== 'string' || !cartoesConhecidos.has(id)) {
        erros.push(`Cartão nº ${i + 1}: não conhecemos o cartão ${trecho(id)}.`);
      } else if (vistos.has(id)) {
        erros.push(`O cartão ${trecho(id)} aparece mais de uma vez.`);
      } else {
        vistos.add(id);
      }
    });
    cartoes = [...vistos];
  }

  const valor_milheiro_brl = {};
  if (bruto.valor_milheiro_brl !== undefined) {
    if (!objetoSimples(bruto.valor_milheiro_brl)) {
      erros.push('O valor do milheiro está fora do formato.');
    } else {
      for (const id of Object.keys(bruto.valor_milheiro_brl)) {
        const v = bruto.valor_milheiro_brl[id];
        if (!nomePrograma.has(id)) erros.push(`Milheiro: não conhecemos o programa ${trecho(id)}.`);
        else if (!marcados.has(id)) erros.push(`Milheiro do ${nomePrograma.get(id)}: o programa não está marcado.`);
        else if (!Number.isSafeInteger(v) || v <= 0 || v > MILHEIRO_MAXIMO) {
          erros.push(`Milheiro do ${nomePrograma.get(id)}: precisa ser centavos inteiros entre 1 e ${MILHEIRO_MAXIMO} (recebido: ${trecho(v)}).`);
        } else valor_milheiro_brl[id] = v;
      }
    }
  }

  if (bruto.cotacao_dolar !== undefined && !cotacaoValida(bruto.cotacao_dolar)) {
    erros.push(`Cotação do dólar: precisa ser um inteiro entre 1 e ${COTACAO_MAXIMA} (reais × 10.000; recebido: ${trecho(bruto.cotacao_dolar)}).`);
  }

  if (erros.length) return { ok: false, erros: erros.slice(0, 10).concat(erros.length > 10 ? [`E mais ${erros.length - 10} problemas.`] : []) };
  return { ok: true, perfil: comCotacao({ versao: VERSAO_ATUAL, programas, cartoes, valor_milheiro_brl }, bruto.cotacao_dolar) };
}
