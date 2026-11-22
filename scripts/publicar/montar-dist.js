#!/usr/bin/env node
// Monta dist/, a pasta publicada na Cloudflare Pages, a partir de site/.
//
// site/ continua sendo o código de verdade (legível, com comentários).
// dist/ é gerada, fica fora do Git e é feita para celular simples com rede lenta:
//   1. JS e HTML minificados (scripts/publicar/minificar.js, sem dependência).
//   2. CSS minificado e embutido no <head> de cada página (<style>), para a
//      página não esperar um arquivo .css para aparecer. A CSP em _headers
//      ganha o resumo SHA-256 de cada <style>, então só esse CSS roda.
//   3. <link rel="modulepreload"> para todos os módulos que a página importa:
//      o navegador baixa tudo de uma vez, em vez de descobrir um import por vez.
//   4. sw.js gerado de novo, com a lista e a versão dos arquivos minificados.
//
// Uso: node scripts/publicar/montar-dist.js   (último passo de npm run build)

import { createHash } from 'node:crypto';
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarSw } from '../gerar-sw.js';
import { minificarCss, minificarHtml, minificarJs } from './minificar.js';

const RAIZ = new URL('../../', import.meta.url);

async function listar(pasta) {
  const itens = await readdir(pasta, { withFileTypes: true, recursive: true });
  const base = fileURLToPath(pasta);
  return itens
    .filter((i) => i.isFile())
    .map((i) => `${i.parentPath ?? i.path}/${i.name}`.slice(base.length).replace(/^\/+/, ''));
}

/** Caminho de um href relativo à raiz do site ("/css/a.css" ou "../css/a.css" vista de "loja/x/index.html"). */
export function resolverHref(paginaRel, href) {
  if (/^[a-z]+:|^\/\//i.test(href)) throw new Error(`endereço de fora em ${paginaRel}: ${href}`);
  const caminho = href.startsWith('/') ? href.slice(1) : posix.join(posix.dirname(paginaRel), href);
  return posix.normalize(caminho).split(/[?#]/)[0];
}

/** Imports estáticos de um módulo (from '...' e import '...'). */
export function importsDe(codigo) {
  const achados = new Set();
  for (const m of codigo.matchAll(/(?:\bfrom\s*|\bimport\s*)(['"])([^'"]+)\1/g)) achados.add(m[2]);
  return [...achados];
}

/** Todos os módulos que um módulo puxa, direta ou indiretamente (sem ele mesmo), em ordem estável. */
export async function grafoDeModulos(pasta, entrada) {
  const vistos = new Set([entrada]);
  const fila = [entrada];
  while (fila.length) {
    const atual = fila.shift();
    const codigo = await readFile(new URL(atual, pasta), 'utf8');
    for (const alvo of importsDe(codigo)) {
      if (!alvo.startsWith('.')) throw new Error(`import fora do site em ${atual}: ${alvo}`);
      const caminho = posix.normalize(posix.join(posix.dirname(atual), alvo));
      if (!vistos.has(caminho)) { vistos.add(caminho); fila.push(caminho); }
    }
  }
  vistos.delete(entrada);
  return [...vistos].sort();
}

/** Resumo para a CSP: 'sha256-...' do texto exato do <style>. */
export function resumoCsp(texto) {
  return `'sha256-${createHash('sha256').update(texto, 'utf8').digest('base64')}'`;
}

/** Coloca os resumos dos <style> em style-src da CSP. */
export function cspComEstilos(headers, resumos) {
  if (!/style-src 'self'/.test(headers)) throw new Error("_headers precisa ter style-src 'self'");
  const extra = [...new Set(resumos)].sort().join(' ');
  return extra ? headers.replace(/style-src 'self'/, `style-src 'self' ${extra}`) : headers;
}

const LINK_CSS = /<link rel="stylesheet" href="([^"]+)">\n?/g;
const SCRIPT_MODULO = /<script type="module" src="([^"]+)"><\/script>/g;

/**
 * Regra para imagem de conteúdo: <img> sempre com width e height (a página
 * não pula quando a imagem chega) e em AVIF, WebP ou SVG (mais leves que
 * PNG/JPG). Ícones do app (manifest, apple-touch-icon) ficam em PNG, que é o
 * que os sistemas pedem, e não usam <img>.
 */
export function conferirImagens(paginaRel, html) {
  const problemas = [];
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) problemas.push(`${paginaRel}: <img> sem width e height: ${tag}`);
    const src = /\ssrc="([^"]+)"/.exec(tag)?.[1] ?? '';
    if (!/\.(avif|webp|svg)$/i.test(src)) problemas.push(`${paginaRel}: <img> fora de AVIF/WebP/SVG: ${tag}`);
  }
  for (const [, srcset] of html.matchAll(/<source\b[^>]*\ssrcset="([^"]+)"/gi)) {
    if (!/\.(avif|webp)(\s|$)/i.test(srcset)) problemas.push(`${paginaRel}: <source> fora de AVIF/WebP: ${srcset}`);
  }
  return problemas;
}

