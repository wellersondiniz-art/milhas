// O que a Cloudflare Pages espera encontrar no repositório (ver README, "Publicar").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ler = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), 'utf8');

test('404.html existe: sem ela a Cloudflare devolve o index.html com status 200 para qualquer endereço', async () => {
  const pagina = await ler('site/404.html');
  assert.match(pagina, /<meta name="robots" content="noindex">/);
  assert.match(pagina, /<h1>/);
  assert.match(pagina, /href="\/"/, 'falta o caminho de volta para a calculadora');
});

test('404.html só usa endereços que começam com "/" (ela aparece em qualquer pasta)', async () => {
  const pagina = await ler('site/404.html');
  for (const [, endereco] of pagina.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    assert.match(endereco, /^(\/|#)/, `endereço relativo na 404: ${endereco}`);
  }
});

test('a versão do Node da Cloudflare (.node-version) é a mesma do CI', async () => {
  const versao = (await ler('.node-version')).trim();
  const ci = await ler('.github/workflows/testes.yml');
  assert.match(ci, new RegExp(`node-version: ${versao}\\b`));
});
