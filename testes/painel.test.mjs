// Painel semanal das métricas (scripts/painel/ e scripts/painel-semanal.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONSULTAS, buscarSemana, consultar, corpoDaConsulta, lerResposta } from '../scripts/painel/plausible.js';
import { lojasComOferta, montarPainel, semanaAte } from '../scripts/painel/montar.js';
import { gerarPainel } from '../scripts/painel-semanal.js';
import { EVENTOS } from '../site/js/metricas/metricas.js';

const RAIZ = new URL('../', import.meta.url);
const exemplo = async () => JSON.parse(await readFile(new URL('testes/painel/exemplo.json', RAIZ), 'utf8'));
const LOJAS = [
  { id: 'magalu', nome: 'Magalu', dominio: 'magazineluiza.com.br' },
  { id: 'amazon', nome: 'Amazon', dominio: 'amazon.com.br' },
  { id: 'loja|x', nome: 'Loja | X', dominio: 'www.lojax.com.br' },
];

test('semanaAte: 7 dias fechados até ontem, ou até --fim', () => {
  assert.deepEqual(semanaAte('2026-11-22'), { inicio: '2026-11-15', fim: '2026-11-21' });
  assert.deepEqual(semanaAte('2026-03-02'), { inicio: '2026-02-23', fim: '2026-03-01' });
  assert.deepEqual(semanaAte('2026-11-22', '2026-11-08'), { inicio: '2026-11-02', fim: '2026-11-08' });
});

test('consulta ao Plausible: meta do evento, quebra pelas propriedades', () => {
  assert.deepEqual(corpoDaConsulta({ site: 's.com', inicio: '2026-11-15', fim: '2026-11-21', evento: 'calculo', propriedades: ['loja'] }), {
    site_id: 's.com', metrics: ['events'], date_range: ['2026-11-15', '2026-11-21'],
    filters: [['is', 'event:goal', ['calculo']]], dimensions: ['event:props:loja'],
  });
  for (const [evento, props] of Object.entries(CONSULTAS)) {
    assert.ok(EVENTOS[evento], evento);
    for (const p of props) assert.ok(EVENTOS[evento].propriedades.includes(p), `${evento}.${p}`);
  }
  assert.deepEqual(Object.keys(CONSULTAS), Object.keys(EVENTOS));
});

test('lerResposta: "(none)" vira null, zero some', () => {
  const r = lerResposta({ results: [
    { metrics: [5], dimensions: ['magalu', '(none)'] },
    { metrics: [0], dimensions: ['amazon', 'x'] },
    { metrics: [2] },
  ] }, ['loja', 'origem']);
  assert.deepEqual(r, [
    { props: { loja: 'magalu', origem: null }, total: 5 },
    { props: { loja: null, origem: null }, total: 2 },
  ]);
  assert.deepEqual(lerResposta(null, []), []);
  assert.deepEqual(lerResposta({ results: [{ dimensions: [] }] }, []), []);
});

test('consultar: chave no cabeçalho, erros claros sem a chave', async () => {
  const pedidos = [];
  const ok = async (url, o) => { pedidos.push({ url, o }); return { ok: true, json: async () => ({ results: [{ metrics: [3], dimensions: [] }] }) }; };
  const r = await consultar({ chave: 'segredo', site: 's', inicio: 'a', fim: 'b', evento: 'instalacao', propriedades: [], buscar: ok });
  assert.deepEqual(r, [{ props: {}, total: 3 }]);
  assert.equal(pedidos[0].url, 'https://plausible.io/api/v2/query');
  assert.equal(pedidos[0].o.headers.Authorization, 'Bearer segredo');

  const falha = (status, corpo) => async () => ({ ok: false, status, json: async () => { if (!corpo) throw new Error('vazio'); return corpo; } });
  const opcoes = { chave: 'segredo', site: 's', inicio: 'a', fim: 'b', evento: 'calculo', propriedades: [] };
  await assert.rejects(consultar({ ...opcoes, buscar: falha(401) }), (e) => /401.*PLAUSIBLE_API_KEY/.test(e.message) && !e.message.includes('segredo'));
  await assert.rejects(consultar({ ...opcoes, buscar: falha(400, { error: 'goal not found' }) }), /meta "calculo".*goal not found/);
  await assert.rejects(consultar({ ...opcoes, buscar: falha(500) }), /500 para "calculo"\.$/);

  const todos = await buscarSemana({ chave: 'k', site: 's', inicio: 'a', fim: 'b', buscar: ok });
  assert.deepEqual(Object.keys(todos), Object.keys(CONSULTAS));
});

test('lojasComOferta usa o motor com todos os cartões', async () => {
  const pasta = new URL('testes/navegador/dados-de-teste/', RAIZ);
  const ler = async (n) => JSON.parse(await readFile(new URL(`${n}.json`, pasta), 'utf8'));
  const todos = { programas: await ler('programas'), cartoes: await ler('cartoes'), lojas: await ler('lojas'), ofertas: await ler('ofertas'), cambio: await ler('cambio') };
  const com = lojasComOferta(todos, '2026-11-10');
  assert.ok(com.has('loja-teste'));
  assert.ok(!com.has('outra-loja'));
});

