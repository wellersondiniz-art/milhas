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
//   programas: [{ programa_id, clube_ativo, clube_ativo_desde?, pontos_vencem_em? }],
//   cartoes: [cartao_id],
//   valor_milheiro_brl: { programa_id: centavos },
//   cotacao_dolar?: reais × 10.000 (53456 = R$ 5,3456),
//   cartoes_proprios?: [{ id: "meu-1", nome, programa_id, pontos_por_real?, pontos_por_dolar?, anuidade_brl? }]
// }
// cartoes_proprios: cartões que a pessoa tem e que não estão no nosso cadastro.
// Os números são os que ELA digitou (sem fonte nossa); ficam só no aparelho e
// entram na conta como qualquer cartão. O id deles também pode estar em
// `cartoes` (marcado ou não, como os do cadastro).
// cotacao_dolar e pontos_vencem_em (data em que vencem os próximos pontos,
// copiada pela pessoa do extrato do programa) são opcionais e entraram depois,
// sem mudar a versão: perfis antigos simplesmente não têm os campos.
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
const A_CONFIRMAR_TEXTO = 'A_CONFIRMAR';

// ---------------------------------------------------------------------------
// Cartões informados pela pessoa ("Adicionar meu cartão")

/** No máximo 10 cartões próprios: ninguém usa mais que isso, e o arquivo fica pequeno. */
export const CARTOES_PROPRIOS_MAXIMO = 10;
export const NOME_CARTAO_MINIMO = 2;
export const NOME_CARTAO_MAXIMO = 60;
/** Maior número de pontos por real ou por dólar aceito (o maior do cadastro é bem menor). */
export const PONTOS_MAXIMO = 20;
/** Maior anuidade aceita: R$ 99.999,99 (em centavos). */
export const ANUIDADE_MAXIMA = 9999999;
/** Todo cartão próprio tem id "meu-<número>", que nunca bate com um id do cadastro. */
export const PREFIXO_PROPRIO = 'meu-';
const ID_PROPRIO = /^meu-[1-9][0-9]{0,2}$/;
const CAMPOS_CARTAO_PROPRIO = ['id', 'nome', 'programa_id', 'pontos_por_real', 'pontos_por_dolar', 'anuidade_brl'];
// Controles, marcas de direção do texto e caracteres invisíveis.
// eslint-disable-next-line no-control-regex
const INVISIVEIS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
// Só letras, números, espaço e pontuação comum em nome de cartão.
const NOME_PERMITIDO = /^[\p{L}\p{N} .,()'&+/-]+$/u;

export function ehCartaoProprio(id) {
  return typeof id === 'string' && ID_PROPRIO.test(id);
}

/** Nome digitado: sem invisíveis, sem espaço sobrando. */
export function limparNomeDoCartao(texto) {
  // Quebra de linha e tab viram espaço antes de tirar os controles.
  return String(texto ?? '').normalize('NFC').replace(/\s+/g, ' ').replace(INVISIVEIS, '').replace(/ {2,}/g, ' ').trim();
}

/** Pontos por real ou por dólar: maior que zero, até PONTOS_MAXIMO, no máximo 2 casas. */
export function pontosValidos(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= PONTOS_MAXIMO
    && Math.abs(Math.round(v * 100) - v * 100) < 1e-9;
}

export function anuidadeValida(v) {
  return Number.isSafeInteger(v) && v >= 0 && v <= ANUIDADE_MAXIMA;
}

/**
 * Confere um cartão informado pela pessoa. Função pura.
 * Erros vêm por campo, para a tela marcar cada um.
 *
 * @param {object} bruto            { id, nome, programa_id, pontos_por_real?, pontos_por_dolar?, anuidade_brl? }
 * @param {Map<string,string>|Set<string>} programas  ids (ou id → nome) dos programas do cadastro
 * @returns {{ ok: true, cartao: object } | { ok: false, erros: Record<string,string> }}
 */
export function validarCartaoProprio(bruto, programas) {
  if (!objetoSimples(bruto)) return { ok: false, erros: { geral: 'O cartão está fora do formato.' } };
  const erros = {};
  const sobra = chavesSobrando(bruto, CAMPOS_CARTAO_PROPRIO);
  if (sobra.length) erros.geral = `Campo que não conhecemos: ${sobra.map(trecho).join(', ')}.`;
  if (!ehCartaoProprio(bruto.id)) erros.id = 'O código do cartão está fora do formato.';
  const nome = typeof bruto.nome === 'string' ? limparNomeDoCartao(bruto.nome) : '';
  if (nome.length < NOME_CARTAO_MINIMO || nome.length > NOME_CARTAO_MAXIMO) {
    erros.nome = `Escreva o nome do cartão, como aparece no site do banco (de ${NOME_CARTAO_MINIMO} a ${NOME_CARTAO_MAXIMO} letras).`;
  } else if ((nome.match(/\d/g) ?? []).length >= 6) {
    // Nome de cartão não tem tanto número; número de cartão ou CPF, sim.
    erros.nome = 'Escreva só o nome do cartão. Nunca o número do cartão nem o CPF.';
  } else if (!NOME_PERMITIDO.test(nome)) {
    erros.nome = 'Use só letras, números, espaço e pontuação simples no nome.';
  }
  if (typeof bruto.programa_id !== 'string' || !programas.has(bruto.programa_id)) {
    erros.programa_id = 'Escolha o programa em que os pontos do cartão caem.';
  }
  const temReal = bruto.pontos_por_real !== undefined;
  const temDolar = bruto.pontos_por_dolar !== undefined;
  if (temReal && !pontosValidos(bruto.pontos_por_real)) {
    erros.pontos_por_real = `Pontos por real: um número maior que zero e até ${PONTOS_MAXIMO}, com até 2 casas depois da vírgula.`;
  }
  if (temDolar && !pontosValidos(bruto.pontos_por_dolar)) {
    erros.pontos_por_dolar = `Pontos por dólar: um número maior que zero e até ${PONTOS_MAXIMO}, com até 2 casas depois da vírgula.`;
  }
  if (!temReal && !temDolar) erros.pontos_por_real = 'Informe quantos pontos o cartão dá por real ou por dólar gasto.';
  if (bruto.anuidade_brl !== undefined && !anuidadeValida(bruto.anuidade_brl)) {
    erros.anuidade_brl = 'A anuidade precisa ser um valor em reais de R$ 0,00 a R$ 99.999,99.';
  }
  if (Object.keys(erros).length) return { ok: false, erros };
  const cartao = { id: bruto.id, nome, programa_id: bruto.programa_id };
  if (temReal) cartao.pontos_por_real = bruto.pontos_por_real;
  if (temDolar) cartao.pontos_por_dolar = bruto.pontos_por_dolar;
  if (bruto.anuidade_brl !== undefined) cartao.anuidade_brl = bruto.anuidade_brl;
  return { ok: true, cartao };
}

/**
 * Pontos digitados na tela ("2", "2,5", "1.75") → número.
 * undefined se o campo está vazio; null se o texto não é um número desses.
 */
export function lerPontosDigitados(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return undefined;
  const m = /^(\d{1,3})(?:[,.](\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return Number(`${m[1]}.${m[2] ?? '0'}`);
}

/** Próximo id livre: "meu-1", "meu-2"… (o menor que ninguém usa). null se já há o máximo. */
export function novoIdProprio(cartoesProprios) {
  const usados = new Set((cartoesProprios ?? []).map((c) => c.id));
  if (usados.size >= CARTOES_PROPRIOS_MAXIMO) return null;
  for (let n = 1; ; n++) if (!usados.has(`${PREFIXO_PROPRIO}${n}`)) return `${PREFIXO_PROPRIO}${n}`;
}

/**
 * Cartão da pessoa no formato de cartoes.json, para o motor tratar igual aos
 * outros. Sem fonte_url nem verificado_em: não há fonte nossa, e a tela mostra
 * "informado por você" no lugar do selo de fonte. O que ela não informou fica
 * A_CONFIRMAR (e não entra na conta).
 */
export function registroDoCartaoProprio(c) {
  return {
    id: c.id,
    nome: c.nome,
    emissor: A_CONFIRMAR_TEXTO,
    bandeira: A_CONFIRMAR_TEXTO,
    programa_id: c.programa_id,
    pontos_por_real: c.pontos_por_real ?? A_CONFIRMAR_TEXTO,
    ...(c.pontos_por_dolar !== undefined ? { pontos_por_dolar: c.pontos_por_dolar } : {}),
    anuidade_brl: c.anuidade_brl ?? A_CONFIRMAR_TEXTO,
    observacoes: 'Números informados pela pessoa, guardados só no aparelho dela.',
    status: 'confirmado',
    informado_pela_pessoa: true,
  };
}

/** Os dados do site com os cartões da pessoa no fim da lista de cartões. */
export function dadosComCartoesDaPessoa(dados, perfil) {
  const proprios = perfil?.cartoes_proprios ?? [];
  if (!proprios.length) return dados;
  return { ...dados, cartoes: [...dados.cartoes, ...proprios.map(registroDoCartaoProprio)] };
}

/**
 * O perfil sem os cartões que a pessoa adicionou: é o que pode sair do
 * aparelho (alertas, "Explica pra mim"), porque o servidor só conhece o
 * cadastro e os números da pessoa ficam com ela. null continua null.
 */
export function perfilSemCartoesDaPessoa(perfil) {
  if (!perfil) return perfil ?? null;
  const { cartoes_proprios: _proprios, ...resto } = perfil;
  return { ...resto, cartoes: perfil.cartoes.filter((id) => !ehCartaoProprio(id)) };
}

/** Limpa a lista lida do aparelho, sem reclamar: fica só o que passa na conferência. */
function limparCartoesProprios(lista, programasConhecidos) {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set();
  const saida = [];
  for (const bruto of lista) {
    if (saida.length >= CARTOES_PROPRIOS_MAXIMO) break;
    const r = validarCartaoProprio(bruto, programasConhecidos);
    if (!r.ok || vistos.has(r.cartao.id)) continue;
    vistos.add(r.cartao.id);
    saida.push(r.cartao);
  }
  return saida;
}

/** Copia a lista para o perfil só se houver algum cartão. */
function comProprios(perfil, lista) {
  if (lista.length) perfil.cartoes_proprios = lista;
  return perfil;
}

export function perfilVazio() {
  return { versao: VERSAO_ATUAL, programas: [], cartoes: [], valor_milheiro_brl: {} };
}

/** Sem programa e sem cartão marcado (cartão próprio desmarcado não conta). null também conta como vazio. */
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
  const perfil = comCotacao({
    versao: VERSAO_ATUAL,
    programas: bruto.programas,
    cartoes: bruto.cartoes,
    valor_milheiro_brl: objetoSimples(bruto.valor_milheiro_brl) ? bruto.valor_milheiro_brl : {},
  }, bruto.cotacao_dolar);
  if (Array.isArray(bruto.cartoes_proprios) && bruto.cartoes_proprios.length) perfil.cartoes_proprios = bruto.cartoes_proprios;
  return perfil;
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
  const proprios = limparCartoesProprios(perfil.cartoes_proprios, programasConhecidos);
  const cartoesConhecidos = new Set([...dados.cartoes.map((c) => c.id), ...proprios.map((c) => c.id)]);
  const vistos = new Set();
  const programas = [];
  for (const p of perfil.programas) {
    if (!objetoSimples(p) || !programasConhecidos.has(p.programa_id) || vistos.has(p.programa_id)) continue;
    vistos.add(p.programa_id);
    const item = { programa_id: p.programa_id, clube_ativo: p.clube_ativo === true };
    if (item.clube_ativo && dataValida(p.clube_ativo_desde)) item.clube_ativo_desde = p.clube_ativo_desde;
    if (dataValida(p.pontos_vencem_em)) item.pontos_vencem_em = p.pontos_vencem_em;
    programas.push(item);
  }
  const cartoes = [...new Set(perfil.cartoes.filter((id) => cartoesConhecidos.has(id)))];
  const valor_milheiro_brl = {};
  for (const id of Object.keys(perfil.valor_milheiro_brl)) {
    const v = perfil.valor_milheiro_brl[id];
    if (vistos.has(id) && Number.isSafeInteger(v) && v > 0 && v <= MILHEIRO_MAXIMO) valor_milheiro_brl[id] = v;
  }
  return comProprios(comCotacao({ versao: VERSAO_ATUAL, programas, cartoes, valor_milheiro_brl }, perfil.cotacao_dolar), proprios);
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

/** Junta o cartão novo ao perfil. Função pura. */
export function perfilComCartaoProprio(atual, cartao) {
  const base = atual ?? perfilVazio();
  const novo = {
    ...base,
    programas: base.programas.map((p) => ({ ...p })),
    cartoes: [...base.cartoes],
    cartoes_proprios: [...(base.cartoes_proprios ?? []), cartao],
  };
  // Perfil vazio quer dizer "todos os cartões": aí o cartão novo já entra sem marcar,
  // e marcar só ele tiraria os outros da conta. Com perfil, ele entra marcado,
  // junto com o programa dele (para os pontos dele valerem).
  if (!ehVazio(base)) {
    novo.cartoes.push(cartao.id);
    if (!novo.programas.some((p) => p.programa_id === cartao.programa_id)) {
      novo.programas.push({ programa_id: cartao.programa_id, clube_ativo: false });
    }
  }
  return novo;
}

/** Tira o cartão adicionado (e a marca dele). Função pura. */
export function perfilSemCartaoProprio(atual, id) {
  const novo = {
    ...atual,
    cartoes: atual.cartoes.filter((c) => c !== id),
    cartoes_proprios: (atual.cartoes_proprios ?? []).filter((c) => c.id !== id),
  };
  if (!novo.cartoes_proprios.length) delete novo.cartoes_proprios;
  return novo;
}

/** Nada para guardar: nem marcação, nem cotação, nem cartão próprio. */
export function semNadaParaGuardar(perfil) {
  return ehVazio(perfil) && !cotacaoValida(perfil?.cotacao_dolar) && !(perfil?.cartoes_proprios?.length);
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
    ...(p.cartoes_proprios?.length ? { cartoes_proprios: p.cartoes_proprios } : {}),
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
  const sobra = chavesSobrando(bruto, ['app', 'versao', 'exportado_em', 'programas', 'cartoes', 'valor_milheiro_brl', 'cotacao_dolar', 'cartoes_proprios']);
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

  // Cartões próprios primeiro: os ids deles podem aparecer em "cartoes".
  const proprios = [];
  if (bruto.cartoes_proprios !== undefined) {
    if (!Array.isArray(bruto.cartoes_proprios)) {
      erros.push('A lista de cartões que você adicionou está fora do formato.');
    } else if (bruto.cartoes_proprios.length > CARTOES_PROPRIOS_MAXIMO) {
      erros.push(`Há mais de ${CARTOES_PROPRIOS_MAXIMO} cartões adicionados por você no arquivo.`);
    } else {
      const ids = new Set();
      bruto.cartoes_proprios.forEach((c, i) => {
        const r = validarCartaoProprio(c, nomePrograma);
        const onde = `Cartão adicionado nº ${i + 1}`;
        if (!r.ok) { erros.push(`${onde}: ${Object.values(r.erros).join(' ')}`); return; }
        if (ids.has(r.cartao.id)) { erros.push(`${onde}: o código ${trecho(r.cartao.id)} aparece mais de uma vez.`); return; }
        ids.add(r.cartao.id);
        proprios.push(r.cartao);
      });
    }
  }
  const cartoesConhecidos = new Set([...dados.cartoes.map((c) => c.id), ...proprios.map((c) => c.id)]);
  const programas = [];
  const marcados = new Set();

  if (!Array.isArray(bruto.programas)) {
    erros.push('Falta a lista de programas.');
  } else {
    if (bruto.programas.length > dados.programas.length) erros.push('Há mais programas no arquivo do que no nosso cadastro.');
    bruto.programas.forEach((p, i) => {
      const onde = `Programa nº ${i + 1}`;
      if (!objetoSimples(p)) { erros.push(`${onde}: formato inválido.`); return; }
      const sobraP = chavesSobrando(p, ['programa_id', 'clube_ativo', 'clube_ativo_desde', 'pontos_vencem_em']);
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
      if (p.pontos_vencem_em !== undefined) {
        if (!dataValida(p.pontos_vencem_em)) erros.push(`${nome}: a data de vencimento dos pontos ${trecho(p.pontos_vencem_em)} não é uma data válida (AAAA-MM-DD).`);
        else item.pontos_vencem_em = p.pontos_vencem_em;
      }
      programas.push(item);
    });
  }

  let cartoes = [];
  if (!Array.isArray(bruto.cartoes)) {
    erros.push('Falta a lista de cartões.');
  } else {
    if (bruto.cartoes.length > cartoesConhecidos.size) erros.push('Há mais cartões no arquivo do que no nosso cadastro.');
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
  return { ok: true, perfil: comProprios(comCotacao({ versao: VERSAO_ATUAL, programas, cartoes, valor_milheiro_brl }, bruto.cotacao_dolar), proprios) };
}
