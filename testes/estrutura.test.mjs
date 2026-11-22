import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const raiz = new URL('../', import.meta.url);

test('site tem index.html e _headers com CSP', async () => {
  await access(new URL('site/index.html', raiz));
  const headers = await readFile(new URL('site/_headers', raiz), 'utf8');
  assert.match(headers, /Content-Security-Policy:/);
});

test('package.json não tem dependências de runtime; ferramenta de teste só a aprovada, com versão exata', async () => {
  const pacote = JSON.parse(await readFile(new URL('package.json', raiz), 'utf8'));
  assert.equal(pacote.dependencies, undefined);
  assert.equal(pacote.optionalDependencies, undefined);
  assert.equal(pacote.peerDependencies, undefined);
  // Playwright é só para testar no navegador; nada dele vai para o site.
  assert.deepEqual(Object.keys(pacote.devDependencies ?? {}), ['@playwright/test']);
  for (const versao of Object.values(pacote.devDependencies)) assert.match(versao, /^\d+\.\d+\.\d+$/);
});

test('o site não importa nada de node_modules', async () => {
  const { readdir } = await import('node:fs/promises');
  const site = new URL('site/', raiz);
  for (const item of await readdir(site, { recursive: true })) {
    if (!/\.(js|html)$/.test(item)) continue;
    const codigo = await readFile(new URL(item, site), 'utf8');
    assert.doesNotMatch(codigo, /node_modules|@playwright|from ['"](?![./])/, item);
  }
});
