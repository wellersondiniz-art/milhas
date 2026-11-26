// Valida os arquivos de dados/ contra os schemas de dados/schemas/ e confere
// as regras que um schema sozinho não cobre (ids entre arquivos, datas etc.).
//
// Sem dependências. Implementa só o pedaço do JSON Schema (draft 2020-12) que
// os nossos schemas usam; se um schema usar uma palavra-chave fora da lista
// abaixo, o validador para com erro, em vez de ignorá-la em silêncio.
//
// Uso: node scripts/validar-dados.js
// Saída: 0 se os dados forem válidos, 1 se houver erro.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const ARQUIVOS = [
  'programas', 'cartoes', 'lojas', 'ofertas', 'cambio', 'cotacoes', 'transferencias', 'bonus-transferencia', 'viagens',
];
export const A_CONFIRMAR = 'A_CONFIRMAR';
const PASTA_DADOS = new URL('../dados/', import.meta.url);

const PALAVRAS_CONHECIDAS = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description',
  'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'anyOf', 'minimum', 'minLength', 'minItems', 'pattern', 'format',
]);

// ---------------------------------------------------------------------------
// Datas

/** true se o texto é uma data AAAA-MM-DD que existe no calendário. */
export function dataValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Data de hoje em AAAA-MM-DD no fuso de Brasília. */
export function hojeEmBrasilia(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

// ---------------------------------------------------------------------------
// JSON Schema (subconjunto)

function tipoDe(valor) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'array';
  if (Number.isInteger(valor)) return 'integer';
  return typeof valor;
}

function confereTipo(valor, tipo) {
  const real = tipoDe(valor);
  if (tipo === 'number') return real === 'number' || real === 'integer';
  return real === tipo;
}

const NOME_TIPO = {
  string: 'texto', number: 'número', integer: 'número inteiro', boolean: 'verdadeiro/falso (true ou false)',
  object: 'objeto', array: 'lista', null: 'null',
};

function resolverRef(ref, raiz) {
  if (!ref.startsWith('#/')) throw new Error(`$ref não suportado: ${ref} (só referências locais "#/...")`);
  let alvo = raiz;
  for (const parte of ref.slice(2).split('/')) {
    alvo = alvo?.[parte];
  }
  if (alvo === undefined) throw new Error(`$ref aponta para nada: ${ref}`);
  return alvo;
}

/** Descrição curta, em português, do que um schema aceita (para mensagens de anyOf). */
function descrever(schema, raiz) {
  if (schema.$ref) return descrever(resolverRef(schema.$ref, raiz), raiz);
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.enum) return `um de ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`;
  if (schema.anyOf) return schema.anyOf.map((s) => descrever(s, raiz)).join(' ou ');
  if (schema.format === 'date') return 'data AAAA-MM-DD';
  if (schema.format === 'uri') return 'link https://';
  const partes = [NOME_TIPO[schema.type] ?? 'valor'];
  if (schema.minimum !== undefined) partes.push(`>= ${schema.minimum}`);
  if (schema.pattern) partes.push(`no formato ${schema.pattern}`);
  return partes.join(' ');
}

/**
 * Valida `valor` contra `schema`. Devolve uma lista de { caminho, mensagem }.
 * `caminho` é uma lista de chaves/índices até o campo com problema.
 */
