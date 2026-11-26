#!/usr/bin/env node
// Busca nas APIs oficiais o nome e o preço dos produtos escolhidos em
// dados/produtos.json e grava a "vitrine" em .cache/produtos/vitrine.json,
// que o gerador de páginas usa (npm run build já chama este script).
//
// - Desligado (ligado: false) ou sem credencial: nenhuma API é chamada e a
//   vitrine sai vazia. O site fica igual a antes.
// - Credenciais só por variável de ambiente (na Cloudflare Pages: Settings >
//   Environment variables, como segredo). Nunca no repositório.
// - Cache: cada loja guarda a última resposta em .cache/produtos/<loja>.json.
//   Até 1 hora depois, a API não é chamada de novo. Se a API falhar, os
//   preços guardados que ainda valem (até validade_horas, no máximo 24) continuam.
// - Nada de dado pessoal: as chamadas levam só os códigos dos produtos.
//
// Uso: node scripts/produtos/atualizar.js [--saida arquivo.json]

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { hojeEmBrasilia, validarSchema } from '../validar-dados.js';
import { ADAPTADORES } from './adaptadores/index.js';
import { faltando } from './adaptadores/comum.js';
import { A_CONFIRMAR, aindaVale, conferirConfig, normalizarProduto } from './normalizar.js';

const RAIZ = new URL('../../', import.meta.url);
export const PASTA_CACHE = new URL('.cache/produtos/', RAIZ);
export const ARQUIVO_VITRINE = new URL('vitrine.json', PASTA_CACHE);
/** Até quantas horas depois da consulta o build reaproveita o cache sem chamar a API. */
export const CACHE_HORAS = 1;

/** Vitrine sem nada (desligada, sem credencial ou sem itens). */
export function vitrineVazia(agora) {
  return { gerada_em: agora, demo: false, produtos: [] };
}

/** Cache em arquivos JSON, um por loja. */
export function cacheEmPasta(pasta) {
  const arquivo = (lojaId) => new URL(`${lojaId}.json`, pasta);
  return {
    async ler(lojaId) {
      try { return JSON.parse(await readFile(arquivo(lojaId), 'utf8')); } catch { return null; }
    },
    async gravar(lojaId, conteudo) {
      await mkdir(pasta, { recursive: true });
      await writeFile(arquivo(lojaId), `${JSON.stringify(conteudo, null, 2)}\n`, 'utf8');
    },
  };
}

/** Muda quando os itens escolhidos (ou a validade) mudam: aí o cache não serve. */
export function chaveDoCache(lojaConfig) {
  const base = JSON.stringify({ api: lojaConfig.api, validade: lojaConfig.validade_horas, feed: lojaConfig.awin_feed_id ?? null, itens: lojaConfig.itens });
  return createHash('sha256').update(base).digest('hex').slice(0, 16);
}

function cacheNovo(guardado, chave, agora) {
  if (!guardado || guardado.chave !== chave) return false;
  const idade = Date.parse(agora) - Date.parse(guardado.consultado_em);
  return idade >= 0 && idade < CACHE_HORAS * 3_600_000;
}

/** Por que uma loja não pode ser consultada agora (ou null se pode). */
function motivoParaPular(lojaConfig, adaptador, env) {
  if (!lojaConfig.itens.length) return 'nenhum produto escolhido';
  if (lojaConfig.api === 'awin' && [lojaConfig.awin_anunciante_id, lojaConfig.awin_feed_id].includes(A_CONFIRMAR)) {
    return 'awin_anunciante_id ou awin_feed_id ainda A_CONFIRMAR';
  }
  const faltam = faltando(env, adaptador.variaveis);
  return faltam.length ? `faltam as variáveis ${faltam.join(', ')}` : null;
}

