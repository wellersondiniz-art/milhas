import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { validarDados } from '../scripts/validar-dados.mjs';

const raiz = new URL('../', import.meta.url);

test('arquivos de dados são válidos', async () => {
  assert.deepEqual(await validarDados(), []);
});

test('validação aponta registro sem fonte_url e verificado_em', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const pasta = await mkdtemp(join(tmpdir(), 'dados-'));
  for (const nome of ['programas', 'cartoes', 'lojas']) {
    await writeFile(join(pasta, `${nome}.json`), '[]');
  }
  await writeFile(join(pasta, 'ofertas.json'), JSON.stringify([{ verificado_em: '22/11/2026' }]));
  const erros = await validarDados(pathToFileURL(pasta + '/'));
  assert.equal(erros.length, 2);
});

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
