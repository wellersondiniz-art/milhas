// Regras de acessibilidade que dá para conferir sem navegador.
// A auditoria com navegador (axe-core + Playwright) fica fora do repo,
// porque o site não tem dependências; o roteiro está no PR de acessibilidade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ler = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), 'utf8');
const css = (await Promise.all(['site/css/base.css', 'site/css/estilo.css', 'site/css/paginas.css'].map(ler))).join('\n');
const html = await ler('site/index.html');
const offline = await ler('site/offline.html');
const naoEncontrada = await ler('site/404.html');

test('páginas fixas em pt-BR e sem travar o zoom', () => {
  for (const pagina of [html, offline, naoEncontrada]) {
    assert.match(pagina, /<html lang="pt-BR">/);
    assert.doesNotMatch(pagina, /maximum-scale|user-scalable\s*=\s*no/i);
  }
});

test('foco visível nunca tira o outline (o alto contraste do sistema só mostra o outline)', () => {
  for (const [, seletor, corpo] of css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)) {
    assert.doesNotMatch(corpo, /outline:\s*(none|0)\b/, `${seletor.trim()} tira o outline`);
  }
});

test('o resultado tem região de aviso para leitor de tela fora da parte que fica escondida', () => {
  assert.match(html, /<p id="resultado-anuncio" class="visualmente-oculto" role="status"><\/p>/);
  const secao = html.slice(html.indexOf('id="passo-resultado"'), html.indexOf('</section>', html.indexOf('id="passo-resultado"')));
  assert.doesNotMatch(secao, /resultado-anuncio/);
});

test('movimento reduzido desliga animação, transição e rolagem suave', () => {
  const bloco = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(bloco.length > 0, 'falta o bloco prefers-reduced-motion');
  assert.match(bloco, /animation-duration/);
  assert.match(bloco, /transition-duration/);
  assert.match(bloco, /scroll-behavior: auto/);
});

test('alvo de toque: tokens de 48px e 44px', () => {
  assert.match(css, /--altura-toque: 3rem;/);
  assert.match(css, /--alvo-minimo: 2\.75rem;/);
});

test('todo campo da tela inicial tem rótulo', () => {
  for (const [, id] of html.matchAll(/<input[^>]*\bid="([^"]+)"/g)) {
    if (id === 'perfil-arquivo') continue; // aberto pelo botão "Importar perfil"
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `campo #${id} sem <label>`);
  }
});