async function consultarLoja({ lojaConfig, loja, adaptador, env, buscar, agora, cache, avisos }) {
  const chave = chaveDoCache(lojaConfig);
  const guardado = await cache.ler(loja.id);
  if (cacheNovo(guardado, chave, agora)) return guardado.produtos.filter((p) => aindaVale(p, agora));

  let brutos;
  try {
    brutos = await adaptador.buscar({ config: lojaConfig, itens: lojaConfig.itens, env, buscar, agora });
  } catch (falha) {
    const ainda = guardado?.chave === chave ? guardado.produtos.filter((p) => aindaVale(p, agora)) : [];
    avisos.push(`${loja.nome}: ${falha.message}. ${ainda.length ? `Ficam os ${ainda.length} preço(s) guardados que ainda valem.` : 'Nenhum produto desta loja aparece.'}`);
    return ainda;
  }
  const produtos = [];
  for (const item of lojaConfig.itens) {
    const r = normalizarProduto(brutos.get(item.id_na_loja), {
      loja, item, api: lojaConfig.api, consultadoEm: agora, validadeHoras: lojaConfig.validade_horas,
    });
    if (r.erro) avisos.push(`Fora da vitrine: ${r.erro}`);
    else produtos.push(r);
  }
  await cache.gravar(loja.id, { chave, consultado_em: agora, produtos });
  return produtos;
}

/**
 * Monta a vitrine. Recebe tudo de fora (config, dados, ambiente, fetch,
 * relógio e cache), para dar para testar sem rede.
 */
export async function atualizarVitrine({ config, dados, env, buscar, agora, cache, adaptadores = ADAPTADORES }) {
  const avisos = [];
  if (!config.ligado) return { vitrine: vitrineVazia(agora), avisos: ['Vitrine desligada (dados/produtos.json › ligado: false). Nenhuma API foi chamada.'] };
  const produtos = [];
  for (const lojaConfig of config.lojas) {
    const loja = dados.lojas.find((l) => l.id === lojaConfig.loja_id);
    const adaptador = adaptadores[lojaConfig.api];
    const motivo = motivoParaPular(lojaConfig, adaptador, env);
    if (motivo) {
      avisos.push(`${loja.nome}: ${motivo}. Nenhuma chamada feita.`);
      continue;
    }
    produtos.push(...await consultarLoja({ lojaConfig, loja, adaptador, env, buscar, agora, cache, avisos }));
  }
  return { vitrine: { gerada_em: agora, demo: false, produtos }, avisos };
}

/** Lê e confere dados/produtos.json. Lança erro com a lista de problemas. */
export async function lerConfig(raiz, dados, hoje) {
  const config = JSON.parse(await readFile(new URL('dados/produtos.json', raiz), 'utf8'));
  const schema = JSON.parse(await readFile(new URL('dados/schemas/produtos.schema.json', raiz), 'utf8'));
  const erros = [
    ...validarSchema(config, schema).map(({ caminho, mensagem }) => `produtos.json › ${caminho.join('.') || '(raiz)'}: ${mensagem}`),
  ];
  if (!erros.length) erros.push(...conferirConfig(config, dados, { hoje }));
  if (erros.length) throw new Error(`dados/produtos.json tem problema(s):\n- ${erros.join('\n- ')}`);
  return config;
}

/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { saida: { type: 'string' } } });
  const agora = new Date().toISOString();
  try {
    const lojas = JSON.parse(await readFile(new URL('dados/lojas.json', RAIZ), 'utf8'));
    const config = await lerConfig(RAIZ, { lojas }, hojeEmBrasilia());
    const { vitrine, avisos } = await atualizarVitrine({
      config, dados: { lojas }, env: process.env, buscar: fetch, agora, cache: cacheEmPasta(PASTA_CACHE),
    });
    const saida = values.saida ? new URL(values.saida, `file://${process.cwd()}/`) : ARQUIVO_VITRINE;
    await mkdir(new URL('./', saida), { recursive: true });
    await writeFile(saida, `${JSON.stringify(vitrine, null, 2)}\n`, 'utf8');
    for (const aviso of avisos) console.log(`Aviso: ${aviso}`);
    console.log(`Vitrine: ${vitrine.produtos.length} produto(s) em ${fileURLToPath(saida)}.`);
  } catch (erro) {
    console.error(erro.message);
    process.exit(1);
  }
}
/* node:coverage enable */