test('montarPainel: mais buscadas, sem oferta, cliques e taxa', async () => {
  const texto = montarPainel({
    periodo: { inicio: '2026-11-15', fim: '2026-11-21' },
    eventos: await exemplo(),
    lojas: [...LOJAS, { id: 'mercado-livre', nome: 'Mercado Livre', dominio: 'mercadolivre.com.br' }],
    comOferta: new Set(['amazon']),
    site: 'milhasdavez.com.br',
    geradoEm: '2026-11-22',
  });
  assert.match(texto, /^# Painel semanal: 15\/11\/2026 a 21\/11\/2026/);
  assert.match(texto, /\| Buscas por loja \| 326 \|/);
  assert.match(texto, /\| Taxa calcular → clicar \| 18,2% \|/);
  assert.match(texto, /\| 1 \| Magalu \| 150 \| 120 \| 30 \| 110 \| \*\*não\*\* \|/);
  assert.match(texto, /\| 2 \| Amazon \| 95 \| 95 \| 0 \| 80 \| sim \|/);
  assert.match(texto, /\| 4 \| kabum \| 12 \| 0 \| 12 \| 0 \|/, 'loja que saiu de lojas.json aparece pelo id');
  const semOferta = texto.split('## Lojas sem oferta')[1].split('## Cliques')[0];
  assert.doesNotMatch(semOferta, /Amazon/);
  assert.match(semOferta, /\| Magalu \| 150 \| 110 \|/);
  assert.match(semOferta, /9 vezes alguém digitou uma loja que não está na lista/);
  assert.match(texto, /\| magazineluiza\.com\.br \| Magalu \| 27 \| 22 \| 5 \|/);
  assert.match(texto, /\| voeazul\.com\.br \| — \| 3 \| 0 \| 3 \|/);
  assert.match(texto, /\| Amazon \| 80 \| 20 \| 25% \|/);
  assert.match(texto, /\| Loja: Magalu \| 7 \|/);
  assert.match(texto, /\| Página de ofertas \| 2 \|/);
  assert.match(texto, /\| Instalações do app \| 4 \|/);
});

test('montarPainel: semana vazia e casos de borda', () => {
  const vazio = montarPainel({ periodo: { inicio: '2026-11-15', fim: '2026-11-21' }, eventos: {}, lojas: LOJAS, comOferta: new Set(), site: 's', geradoEm: '2026-11-22' });
  assert.match(vazio, /Taxa calcular → clicar \| — \|/);
  assert.match(vazio, /_Nenhuma busca na semana\._/);
  assert.match(vazio, /_Todas as lojas buscadas têm oferta valendo hoje\._/);
  assert.match(vazio, /_Nenhum clique para fora na semana\._/);
  assert.match(vazio, /_Ninguém viu oferta vencida na semana\._/);
  assert.doesNotMatch(vazio, /digitou uma loja/);

  const borda = montarPainel({
    periodo: { inicio: '2026-11-15', fim: '2026-11-21' },
    eventos: {
      busca_loja: [{ props: { loja: 'loja|x', origem: 'calculadora' }, total: 1 }, { props: { loja: 'fora-da-lista' }, total: 1 }, { props: { loja: null }, total: 4 }],
      calculo: [{ props: { loja: null }, total: 2 }],
      clique_saida: [{ props: { destino: 'loja.lojax.com.br', pagina: 'inicio', loja: 'loja|x' }, total: 1 }, { props: { destino: null, pagina: 'outra' }, total: 1 }],
      oferta_vencida_vista: [{ props: { pagina: 'outra', loja: null }, total: 1 }, { props: {}, total: 1 }],
    },
    lojas: LOJAS, comOferta: new Set(), site: 's', geradoEm: '2026-11-22', limite: 1,
  });
  assert.match(borda, /Loja \\\| X/, 'barra vertical escapada');
  assert.match(borda, /1 vez alguém digitou/);
  assert.match(borda, /\| loja\.lojax\.com\.br \| Loja \\\| X \| 1 \|/);
  assert.match(borda, /\| \(desconhecido\) \| — \| 1 \|/);
  assert.match(borda, /\| \(sem loja\) \| 2 \| 0 \| 0% \|/);
  assert.match(borda, /\| Página: outra \| 1 \|/);
  assert.match(borda, /\| Página: \? \| 1 \|/);
});

test('npm run painel: exemplo sem chave; sem chave pede a chave; com chave consulta e grava', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'painel-'));
  const saida = pathToFileURL(`${pasta}/`);
  try {
    const ex = await gerarPainel({ saida, ambiente: {}, argumentos: ['--exemplo'], hoje: '2026-11-22' });
    assert.ok(ex.arquivo.endsWith('painel-2026-11-21-exemplo.md'));
    assert.match(await readFile(ex.arquivo, 'utf8'), /site exemplo/);

    await assert.rejects(gerarPainel({ saida, ambiente: {}, argumentos: [], hoje: '2026-11-22' }), /PLAUSIBLE_API_KEY/);
    await assert.rejects(gerarPainel({ saida, ambiente: { PLAUSIBLE_API_KEY: 'k' }, argumentos: [], hoje: '2026-11-22' }), /DOMINIO_NO_PLAUSIBLE/);
    await assert.rejects(gerarPainel({ saida, ambiente: {}, argumentos: ['--fim', 'ontem'] }), /AAAA-MM-DD/);

    const pedidos = [];
    const buscar = async (url, o) => { pedidos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ results: [] }) }; };
    const r = await gerarPainel({ saida, ambiente: { PLAUSIBLE_API_KEY: 'k', PLAUSIBLE_SITE_ID: 'milhasdavez.com.br' }, argumentos: ['--fim', '2026-11-08'], buscar, hoje: '2026-11-22' });
    assert.equal(pedidos.length, Object.keys(CONSULTAS).length);
    assert.deepEqual(pedidos[0].date_range, ['2026-11-02', '2026-11-08']);
    assert.equal(pedidos[0].site_id, 'milhasdavez.com.br');
    assert.ok(r.arquivo.endsWith('painel-2026-11-08.md'));
    assert.match(r.texto, /site milhasdavez\.com\.br/);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
