#!/usr/bin/env node
// Etapa 1 do fluxo semanal: lê as páginas cadastradas em dados/fontes.json e
// salva o texto bruto de cada uma em coleta/AAAA-MM-DD/<id>.txt.
// coleta/ fica fora do Git (.gitignore). Nada aqui chama modelo nem mexe em dados/.
//
// Uso: node scripts/coletar.js [--data AAAA-MM-DD]
// Saída: coleta/AAAA-MM-DD/<id>.txt e coleta/AAAA-MM-DD/coleta.json (resumo).

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hojeEmBrasilia, dataValida } from './validar-dados.js';
import { validarFontes } from './atualizacao/fontes.js';
import { htmlParaTexto } from './atualizacao/texto.js';

const RAIZ = new URL('../', import.meta.url);
const LIMITE_BYTES = 5 * 1024 * 1024;
const TEMPO_LIMITE_MS = 30_000;
const PAUSA_ENTRE_PAGINAS_MS = 2_000;
// Identificação genérica, sem dado pessoal.
const AGENTE = 'comprador-de-milhas-coleta/0.1';

export async function lerJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

/** Lê e valida dados/fontes.json. Lança erro com a lista de problemas. */
export async function carregarFontes(raiz = RAIZ) {
  const dados = {
    programas: await lerJson(new URL('dados/programas.json', raiz)),
    lojas: await lerJson(new URL('dados/lojas.json', raiz)),
  };
  const fontes = await lerJson(new URL('dados/fontes.json', raiz));
  const schema = await lerJson(new URL('dados/schemas/fontes.schema.json', raiz));
  const erros = validarFontes(fontes, schema, dados);
  if (erros.length > 0) throw new Error(`dados/fontes.json tem problema(s):\n- ${erros.join('\n- ')}`);
  return fontes;
}

/** Busca uma página e devolve { texto } ou { erro }. Não lança. */
export async function buscarPagina(url, buscar = fetch) {
  try {
    const resposta = await buscar(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: { 'user-agent': AGENTE, accept: 'text/html,text/plain;q=0.9', 'accept-language': 'pt-BR,pt;q=0.9' },
    });
    if (!resposta.ok) return { erro: `a página respondeu ${resposta.status}` };
    const tipo = resposta.headers.get('content-type') ?? '';
    if (!/text\/(html|plain)/i.test(tipo)) return { erro: `tipo de conteúdo não suportado (${tipo || 'sem tipo'})` };
    const corpo = await resposta.text();
    if (Buffer.byteLength(corpo) > LIMITE_BYTES) return { erro: 'página maior que 5 MB' };
    const texto = /html/i.test(tipo) ? htmlParaTexto(corpo) : corpo.trim();
    if (texto.length === 0) return { erro: 'página sem texto (talvez só funcione com JavaScript)' };
    return { texto };
  } catch (falha) {
    return { erro: `não foi possível ler (${falha.name === 'TimeoutError' ? 'tempo esgotado' : falha.message})` };
  }
}

/**
 * Coleta todas as fontes e grava em `pasta` (URL de diretório).
 * Devolve o resumo gravado em coleta.json.
 */
export async function coletar({ fontes, pasta, data, buscar = fetch, pausaMs = PAUSA_ENTRE_PAGINAS_MS }) {
  await mkdir(pasta, { recursive: true });
  const resumo = { data, fontes: [] };
  for (const [i, fonte] of fontes.entries()) {
    if (i > 0 && pausaMs > 0) await new Promise((r) => setTimeout(r, pausaMs));
    const { texto, erro } = await buscarPagina(fonte.url, buscar);
    const item = { id: fonte.id, url: fonte.url, programa_id: fonte.programa_id, loja_id: fonte.loja_id };
    if (erro) {
      item.erro = erro;
    } else {
      await writeFile(new URL(`${fonte.id}.txt`, pasta), `${texto}\n`);
      item.arquivo = `${fonte.id}.txt`;
      item.caracteres = texto.length;
      item.sha256 = createHash('sha256').update(texto).digest('hex');
    }
    resumo.fontes.push(item);
  }
  await writeFile(new URL('coleta.json', pasta), `${JSON.stringify(resumo, null, 2)}\n`);
  return resumo;
}

/** Lê --data AAAA-MM-DD dos argumentos (padrão: hoje em Brasília). */
export function lerData(argv) {
  const i = argv.indexOf('--data');
  const data = i >= 0 ? argv[i + 1] : hojeEmBrasilia();
  if (!dataValida(data)) throw new Error(`data inválida: ${data} (use AAAA-MM-DD)`);
  return data;
}

// Linha de comando (fina: a lógica acima é que tem teste).
/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const data = lerData(process.argv);
    const fontes = await carregarFontes();
    if (fontes.length === 0) {
      console.log('dados/fontes.json está vazio. Cadastre as páginas oficiais antes de coletar (veja "Atualização semanal das ofertas" no README.md).');
      process.exit(0);
    }
    const pasta = new URL(`coleta/${data}/`, RAIZ);
    const resumo = await coletar({ fontes, pasta, data });
    for (const f of resumo.fontes) console.log(f.erro ? `- ${f.id}: FALHOU, ${f.erro}` : `- ${f.id}: ${f.caracteres} caracteres`);
    const ok = resumo.fontes.filter((f) => !f.erro).length;
    console.log(`\n${ok} de ${resumo.fontes.length} página(s) salvas em coleta/${data}/. Próximo passo: node scripts/extrair.js --data ${data}`);
  } catch (falha) {
    console.error(falha.message);
    process.exit(1);
  }
}
/* node:coverage enable */
