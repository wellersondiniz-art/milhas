// Os dados falsos usados nos testes no navegador (testes/navegador/dados-de-teste/)
// seguem os mesmos schemas dos dados reais. Assim, se o schema mudar, o teste
// avisa que os dados de teste ficaram para trás.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validarDados } from '../scripts/validar-dados.js';

const raiz = new URL('../', import.meta.url);

test('dados de teste do navegador passam no validador', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'dados-de-teste-'));
  try {
    await cp(new URL('testes/navegador/dados-de-teste/', raiz), pasta, { recursive: true });
    await cp(new URL('dados/schemas/', raiz), join(pasta, 'schemas'), { recursive: true });
    const { erros } = await validarDados(pathToFileURL(`${pasta}/`), { hoje: '2026-11-10' });
    assert.deepEqual(erros, []);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
