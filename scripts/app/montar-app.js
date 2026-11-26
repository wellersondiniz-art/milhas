#!/usr/bin/env node
// Monta app/www/, a pasta que o Capacitor coloca dentro do app Android e iOS.
//
// Parte de dist/ (o mesmo site publicado na Cloudflare, já minificado) e:
//   1. tira o que só faz sentido num servidor: sw.js (no app não há service
//      worker; versão nova chega pela loja), _headers, _redirects, _routes.json,
//      robots.txt, sitemap.xml e 404.html;
//   2. põe a política de segurança (CSP) dentro de cada página, numa <meta>,
//      porque no app não existe servidor para mandar o cabeçalho de _headers.
//      É a mesma CSP do site, com uma diferença: o app pode buscar os dados
//      atualizados no endereço do site (js/nativo/config.js).
//
// Uso: npm run app:montar   (faz o build do site, esta montagem e o cap sync)

import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ENDERECO_DO_SITE } from '../../site/js/nativo/config.js';

const RAIZ = new URL('../../', import.meta.url);
const DIST = new URL('dist/', RAIZ);
const WWW = new URL('app/www/', RAIZ);

/** Arquivos de dist/ que não entram no app. */
export const FORA_DO_APP = ['sw.js', '_headers', '_redirects', '_routes.json', 'robots.txt', 'sitemap.xml', '404.html'];

/** A CSP de dist/_headers (bloco "/*"). */
export function cspDoSite(headers) {
  const linha = headers.split('\n').find((l) => /^\s+Content-Security-Policy:/.test(l));
  if (!linha) throw new Error('dist/_headers sem Content-Security-Policy');
  return linha.replace(/^\s+Content-Security-Policy:\s*/, '').trim();
}

/**
 * CSP para a <meta> do app. Diretivas que não valem em <meta> (frame-ancestors)
 * ou que não servem no app (worker-src, manifest-src) saem; connect-src ganha
 * o endereço do site, de onde vêm os dados atualizados.
 */
export function cspDoApp(cspSite, endereco) {
  const origem = new URL(endereco);
  if (origem.protocol !== 'https:' || origem.pathname !== '/' || origem.search || origem.hash) {
    throw new Error(`endereço do site inválido para o app: ${endereco}`);
  }
  const diretivas = cspSite.split(';').map((d) => d.trim()).filter(Boolean)
    .filter((d) => !/^(frame-ancestors|worker-src|manifest-src)\b/.test(d))
    .map((d) => (/^connect-src\b/.test(d) ? `connect-src 'self' ${origem.origin}` : d));
  if (!diretivas.some((d) => d.startsWith('connect-src '))) diretivas.push(`connect-src 'self' ${origem.origin}`);
  return diretivas.join('; ');
}

/** Põe a <meta> da CSP logo depois do <meta charset>, antes de qualquer script ou estilo. */
export function colocarCsp(html, csp) {
  if (/http-equiv="Content-Security-Policy"/i.test(html)) throw new Error('a página já tem CSP em <meta>');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">`;
  const charset = html.match(/<meta charset="utf-8">/i);
  if (!charset) throw new Error('página sem <meta charset="utf-8">');
  const fim = charset.index + charset[0].length;
  return `${html.slice(0, fim)}\n${meta}${html.slice(fim)}`;
}

async function listar(pasta) {
  const itens = await readdir(pasta, { withFileTypes: true, recursive: true });
  const base = fileURLToPath(pasta);
  return itens.filter((i) => i.isFile())
    .map((i) => `${i.parentPath ?? i.path}/${i.name}`.slice(base.length).replace(/^\/+/, ''));
}

/** destino e origem: pastas (URL com / no fim); os testes usam pastas temporárias. */
export async function montarApp(destino = WWW, origem = DIST) {
  const csp = cspDoApp(cspDoSite(await readFile(new URL('_headers', origem), 'utf8')), ENDERECO_DO_SITE);
  await rm(destino, { recursive: true, force: true });
  await cp(origem, destino, { recursive: true });
  for (const arquivo of FORA_DO_APP) await rm(new URL(arquivo, destino), { force: true });
  let paginas = 0;
  for (const caminho of await listar(destino)) {
    if (!caminho.endsWith('.html')) continue;
    const alvo = new URL(caminho, destino);
    await writeFile(alvo, colocarCsp(await readFile(alvo, 'utf8'), csp));
    paginas++;
  }
  return paginas;
}

async function principal() {
  const paginas = await montarApp();
  console.log(`app/www/ montada: ${paginas} páginas com CSP, dados de ${ENDERECO_DO_SITE}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch((erro) => { console.error(erro); process.exit(1); });
}
