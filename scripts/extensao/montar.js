#!/usr/bin/env node
// Monta a extensão de navegador em extensao/pacote/ (a pasta que se carrega
// no Chrome e que se compacta para a Chrome Web Store).
//
// Fonte única, sem cópia no Git: o motor (site/js/motor/) e o formato do
// perfil (site/js/perfil/formato.js) são copiados do site para o pacote a cada
// build, sem nenhuma alteração. extensao/pacote/ é gerada e fica fora do Git.
//
// Também gera:
//   - dados.js: lojas, cartões, programas, ofertas e câmbio (dados/*.json) e os
//     seletores de preço das lojas verificadas, dentro do pacote (nada é baixado
//     da internet depois de instalada);
//   - manifest.json: o modelo de extensao/fonte/ com a lista de sites onde a
//     extensão roda, tirada só das lojas verificadas em extensao/seletores.json.
//
// Uso: node scripts/extensao/montar.js [--conferir] [--dados pasta] [--seletores arquivo] [--saida pasta]
//   --conferir  inclui também as lojas com seletor A_CONFIRMAR (para conferir
//               numa página real; não publique esse pacote).

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { ARQUIVOS } from '../copiar-dados.js';

const RAIZ = new URL('../../', import.meta.url);
const A_CONFIRMAR = 'A_CONFIRMAR';
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
// Atributos que podem guardar um preço. Nada de value (campo) nem href.
const ATRIBUTOS = /^(content|aria-label|data-[a-z0-9-]+)$/;

/**
 * Confere o arquivo de seletores contra o cadastro de lojas.
 * @returns {{ erros: string[], ativos: object[] }} ativos = lojas que entram no pacote
 */
export function validarSeletores(arquivo, lojas, { conferir = false } = {}) {
  const erros = [];
  const ativos = [];
  if (!arquivo || arquivo.versao !== 1 || !Array.isArray(arquivo.lojas)) {
    return { erros: ['seletores.json: precisa de "versao": 1 e de uma lista "lojas"'], ativos };
  }
  const dominios = new Map(lojas.map((l) => [l.id, l.dominio]));
  const hostsVistos = new Set();
  arquivo.lojas.forEach((loja, i) => {
    const onde = `seletores.json, loja ${i + 1} (${loja?.loja_id ?? '?'})`;
    const antes = erros.length;
    const dominio = dominios.get(loja?.loja_id);
    if (!dominio) erros.push(`${onde}: loja_id não existe em lojas.json`);
    if (!Array.isArray(loja?.hosts) || loja.hosts.length === 0) {
      erros.push(`${onde}: "hosts" precisa ser uma lista com ao menos um site`);
    } else {
      for (const h of loja.hosts) {
        if (typeof h !== 'string' || !HOST.test(h)) erros.push(`${onde}: host inválido: ${JSON.stringify(h)}`);
        else if (dominio && h !== dominio && !h.endsWith(`.${dominio}`)) erros.push(`${onde}: ${h} não é do domínio da loja (${dominio})`);
        else if (hostsVistos.has(h)) erros.push(`${onde}: ${h} aparece em mais de uma loja`);
        hostsVistos.add(h);
      }
    }
    if (typeof loja?.caminho_produto !== 'string' || !loja.caminho_produto || loja.caminho_produto.length > 200) {
      erros.push(`${onde}: "caminho_produto" precisa ser uma expressão regular de até 200 caracteres`);
    } else {
      try { new RegExp(loja.caminho_produto); } catch { erros.push(`${onde}: "caminho_produto" não é uma expressão regular válida`); }
    }
    if (!Array.isArray(loja?.seletores_preco) || loja.seletores_preco.length === 0) {
      erros.push(`${onde}: "seletores_preco" precisa de ao menos um seletor`);
    } else {
      loja.seletores_preco.forEach((s, j) => {
        const q = `${onde}, seletor ${j + 1}`;
        if (typeof s?.css !== 'string' || !s.css.trim() || s.css.length > 200) erros.push(`${q}: "css" precisa ser um seletor de até 200 caracteres`);
        if (s?.formato !== 'texto' && s?.formato !== 'decimal') erros.push(`${q}: "formato" precisa ser "texto" ou "decimal"`);
        if (s?.atributo !== undefined && (typeof s.atributo !== 'string' || !ATRIBUTOS.test(s.atributo))) {
          erros.push(`${q}: "atributo" só pode ser content, aria-label ou data-*`);
        }
      });
    }
    if (loja?.status === 'verificado') {
      if (typeof loja.fonte_url !== 'string' || !loja.fonte_url.startsWith('https://')) erros.push(`${onde}: loja verificada precisa de fonte_url https://`);
      if (typeof loja.verificado_em !== 'string' || !DATA.test(loja.verificado_em)) erros.push(`${onde}: loja verificada precisa de verificado_em AAAA-MM-DD`);
    } else if (loja?.status !== A_CONFIRMAR) {
      erros.push(`${onde}: "status" precisa ser "verificado" ou "${A_CONFIRMAR}"`);
    }
    if (erros.length === antes && (loja.status === 'verificado' || conferir)) {
      ativos.push({
        loja_id: loja.loja_id,
        hosts: [...loja.hosts],
        caminho_produto: loja.caminho_produto,
        seletores_preco: loja.seletores_preco.map(({ css, formato, atributo }) => ({ css, formato, ...(atributo ? { atributo } : {}) })),
      });
    }
  });
  return { erros, ativos };
}