/** Uma página: CSS embutido, modulepreload, HTML minificado. Devolve { html, resumos }. */
export async function prepararPagina(pasta, paginaRel, html) {
  const problemas = conferirImagens(paginaRel, html);
  if (problemas.length) throw new Error(problemas.join('\n'));
  const resumos = [];
  const folhas = [...html.matchAll(LINK_CSS)].map((m) => resolverHref(paginaRel, m[1]));
  if (folhas.length) {
    const partes = await Promise.all(folhas.map((f) => readFile(new URL(f, pasta), 'utf8')));
    const css = minificarCss(partes.join('\n'));
    resumos.push(resumoCsp(css));
    let primeira = true;
    html = html.replace(LINK_CSS, () => {
      if (!primeira) return '';
      primeira = false;
      return `<style>${css}</style>\n`;
    });
  }
  for (const m of [...html.matchAll(SCRIPT_MODULO)]) {
    const entrada = resolverHref(paginaRel, m[1]);
    const dir = posix.dirname(m[1]);
    const modulos = await grafoDeModulos(pasta, entrada);
    const entradaDir = posix.dirname(entrada);
    const links = modulos.map((mod) => `<link rel="modulepreload" href="${posix.join(dir, posix.relative(entradaDir, mod))}">`);
    html = html.replace(m[0], [...links, m[0]].join('\n'));
  }
  return { html: minificarHtml(html), resumos };
}

export async function montarDist(origem = new URL('site/', RAIZ), destino = new URL('dist/', RAIZ)) {
  await rm(destino, { recursive: true, force: true });
  await cp(origem, destino, { recursive: true, filter: (f) => !f.endsWith('/sw.js') && !f.endsWith('.gitkeep') });
  const arquivos = await listar(destino);

  // Primeiro o JS, porque o grafo de módulos é lido dos arquivos já minificados.
  for (const a of arquivos.filter((f) => f.endsWith('.js'))) {
    const url = new URL(a, destino);
    await writeFile(url, minificarJs(await readFile(url, 'utf8')), 'utf8');
  }
  const resumos = [];
  for (const a of arquivos.filter((f) => f.endsWith('.html'))) {
    const url = new URL(a, destino);
    const pagina = await prepararPagina(destino, a, await readFile(url, 'utf8'));
    resumos.push(...pagina.resumos);
    await writeFile(url, pagina.html, 'utf8');
  }
  // O CSS já está dentro das páginas: os arquivos .css não vão para o ar.
  await rm(new URL('css/', destino), { recursive: true, force: true });

  const urlHeaders = new URL('_headers', destino);
  await writeFile(urlHeaders, cspComEstilos(await readFile(urlHeaders, 'utf8'), resumos), 'utf8');

  const sw = await gerarSw(destino, { cssEmbutido: true });
  await writeFile(new URL('sw.js', destino), minificarJs(await readFile(new URL('sw.js', destino), 'utf8')), 'utf8');
  return { arquivos: arquivos.length, estilos: new Set(resumos).size, versao: sw.versao };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await montarDist();
  console.log(`dist/ montada: ${r.arquivos} arquivos, ${r.estilos} blocos de CSS embutidos, sw.js versão ${r.versao}.`);
}