export function validarSchema(valor, schema, raiz = schema, caminho = []) {
  for (const palavra of Object.keys(schema)) {
    if (!PALAVRAS_CONHECIDAS.has(palavra)) {
      throw new Error(`palavra-chave de schema não suportada pelo validador: "${palavra}"`);
    }
  }
  const erros = [];
  const erro = (mensagem, onde = caminho) => erros.push({ caminho: onde, mensagem });

  if (schema.$ref) {
    erros.push(...validarSchema(valor, resolverRef(schema.$ref, raiz), raiz, caminho));
  }

  if (schema.anyOf) {
    const algumServe = schema.anyOf.some((s) => validarSchema(valor, s, raiz, caminho).length === 0);
    if (!algumServe) {
      erro(`valor ${JSON.stringify(valor)} não aceito; esperado: ${descrever(schema, raiz)}`);
    }
    return erros;
  }

  if ('const' in schema && valor !== schema.const) {
    erro(`deve ser ${JSON.stringify(schema.const)} (recebido: ${JSON.stringify(valor)})`);
  }
  if (schema.enum && !schema.enum.includes(valor)) {
    erro(`valor ${JSON.stringify(valor)} não permitido; use ${descrever({ enum: schema.enum }, raiz)}`);
  }

  if (schema.type && !confereTipo(valor, schema.type)) {
    erro(`deve ser ${NOME_TIPO[schema.type]} (recebido: ${JSON.stringify(valor)})`);
    return erros; // as demais regras dependem do tipo certo
  }

  if (typeof valor === 'number') {
    if (schema.minimum !== undefined && valor < schema.minimum) {
      erro(`deve ser maior ou igual a ${schema.minimum} (recebido: ${valor})`);
    }
  }

  if (typeof valor === 'string') {
    if (schema.minLength !== undefined && valor.length < schema.minLength) {
      erro(schema.minLength === 1 ? 'não pode ficar vazio' : `deve ter ao menos ${schema.minLength} caracteres`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(valor)) {
      erro(`formato inválido: ${JSON.stringify(valor)} (esperado: ${schema.description ?? schema.pattern})`);
    }
    if (schema.format === 'date' && !dataValida(valor)) {
      erro(`data inválida: ${JSON.stringify(valor)} (use AAAA-MM-DD com uma data que exista)`);
    }
    if (schema.format === 'uri' && !URL.canParse(valor)) {
      erro(`link inválido: ${JSON.stringify(valor)}`);
    }
  }

  if (Array.isArray(valor)) {
    if (schema.minItems !== undefined && valor.length < schema.minItems) {
      erro(`deve ter ao menos ${schema.minItems} item(ns)`);
    }
    if (schema.items) {
      valor.forEach((item, i) => erros.push(...validarSchema(item, schema.items, raiz, [...caminho, i])));
    }
  }

  if (tipoDe(valor) === 'object') {
    const propriedades = schema.properties ?? {};
    for (const campo of schema.required ?? []) {
      if (!(campo in valor)) erro('campo obrigatório ausente', [...caminho, campo]);
    }
    for (const [campo, conteudo] of Object.entries(valor)) {
      if (campo in propriedades) {
        erros.push(...validarSchema(conteudo, propriedades[campo], raiz, [...caminho, campo]));
      } else if (schema.additionalProperties === false) {
        erro('campo desconhecido (não existe no schema)', [...caminho, campo]);
      }
    }
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Regras entre arquivos e regras de negócio

function regrasExtras(dados, hoje) {
  const erros = [];
  const avisos = [];
  const ids = {};

  for (const nome of ARQUIVOS) {
    ids[nome] = new Set();
    (dados[nome] ?? []).forEach((registro, i) => {
      if (ids[nome].has(registro.id)) {
        erros.push({ arquivo: nome, indice: i, caminho: ['id'], mensagem: `id repetido: ${JSON.stringify(registro.id)}` });
      }
      ids[nome].add(registro.id);
      if (dataValida(registro.verificado_em) && registro.verificado_em > hoje) {
        erros.push({ arquivo: nome, indice: i, caminho: ['verificado_em'], mensagem: `data no futuro: ${registro.verificado_em} (hoje é ${hoje})` });
      }
    });
  }

  const existe = (arquivo, indice, caminho, tabela, id) => {
    if (typeof id === 'string' && !ids[tabela].has(id)) {
      erros.push({ arquivo, indice, caminho, mensagem: `id ${JSON.stringify(id)} não existe em ${tabela}.json` });
    }
  };

  (dados.programas ?? []).forEach((p, i) => {
    if (typeof p.valor_milheiro_brl !== 'number') return;
    for (const campo of ['valor_milheiro_origem', 'valor_milheiro_fonte_url']) {
      if (p[campo] === undefined) {
        erros.push({ arquivo: 'programas', indice: i, caminho: [campo], mensagem: 'obrigatório quando valor_milheiro_brl é um número' });
      }
    }
    if (p.valor_milheiro_origem === 'estimativa_editavel') {
      avisos.push(`programa ${JSON.stringify(p.id)}: valor do milheiro é estimativa editável, não valor confirmado`);
    }
  });

  (dados.cambio ?? []).forEach((c) => {
    if (c.reais_por_dolar === A_CONFIRMAR) {
      avisos.push(`câmbio ${JSON.stringify(c.id)}: cotação está "A_CONFIRMAR"; cartões com pontos por dólar só contam se a pessoa informar a cotação`);
    }
  });

  (dados.cartoes ?? []).forEach((c, i) => existe('cartoes', i, ['programa_id'], 'programas', c.programa_id));

  (dados.ofertas ?? []).forEach((o, i) => {
    const e = (caminho, mensagem) => erros.push({ arquivo: 'ofertas', indice: i, caminho, mensagem });
    existe('ofertas', i, ['loja_id'], 'lojas', o.loja_id);
    existe('ofertas', i, ['programa_id'], 'programas', o.programa_id);
    (o.regras ?? []).forEach((r, j) => existe('ofertas', i, ['regras', j, 'condicao', 'cartao_id'], 'cartoes', r?.condicao?.cartao_id));

    if (dataValida(o.inicio) && dataValida(o.fim) && o.fim < o.inicio) {
      e(['fim'], `fim (${o.fim}) é anterior ao início (${o.inicio})`);
    }
    if (o.escopo === 'categorias_selecionadas' && !o.categorias_incluidas) {
      e(['categorias_incluidas'], 'obrigatório quando escopo é "categorias_selecionadas"');
    }
    if (o.exige_cupom === true && !o.cupom) {
      e(['cupom'], 'obrigatório quando exige_cupom é true');
    }

    const nome = `oferta ${JSON.stringify(o.id)}`;
    if (dataValida(o.fim) && o.fim < hoje) avisos.push(`${nome}: já terminou (fim ${o.fim}, hoje ${hoje})`);
    for (const campo of Object.keys(o)) {
      if (o[campo] === A_CONFIRMAR) avisos.push(`${nome}: ${campo} está "A_CONFIRMAR" e fica fora do cálculo`);
    }
  });

  regrasDeViagem(dados, hoje, erros, avisos, existe);

  return { erros, avisos };
}

/** Transferências, campanhas de bônus e regras de passagem/hotel (PR das viagens). */
function regrasDeViagem(dados, hoje, erros, avisos, existe) {
  const rotas = new Map((dados.transferencias ?? []).map((t) => [t.id, t]));

  (dados.transferencias ?? []).forEach((t, i) => {
    existe('transferencias', i, ['origem_id'], 'programas', t.origem_id);
    existe('transferencias', i, ['destino_id'], 'programas', t.destino_id);
    if (t.origem_id === t.destino_id) {
      erros.push({ arquivo: 'transferencias', indice: i, caminho: ['destino_id'], mensagem: 'origem e destino são o mesmo programa' });
    }
    if (t.paridade === A_CONFIRMAR) avisos.push(`transferência ${JSON.stringify(t.id)}: proporção "A_CONFIRMAR"; a rota aparece, mas fica fora da conta`);
  });

  (dados['bonus-transferencia'] ?? []).forEach((c, i) => {
    const e = (caminho, mensagem) => erros.push({ arquivo: 'bonus-transferencia', indice: i, caminho, mensagem });
    existe('bonus-transferencia', i, ['transferencia_id'], 'transferencias', c.transferencia_id);
    if (dataValida(c.inicio) && dataValida(c.fim) && c.fim < c.inicio) e(['fim'], `fim (${c.fim}) é anterior ao início (${c.inicio})`);
    const ids = (c.faixas ?? []).map((f) => f.id);
    if (new Set(ids).size !== ids.length) e(['faixas'], 'faixa com id repetido');
    if (rotas.get(c.transferencia_id)?.paridade === A_CONFIRMAR) {
      avisos.push(`campanha ${JSON.stringify(c.id)}: a rota está com proporção "A_CONFIRMAR", então o bônus não entra na conta`);
    }
    if (dataValida(c.fim) && c.fim < hoje) avisos.push(`campanha ${JSON.stringify(c.id)}: já terminou (fim ${c.fim}, hoje ${hoje})`);
  });

  const perguntas = new Map();
  (dados.viagens ?? []).forEach((r, i) => {
    const e = (caminho, mensagem) => erros.push({ arquivo: 'viagens', indice: i, caminho, mensagem });
    existe('viagens', i, ['programa_id'], 'programas', r.programa_id);
    if (dataValida(r.inicio) && dataValida(r.fim) && r.fim < r.inicio) e(['fim'], `fim (${r.fim}) é anterior ao início (${r.inicio})`);
    if (r.tipo === 'hotel' && r.trechos !== undefined && r.trechos !== 'todos') e(['trechos'], 'hotel usa trechos "todos"');
    const ids = (r.niveis ?? []).map((n) => n.id);
    if (new Set(ids).size !== ids.length) e(['niveis'], 'nível com id repetido');
    (r.niveis ?? []).forEach((n, j) => {
      if (typeof n.pontos === 'number' && Math.abs(Math.round(n.pontos * 10_000) - n.pontos * 10_000) > 1e-6) {
        e(['niveis', j, 'pontos'], `até 4 casas decimais (recebido: ${n.pontos})`);
      }
    });
    if (r.escolha) {
      const ja = perguntas.get(r.escolha.pergunta_id);
      if (ja && ja !== r.escolha.pergunta) e(['escolha', 'pergunta'], `a pergunta "${r.escolha.pergunta_id}" já tem outro texto: ${JSON.stringify(ja)}`);
      perguntas.set(r.escolha.pergunta_id, r.escolha.pergunta);
    }
    if (dataValida(r.fim) && r.fim < hoje) avisos.push(`regra de viagem ${JSON.stringify(r.id)}: já terminou (fim ${r.fim}, hoje ${hoje})`);
    if (r.status === A_CONFIRMAR) avisos.push(`regra de viagem ${JSON.stringify(r.id)}: status "A_CONFIRMAR", fica fora da conta`);
  });

  (dados.cotacoes ?? []).forEach((c) => {
    if (c.reais_por_unidade === A_CONFIRMAR) avisos.push(`cotação ${JSON.stringify(c.id)}: "A_CONFIRMAR"; a pessoa precisa informar na tela`);
  });
}

// ---------------------------------------------------------------------------
// Execução

function formatarCaminho(caminho) {
  return caminho.reduce((texto, parte) => (typeof parte === 'number' ? `${texto}[${parte}]` : texto ? `${texto}.${parte}` : parte), '');
}

function formatarErro({ arquivo, indice, id, caminho, mensagem }) {
  const partes = [`${arquivo}.json`];
  if (indice !== undefined) partes.push(`registro ${indice}${id ? ` (id "${id}")` : ''}`);
  if (caminho.length > 0) partes.push(`campo ${formatarCaminho(caminho)}`);
  return `${partes.join(' › ')}: ${mensagem}`;
}

/**
 * Lê e valida todos os arquivos de dados.
 * Devolve { erros: string[], avisos: string[] }. Erro reprova; aviso só informa.
 */
export async function validarDados(pasta = PASTA_DADOS, { hoje = hojeEmBrasilia() } = {}) {
  const brutos = [];
  const dados = {};

  for (const nome of ARQUIVOS) {
    let schema;
    let registros;
    try {
      schema = JSON.parse(await readFile(new URL(`schemas/${nome}.schema.json`, pasta), 'utf8'));
    } catch (falha) {
      brutos.push({ arquivo: `schemas/${nome}.schema`, caminho: [], mensagem: `não foi possível ler o schema (${falha.message})` });
      continue;
    }
    try {
      registros = JSON.parse(await readFile(new URL(`${nome}.json`, pasta), 'utf8'));
    } catch (falha) {
      brutos.push({ arquivo: nome, caminho: [], mensagem: `não foi possível ler o JSON (${falha.message})` });
      continue;
    }
    for (const { caminho, mensagem } of validarSchema(registros, schema)) {
      const [indice, ...resto] = caminho;
      brutos.push({ arquivo: nome, indice, id: registros[indice]?.id, caminho: resto, mensagem });
    }
    if (Array.isArray(registros)) dados[nome] = registros;
  }

  const extras = regrasExtras(dados, hoje);
  for (const e of extras.erros) brutos.push({ ...e, id: dados[e.arquivo]?.[e.indice]?.id });

  return { erros: brutos.map(formatarErro), avisos: extras.avisos };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { erros, avisos } = await validarDados();
  for (const aviso of avisos) console.log(`Aviso: ${aviso}`);
  if (erros.length > 0) {
    console.error(`Dados inválidos (${erros.length} problema(s)):`);
    for (const erro of erros) console.error(`- ${erro}`);
    process.exit(1);
  }
  const contagem = await Promise.all(
    ARQUIVOS.map(async (n) => `${JSON.parse(await readFile(new URL(`${n}.json`, PASTA_DADOS), 'utf8')).length} ${n}`),
  );
  console.log(`Dados válidos: ${contagem.join(', ')}.`);
}
