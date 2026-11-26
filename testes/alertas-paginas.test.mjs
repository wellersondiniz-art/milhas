// Alertas por e-mail nas páginas: Privacidade e página da loja mudam só com
// ALERTAS_LIGADO; a página do formulário segue as regras de segurança.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ALERTAS_LIGADO } from '../scripts/paginas/config.js';
import { paginasInstitucionais } from '../scripts/paginas/institucionais.js';
import { gerarPaginas } from '../scripts/paginas/montar.js';
import { dadosDeTeste } from './alertas/apoio.mjs';

const privacidade = (alertas) => paginasInstitucionais({ alertas }).paginas.find((p) => p.caminho === 'privacidade/index.html').conteudo;

test('ALERTAS_LIGADO começa desligado (liga só depois de configurar e testar)', () => {
  assert.equal(ALERTAS_LIGADO, false);
});

test('Privacidade desligada: continua dizendo que não pede e-mail', () => {
  const html = privacidade(false);
  assert.ok(html.includes('Nome, e-mail, telefone ou endereço para usar o site.'));
  assert.ok(!html.includes('Alertas por e-mail'));
});

test('Privacidade ligada: diz o que guarda, para quê, duplo aceite, limite, cancelar e quem ajuda', () => {
  const html = privacidade(true);
  for (const trecho of [
    'Alertas por e-mail (só se você pedir)',
    'o seu endereço de e-mail;',
    'nunca número de cartão',
    'Duplo aceite',
    'no máximo 2 e-mails de alerta por semana',
    'nunca junto com o de outra pessoa',
    'apagamos o seu e-mail, os alertas e a cópia do perfil na hora',
    'Supabase',
    'Resend',
    'não tem o seu e-mail',
    'a não ser que você peça um alerta por e-mail',
  ]) assert.ok(html.includes(trecho), trecho);
  assert.ok(!html.includes('Nome, e-mail, telefone ou endereço para usar o site.'));
  assert.ok(html.includes('href="../alertas/"'));
});

test('página da loja: botão de alerta só com os alertas ligados', () => {
  const dados = dadosDeTeste();
  const com = gerarPaginas(dados, { hoje: '2026-11-10', alertas: true }).arquivos.find((a) => a.caminho === 'loja/loja-teste/index.html').conteudo;
  const sem = gerarPaginas(dados, { hoje: '2026-11-10', alertas: false }).arquivos.find((a) => a.caminho === 'loja/loja-teste/index.html').conteudo;
  assert.ok(com.includes('href="../../alertas/?loja=loja-teste"'));
  assert.ok(com.includes('Me avise por e-mail quando na Loja Teste render mais'));
  assert.ok(!sem.includes('alertas/'));
});

test('site/alertas/index.html: sem script inline, sem innerHTML, campos com rótulo e erro ligados', () => {
  const html = readFileSync(new URL('../site/alertas/index.html', import.meta.url), 'utf8');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'sem script inline');
  assert.ok(!/\son[a-z]+=/i.test(html), 'sem evento inline');
  assert.ok(!/style=/i.test(html), 'sem estilo inline');
  assert.match(html, /<meta name="robots" content="noindex">/);
  for (const id of ['alerta-loja', 'alerta-programa', 'alerta-pontos', 'alerta-email', 'alerta-consentimento']) {
    assert.ok(html.includes(`for="${id}"`), `rótulo de ${id}`);
    assert.ok(html.includes(`id="${id}-erro"`), `erro de ${id}`);
  }
  assert.ok(html.includes('autocomplete="email"'));
  assert.match(html, /Pontos por real<\/strong> é quanto você ganha/, 'explica o termo na primeira vez');
  for (const arquivo of ['../site/js/alertas/formulario.js', '../site/js/alertas/pedido.js']) {
    const js = readFileSync(new URL(arquivo, import.meta.url), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js), arquivo);
  }
});

test('site/_routes.json: funções só em /api/*', () => {
  const rotas = JSON.parse(readFileSync(new URL('../site/_routes.json', import.meta.url), 'utf8'));
  assert.deepEqual(rotas, { version: 1, include: ['/api/*'], exclude: [] });
});
