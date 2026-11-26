// O menu principal é o mesmo em todas as páginas: as escritas à mão (site/)
// e as montadas no build (scripts/paginas/moldura.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { documento } from '../scripts/paginas/moldura.js';

const MENU = ['Comparar', 'Abastecer', 'Viagens', 'Ofertas', 'Meu perfil'];
const A_MAO = ['index.html', '404.html', 'viagens/index.html', 'abastecer/index.html', 'alertas/index.html'];

function textosDoMenu(html) {
  const nav = html.match(/<nav class="topo__menu" aria-label="Principal">([\s\S]*?)<\/nav>/);
  assert.ok(nav, 'página sem menu principal');
  return [...nav[1].matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
}

for (const arquivo of A_MAO) {
  test(`menu principal completo em site/${arquivo}`, async () => {
    const html = await readFile(new URL(`../site/${arquivo}`, import.meta.url), 'utf8');
    assert.deepEqual(textosDoMenu(html), MENU);
  });
}

test('menu principal completo nas páginas montadas no build', () => {
  const html = documento({ titulo: 'Teste', descricao: 'Teste', caminho: 'x/', raiz: '../', urlBase: null, atual: null, principal: '' });
  assert.deepEqual(textosDoMenu(html), MENU);
});
