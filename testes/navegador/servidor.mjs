#!/usr/bin/env node
// Servidor estático só para os testes no navegador (não vai para o site).
//
// Serve a pasta do site (padrão: site/; com PASTA_DO_SITE=dist serve o build
// minificado) e aplica os cabeçalhos de site/_headers, como a Cloudflare
// Pages faz. Assim os testes pegam erro de CSP. Fora do HTTPS, tira só o que
// obriga HTTPS (HSTS e upgrade-insecure-requests).
//
// Uso: node testes/navegador/servidor.mjs   (porta: PORTA, padrão 4173)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PASTA = resolve(RAIZ, process.env.PASTA_DO_SITE || 'site');
const PORTA = Number(process.env.PORTA || 4173);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** Lê _headers: [{ caminho: '/*' | '/sw.js', cabecalhos: [[nome, valor]] }]. */
export function lerHeaders(texto) {
  const regras = [];
  let atual = null;
  for (const linha of texto.split('\n')) {
    if (!linha.trim() || linha.trim().startsWith('#')) continue;
    if (!/^\s/.test(linha)) {
      atual = { caminho: linha.trim(), cabecalhos: [] };
      regras.push(atual);
    } else if (atual) {
      const i = linha.indexOf(':');
      atual.cabecalhos.push([linha.slice(0, i).trim(), linha.slice(i + 1).trim()]);
    }
  }
  return regras;
}

function casa(padrao, caminho) {
  if (padrao.endsWith('*')) return caminho.startsWith(padrao.slice(0, -1));
  return padrao === caminho;
}

/** Ajusta para HTTP local: sem HSTS e sem upgrade-insecure-requests. */
function paraHttpLocal(nome, valor) {
  if (/^strict-transport-security$/i.test(nome)) return null;
  if (/^content-security-policy$/i.test(nome)) return valor.replace(/;\s*upgrade-insecure-requests/i, '');
  return valor;
}

let regras = [];
try { regras = lerHeaders(await readFile(join(PASTA, '_headers'), 'utf8')); } catch { /* sem _headers */ }

async function arquivoDe(caminhoUrl) {
  const limpo = normalize(decodeURIComponent(caminhoUrl)).replace(/^(\.\.[/\\])+/, '');
  let alvo = join(PASTA, limpo);
  if (!alvo.startsWith(PASTA)) return null;
  try {
    if ((await stat(alvo)).isDirectory()) alvo = join(alvo, 'index.html');
    return { alvo, corpo: await readFile(alvo) };
  } catch {
    return null;
  }
}

const servidor = createServer(async (pedido, resposta) => {
  const url = new URL(pedido.url, 'http://localhost');
  const achado = await arquivoDe(url.pathname);
  for (const regra of regras) {
    if (!casa(regra.caminho, url.pathname)) continue;
    for (const [nome, valor] of regra.cabecalhos) {
      const v = paraHttpLocal(nome, valor);
      if (v !== null) resposta.setHeader(nome, v);
    }
  }
  if (!achado) {
    resposta.statusCode = 404;
    resposta.setHeader('Content-Type', 'text/plain; charset=utf-8');
    resposta.end('não encontrado');
    return;
  }
  if (!resposta.hasHeader('Content-Type')) {
    resposta.setHeader('Content-Type', TIPOS[extname(achado.alvo)] ?? 'application/octet-stream');
  }
  resposta.end(pedido.method === 'HEAD' ? undefined : achado.corpo);
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`Servindo ${PASTA} em http://127.0.0.1:${PORTA}`);
});