/** Manifesto final: o modelo com os sites das lojas ativas (e só eles). */
export function montarManifesto(modelo, ativos) {
  const manifesto = structuredClone(modelo);
  const sites = [...new Set(ativos.flatMap((l) => l.hosts))].sort().map((h) => `https://${h}/*`);
  if (sites.length) {
    manifesto.content_scripts = [{ matches: sites, js: ['conteudo.js'], run_at: 'document_idle', all_frames: false }];
  } else {
    delete manifesto.content_scripts;
  }
  return manifesto;
}

/** Texto do dados.js: só dados (JSON), em forma de módulo, para o service worker importar. */
export function textoDosDados(dados, ativos) {
  return [
    '// Gerado por scripts/extensao/montar.js a partir de dados/*.json e extensao/seletores.json. Não edite.',
    `export const DADOS = Object.freeze(${JSON.stringify(dados)});`,
    `export const SELETORES = Object.freeze(${JSON.stringify(ativos)});`,
    '',
  ].join('\n');
}

async function lerJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

/**
 * @param {object} opcoes { dados: URL da pasta, seletores: URL do arquivo, saida: URL da pasta, conferir }
 * @returns {Promise<{ ativos: object[], manifesto: object }>}
 */
export async function montarExtensao({
  dados = new URL('dados/', RAIZ),
  seletores = new URL('extensao/seletores.json', RAIZ),
  saida = new URL('extensao/pacote/', RAIZ),
  conferir = false,
} = {}) {
  const cadastro = {};
  for (const nome of ARQUIVOS) cadastro[nome.replace('.json', '')] = await lerJson(new URL(nome, dados));
  const { erros, ativos } = validarSeletores(await lerJson(seletores), cadastro.lojas, { conferir });
  if (erros.length) throw new Error(`extensão: seletores com problema:\n- ${erros.join('\n- ')}`);

  const fonte = new URL('extensao/fonte/', RAIZ);
  await rm(saida, { recursive: true, force: true });
  await mkdir(saida, { recursive: true });
  for (const item of await readdir(fonte)) {
    if (item !== 'manifest.json') await cp(new URL(item, fonte), new URL(item, saida), { recursive: true });
  }
  // Módulos do site, copiados sem mudar uma vírgula.
  // A pasta do motor inteira: arquivo novo no motor entra sozinho no pacote.
  await cp(new URL('site/js/motor/', RAIZ), new URL('motor/', saida), { recursive: true });
  await mkdir(new URL('perfil/', saida), { recursive: true });
  await cp(new URL('site/js/perfil/formato.js', RAIZ), new URL('perfil/formato.js', saida));

  await writeFile(new URL('dados.js', saida), textoDosDados(cadastro, ativos));
  const manifesto = montarManifesto(await lerJson(new URL('manifest.json', fonte)), ativos);
  await writeFile(new URL('manifest.json', saida), `${JSON.stringify(manifesto, null, 2)}\n`);
  return { ativos, manifesto };
}

export function lerArgumentos(argv) {
  const opcoes = { conferir: false };
  const pasta = (p) => pathToFileURL(path.resolve(p) + path.sep);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--conferir') opcoes.conferir = true;
    else if (a === '--dados') opcoes.dados = pasta(argv[++i]);
    else if (a === '--saida') opcoes.saida = pasta(argv[++i]);
    else if (a === '--seletores') opcoes.seletores = pathToFileURL(path.resolve(argv[++i]));
    else throw new Error(`opção desconhecida: ${a}`);
  }
  return opcoes;
}

/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opcoes = lerArgumentos(process.argv.slice(2));
    const { ativos } = await montarExtensao(opcoes);
    const destino = fileURLToPath(opcoes.saida ?? new URL('extensao/pacote/', RAIZ));
    console.log(`Extensão montada em ${path.relative(process.cwd(), destino) || destino}.`);
    if (ativos.length) console.log(`Lojas ativas: ${ativos.map((l) => l.loja_id).join(', ')}.`);
    else console.log('Atenção: nenhuma loja verificada em extensao/seletores.json; a extensão não vai rodar em site nenhum.');
    if (opcoes.conferir) console.log('Pacote de CONFERÊNCIA (inclui seletores A_CONFIRMAR): não publique este pacote.');
  } catch (erro) {
    console.error(erro.message);
    process.exitCode = 1;
  }
}
/* node:coverage enable */
