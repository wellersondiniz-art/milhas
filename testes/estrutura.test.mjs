import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const raiz = new URL('../', import.meta.url);

test('site tem index.html e _headers com CSP', async () => {
  await access(new URL('site/index.html', raiz));
  const headers = await readFile(new URL('site/_headers', raiz), 'utf8');
  assert.match(headers, /Content-Security-Policy:/);
});

test('package.json não tem dependências', async () => {
  const pacote = JSON.parse(await readFile(new URL('package.json', raiz), 'utf8'));
  assert.equal(pacote.dependencies, undefined);
  assert.equal(pacote.devDependencies, undefined);
});
