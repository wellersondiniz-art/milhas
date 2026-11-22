// Confere o contraste (WCAG 2.1) dos pares de cor do base.css nos dois temas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../site/css/base.css', import.meta.url), 'utf8');

function tokens(bloco) {
  const mapa = {};
  for (const [, nome, valor] of bloco.matchAll(/--(cor-[a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) {
    mapa[nome] = valor.toLowerCase();
  }
  return mapa;
}

function bloco(seletor) {
  const inicio = css.indexOf(seletor);
  assert.ok(inicio >= 0, `seletor ${seletor} não encontrado`);
  return css.slice(inicio, css.indexOf('}', inicio));
}

function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const claro = tokens(bloco(':root {'));
const temas = {
  claro,
  escuro: { ...claro, ...tokens(bloco(':root[data-tema="escuro"] {')) },
};

// [texto, fundo, mínimo]
const pares = [
  ['cor-texto', 'cor-fundo', 4.5],
  ['cor-texto', 'cor-superficie', 4.5],
  ['cor-texto', 'cor-superficie-2', 4.5],
  ['cor-texto-suave', 'cor-fundo', 4.5],
  ['cor-texto-suave', 'cor-superficie', 4.5],
  ['cor-texto-suave', 'cor-superficie-2', 4.5],
  ['cor-primaria', 'cor-superficie', 4.5],
  ['cor-primaria', 'cor-fundo', 4.5],
  ['cor-primaria', 'cor-superficie-2', 4.5],
  ['cor-primaria', 'cor-primaria-suave', 4.5],
  ['cor-sobre-primaria', 'cor-primaria', 4.5],
  ['cor-sobre-primaria', 'cor-primaria-forte', 4.5],
  ['cor-sobre-destaque', 'cor-destaque', 4.5],
  ['cor-sucesso-texto', 'cor-sucesso-fundo', 4.5],
  ['cor-aviso-texto', 'cor-aviso-fundo', 4.5],
  ['cor-perigo-texto', 'cor-perigo-fundo', 4.5],
  ['cor-perigo-texto', 'cor-superficie', 4.5],
  ['cor-info-texto', 'cor-info-fundo', 4.5],
  ['cor-borda-campo', 'cor-superficie', 3],
  ['cor-foco', 'cor-fundo', 3],
  ['cor-foco', 'cor-superficie', 3],
];

for (const [tema, cores] of Object.entries(temas)) {
  for (const [frente, fundo, minimo] of pares) {
    test(`contraste ${tema}: ${frente} sobre ${fundo} >= ${minimo}`, () => {
      assert.ok(cores[frente] && cores[fundo], `token ausente: ${frente} ou ${fundo}`);
      const razao = contraste(cores[frente], cores[fundo]);
      assert.ok(razao >= minimo, `${cores[frente]} sobre ${cores[fundo]} dá ${razao.toFixed(2)}:1`);
    });
  }
}

test('tema escuro do aparelho e o forçado usam as mesmas cores', () => {
  const doAparelho = tokens(bloco(':root:not([data-tema="claro"]) {'));
  const forcado = tokens(bloco(':root[data-tema="escuro"] {'));
  assert.deepEqual(doAparelho, forcado);
});
