// "Essa informação está errada?": servidor (servidor/reportar/ e functions/api/reportar.js).
// Sem rede: o GitHub e o KV são de mentira, gravados em memória.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  blocoDeCodigo, comentarioDoEmail, dataEmSaoPaulo, ETIQUETAS, LIMITES, limparTexto, MARCA_EMAIL, montarIssue,
  ofertaAtiva, validarEmail, validarLink, validarReporte,
} from '../servidor/reportar/regras.js';
import { consumir, podeEnviar, POR_DIA, POR_HORA, resumoDoIp } from '../servidor/reportar/limite.js';
import { MENSAGENS, tratarReporte } from '../servidor/reportar/pedido.js';
import { clienteGithub, ErroDoGithub } from '../servidor/reportar/github.js';
import { leitorDeDados, onRequest, onRequestPost } from '../functions/api/reportar.js';

const PASTA = new URL('./navegador/dados-de-teste/', import.meta.url);
const ler = async (n) => JSON.parse(await readFile(new URL(`${n}.json`, PASTA), 'utf8'));
const DADOS = {
  lojas: await ler('lojas'), ofertas: await ler('ofertas'), programas: await ler('programas'), cartoes: await ler('cartoes'),
};
const ORIGEM = 'https://milhasdavez.com.br';
const AGORA = new Date('2026-11-10T12:00:00-03:00'); // a oferta de teste vale de 01/11 a 30/11

const VALIDO = Object.freeze({
  loja_id: 'loja-teste',
  oferta_id: 'programa-alfa-loja-teste',
  programa_id: 'programa-alfa',
  cartao_id: 'cartao-alfa',
  o_que_esta_errado: 'A oferta agora dá 8 pontos por real, não 9.',
  link_da_prova: 'https://www.loja.com.br/regulamento',
  email: '',
  site: '',
  tempo_no_formulario_ms: 12_000,
});

function kvDeMentira() {
  const mapa = new Map();
  return {
    mapa,
    puts: [],
    async get(chave) { return mapa.get(chave) ?? null; },
    async put(chave, valor, opcoes) { this.puts.push({ chave, valor, opcoes }); mapa.set(chave, valor); },
  };
}

function githubDeMentira({ falharIssue = false, falharComentario = false } = {}) {
  return {
    issues: [],
    comentarios: [],
    async criarIssue(issue) {
      if (falharIssue) throw new ErroDoGithub(500);
      this.issues.push(issue);
      return { number: this.issues.length };
    },
    async comentar(numero, body) {
      if (falharComentario) throw new ErroDoGithub(403);
      this.comentarios.push({ numero, body });
    },
  };
}

function deps(extra = {}) {
  return {
    kv: kvDeMentira(),
    chaveDoResumo: 'chave-de-teste',
    github: githubDeMentira(),
    buscarDados: async () => DADOS,
    agora: () => AGORA,
    ...extra,
  };
}

function pedido(corpo, { origem = ORIGEM, tipo = 'application/json', metodo = 'POST', ip = '203.0.113.7', cabecalhos = {} } = {}) {
  const headers = { 'CF-Connecting-IP': ip, ...cabecalhos };
  if (origem) headers.Origin = origem;
  if (tipo) headers['Content-Type'] = tipo;
  return new Request(`${ORIGEM}/api/reportar`, {
    method: metodo,
    headers,
    body: metodo === 'POST' ? (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) : undefined,
  });
}

async function enviar(corpo, d = deps(), opcoes = {}) {
  const resposta = await tratarReporte(pedido(corpo, opcoes), d);
  return { status: resposta.status, corpo: await resposta.json(), resposta, d };
}

// ---------------------------------------------------------------------------
// Regras puras

test('data em São Paulo: vira o dia à meia-noite de Brasília, não à de Greenwich', () => {
  assert.equal(dataEmSaoPaulo(new Date('2026-11-11T02:59:00Z')), '2026-11-10');
  assert.equal(dataEmSaoPaulo(new Date('2026-11-11T03:00:00Z')), '2026-11-11');
});

test('oferta ativa: mesma regra da calculadora', () => {
  const o = { inicio: '2026-11-01', fim: '2026-11-30' };
  assert.equal(ofertaAtiva(o, '2026-11-10'), true);
  assert.equal(ofertaAtiva(o, '2026-11-30'), true);
  assert.equal(ofertaAtiva(o, '2026-12-01'), false);
  assert.equal(ofertaAtiva(o, '2026-10-31'), false);
  assert.equal(ofertaAtiva({ inicio: 'A_CONFIRMAR', fim: 'A_CONFIRMAR' }, '2026-11-10'), true);
  assert.equal(ofertaAtiva({ ...o, status: 'A_CONFIRMAR' }, '2026-11-10'), false);
  assert.equal(ofertaAtiva(null, '2026-11-10'), false);
});

test('texto: tira invisíveis e controles, normaliza quebras de linha', () => {
  assert.equal(limparTexto('  oi\u200B\u202E tudo\r\n\r\n\r\n\r\nbem\u0007  '), 'oi tudo\n\nbem');
});

test('link da prova: só https com domínio de verdade', () => {
  assert.equal(validarLink(' https://www.magazineluiza.com.br/regulamento?x=1 '), 'https://www.magazineluiza.com.br/regulamento?x=1');
  for (const ruim of [
    'http://loja.com.br', 'javascript:alert(1)', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x',
    'https://user:senha@loja.com.br', 'https://loja.com.br:8443/x', 'https://intranet/x', 'https://loja .com.br',
    'data:text/html,oi', `https://loja.com.br/${'a'.repeat(LIMITES.linkMax)}`, '', 42, null, 'https://a.b.',
  ]) assert.equal(validarLink(ruim), null, String(ruim));
});

test('e-mail: formato simples, até 254 letras', () => {
  assert.equal(validarEmail(' ana@exemplo.com.br '), 'ana@exemplo.com.br');
  for (const ruim of ['ana', 'ana@', '@x.com', 'ana@x', 'a b@x.com', `${'a'.repeat(250)}@x.com`, 'ana@x.com\nBcc: b@y.com', 7]) {
    assert.equal(validarEmail(ruim), null, String(ruim));
  }
});

test('validação: aceita o reporte certo e devolve só o necessário', () => {
  const r = validarReporte({ ...VALIDO, email: 'ana@exemplo.com.br', extra: 'ignorado' }, DADOS);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.reporte).sort(), ['cartao', 'email', 'link', 'loja', 'oferta', 'programa', 'texto']);
  assert.deepEqual(r.reporte.loja, { id: 'loja-teste', nome: 'Loja Teste' });
  assert.equal(r.reporte.email, 'ana@exemplo.com.br');
});

test('validação: resultado sem oferta, sem cartão e sem e-mail também vale', () => {
  const r = validarReporte({ ...VALIDO, oferta_id: null, cartao_id: '', programa_id: undefined, email: undefined }, DADOS);
  assert.equal(r.ok, true);
  assert.equal(r.reporte.oferta, null);
  assert.equal(r.reporte.email, null);
});

test('validação: cada campo errado ganha a sua mensagem', () => {
  const r = validarReporte({
    loja_id: 'nao-existe', oferta_id: 'Nada<script>', programa_id: 'fantasma', cartao_id: 'fantasma',
    o_que_esta_errado: 'curto', link_da_prova: 'http://x.com', email: 'sem-arroba',
  }, DADOS);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.erros).sort(), ['cartao_id', 'email', 'link_da_prova', 'loja_id', 'o_que_esta_errado', 'oferta_id', 'programa_id']);
  assert.match(validarReporte({ ...VALIDO, o_que_esta_errado: 'x'.repeat(LIMITES.textoMax + 1) }, DADOS).erros.o_que_esta_errado, /no máximo/);
  assert.ok(validarReporte({ ...VALIDO, email: 123 }, DADOS).erros.email);
  assert.ok(validarReporte({ ...VALIDO, o_que_esta_errado: 5 }, DADOS).erros.o_que_esta_errado);
  assert.ok(validarReporte({ ...VALIDO, loja_id: 5 }, DADOS).erros.loja_id);
  assert.ok(validarReporte({ ...VALIDO, oferta_id: 5 }, DADOS).erros.oferta_id);
  assert.deepEqual(Object.keys(validarReporte(null, DADOS).erros), ['geral']);
  assert.deepEqual(Object.keys(validarReporte([], DADOS).erros), ['geral']);
  assert.ok(validarReporte(VALIDO, { lojas: null }).erros.loja_id);
});

test('validação: oferta de outra loja não passa', () => {
  const dados = { ...DADOS, lojas: [...DADOS.lojas] };
  const r = validarReporte({ ...VALIDO, loja_id: 'outra-loja' }, dados);
  assert.ok(r.erros.oferta_id);
});

test('bloco de código aguenta crases, menções, HTML e imagens', () => {
  const perigoso = 'oi @todos ```` <img src=x onerror=alert(1)> ![](https://rastreio.com/p.png)';
  const bloco = blocoDeCodigo(perigoso);
  const cerca = bloco.split('\n')[0].replace('text', '');
  assert.equal(cerca, '`````');
  assert.ok(bloco.endsWith(`\n${cerca}`));
  assert.equal(blocoDeCodigo('sem crase').split('\n')[0], '```text');
});

test('issue: oferta ativa ganha a etiqueta de prioridade; texto da pessoa só dentro de bloco de código', () => {
  const { reporte } = validarReporte({ ...VALIDO, o_que_esta_errado: '@dono olhe <b>isto</b> ```' }, DADOS);
  const issue = montarIssue(reporte, '2026-11-10');
  assert.deepEqual(issue.labels, [ETIQUETAS.reporte, ETIQUETAS.ofertaAtiva]);
  assert.equal(issue.title, '[Oferta ativa] Loja Teste: oferta ativa');
  assert.doesNotMatch(issue.title, /@|<|`/);
  const [antes, depois] = issue.body.split('````text\n@dono olhe <b>isto</b> ```\n````');
  assert.ok(depois !== undefined, 'o texto entrou num bloco de código');
  assert.doesNotMatch(antes, /@dono/);
  assert.match(issue.body, /ativa hoje/);
  assert.match(issue.body, /Pediu resposta por e-mail:\*\* não/);
});

test('issue: oferta vencida ou resultado sem oferta não ganham prioridade', () => {
  const { reporte } = validarReporte(VALIDO, DADOS);
  const vencida = montarIssue(reporte, '2026-12-05');
  assert.deepEqual(vencida.labels, [ETIQUETAS.reporte]);
  assert.match(vencida.title, /^\[Reporte\] Loja Teste: oferta fora do prazo$/);
  const sem = montarIssue(validarReporte({ ...VALIDO, oferta_id: null, cartao_id: null, programa_id: null }, DADOS).reporte, '2026-11-10');
  assert.deepEqual(sem.labels, [ETIQUETAS.reporte]);
  assert.match(sem.title, /compra sem oferta/);
  assert.match(sem.body, /Cartão:\*\* não informado/);
});

test('issue: o e-mail nunca vai no corpo; vai num comentário marcado', () => {
  const { reporte } = validarReporte({ ...VALIDO, email: 'ana@exemplo.com.br' }, DADOS);
  const issue = montarIssue(reporte, '2026-11-10');
  assert.doesNotMatch(JSON.stringify(issue), /ana@exemplo/);
  assert.match(issue.body, /Pediu resposta por e-mail:\*\* sim/);
  const comentario = comentarioDoEmail('ana@exemplo.com.br');
  assert.ok(comentario.startsWith(MARCA_EMAIL));
  assert.match(comentario, /```text\nana@exemplo\.com\.br\n```/);
});

// ---------------------------------------------------------------------------
// Limite

test('limite: resumo do IP é fixo para a mesma chave e não contém o IP', async () => {
  const a = await resumoDoIp('203.0.113.7', 'k1');
  assert.equal(a, await resumoDoIp('203.0.113.7', 'k1'));
  assert.notEqual(a, await resumoDoIp('203.0.113.7', 'k2'));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('limite: 5 por hora por pessoa, 50 por dia no total, com prazo no KV', async () => {
  const kv = kvDeMentira();
  for (let i = 0; i < POR_HORA; i++) {
    const lido = await podeEnviar(kv, 'p1', AGORA, '2026-11-10');
    assert.equal(lido.ok, true);
    await consumir(kv, lido);
  }
  const barrado = await podeEnviar(kv, 'p1', AGORA, '2026-11-10');
  assert.equal(barrado.ok, false);
  assert.equal(barrado.motivo, 'pessoa');
  assert.ok(barrado.esperarSegundos >= 60 && barrado.esperarSegundos <= 3600);
  assert.ok(kv.puts.every((p) => p.opcoes.expirationTtl > 0));
  assert.ok(kv.puts.filter((p) => p.chave.includes(':pessoa:')).every((p) => p.opcoes.expirationTtl === 3600));
  assert.equal((await podeEnviar(kv, 'p2', AGORA, '2026-11-10')).ok, true, 'outra pessoa passa');
  kv.mapa.set('reporte:dia:2026-11-10', String(POR_DIA));
  const dia = await podeEnviar(kv, 'p3', AGORA, '2026-11-10');
  assert.deepEqual([dia.ok, dia.motivo], [false, 'dia']);
  kv.mapa.set('reporte:dia:2026-11-10', 'lixo');
  assert.equal((await podeEnviar(kv, 'p3', AGORA, '2026-11-10')).ok, true, 'valor estranho no KV conta como zero');
});

// ---------------------------------------------------------------------------
// Pedido de ponta a ponta

test('pedido certo: cria a issue, conta no limite e não guarda o IP', async () => {
  const { status, corpo, d, resposta } = await enviar(VALIDO);
  assert.equal(status, 201);
  assert.deepEqual(corpo, { ok: true, mensagem: MENSAGENS.enviado });
  assert.equal(resposta.headers.get('Cache-Control'), 'no-store');
  assert.match(resposta.headers.get('Content-Type'), /^application\/json/);
  assert.equal(d.github.issues.length, 1);
  assert.equal(d.github.comentarios.length, 0);
  assert.deepEqual(d.github.issues[0].labels, ['reporte', 'prioridade: oferta ativa']);
  assert.equal(d.kv.puts.length, 2);
  const tudo = JSON.stringify([d.github.issues, d.kv.puts, [...d.kv.mapa.keys()]]);
  assert.doesNotMatch(tudo, /203\.0\.113\.7/);
});

test('pedido com e-mail: e-mail só no comentário à parte', async () => {
  const { status, d } = await enviar({ ...VALIDO, email: 'ana@exemplo.com.br' });
  assert.equal(status, 201);
  assert.doesNotMatch(JSON.stringify(d.github.issues), /ana@exemplo/);
  assert.equal(d.github.comentarios.length, 1);
  assert.equal(d.github.comentarios[0].numero, 1);
  assert.ok(d.github.comentarios[0].body.startsWith(MARCA_EMAIL));
});

test('armadilhas: campo escondido ou envio rápido demais respondem "ok" e não fazem nada', async () => {
  for (const corpo of [{ ...VALIDO, site: 'https://spam.example' }, { ...VALIDO, tempo_no_formulario_ms: 500 }, { ...VALIDO, tempo_no_formulario_ms: 'x' }]) {
    const { status, corpo: c, d } = await enviar(corpo);
    assert.equal(status, 200);
    assert.equal(c.ok, true);
    assert.equal(d.github.issues.length, 0);
    assert.equal(d.kv.puts.length, 0);
  }
});

test('limite: o 6º envio na mesma hora recebe 429 com Retry-After', async () => {
  const d = deps();
  for (let i = 0; i < POR_HORA; i++) assert.equal((await enviar(VALIDO, d)).status, 201);
  const { status, corpo, resposta } = await enviar(VALIDO, d);
  assert.equal(status, 429);
  assert.equal(corpo.mensagem, MENSAGENS.limitePessoa);
  assert.ok(Number(resposta.headers.get('Retry-After')) > 0);
  assert.equal(d.github.issues.length, POR_HORA);
  assert.equal((await enviar(VALIDO, d, { ip: '198.51.100.9' })).status, 201, 'outra conexão passa');
  d.kv.mapa.set('reporte:dia:2026-11-10', String(POR_DIA));
  assert.equal((await enviar(VALIDO, d, { ip: '198.51.100.10' })).corpo.mensagem, MENSAGENS.limiteDia);
});

test('travas do pedido: método, configuração, origem, tipo, tamanho e JSON', async () => {
  assert.equal((await tratarReporte(pedido(null, { metodo: 'GET' }), deps())).status, 405);
  assert.equal((await enviar(VALIDO, deps({ kv: null }))).status, 503);
  assert.equal((await enviar(VALIDO, deps({ github: null }))).status, 503);
  assert.equal((await enviar(VALIDO, deps({ chaveDoResumo: '' }))).status, 503);
  assert.equal((await enviar(VALIDO, deps(), { origem: null })).status, 403);
  assert.equal((await enviar(VALIDO, deps(), { origem: 'https://outro-site.example' })).status, 403);
  assert.equal((await enviar(VALIDO, deps(), { cabecalhos: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await enviar(VALIDO, deps(), { cabecalhos: { 'Sec-Fetch-Site': 'same-origin' } })).status, 201);
  assert.equal((await enviar(VALIDO, deps(), { tipo: 'text/plain' })).status, 415);
  assert.equal((await enviar(VALIDO, deps(), { tipo: null })).status, 415);
  const grande = { ...VALIDO, o_que_esta_errado: 'x'.repeat(LIMITES.corpoBytes) };
  assert.equal((await enviar(grande)).status, 413);
  assert.equal((await enviar(VALIDO, deps(), { cabecalhos: { 'Content-Length': String(LIMITES.corpoBytes + 1) } })).status, 413);
  assert.equal((await enviar('{"quebrado":')).status, 400);
  assert.equal((await enviar('[1,2]')).status, 400);
  assert.equal((await enviar('null')).status, 400);
});

test('pedido inválido: 422 com os erros por campo, sem gastar limite', async () => {
  const { status, corpo, d } = await enviar({ ...VALIDO, link_da_prova: 'http://x.com', o_que_esta_errado: 'ruim' });
  assert.equal(status, 422);
  assert.deepEqual(Object.keys(corpo.erros).sort(), ['link_da_prova', 'o_que_esta_errado']);
  assert.equal(d.kv.puts.length, 0);
  assert.equal(d.github.issues.length, 0);
});

test('falhas de fora: dados fora do ar (503), GitHub recusando (502) e comentário recusado (201)', async (t) => {
  t.mock.method(console, 'error', () => {});
  assert.equal((await enviar(VALIDO, deps({ buscarDados: async () => { throw new Error('fora'); } }))).status, 503);
  const recusou = await enviar(VALIDO, deps({ github: githubDeMentira({ falharIssue: true }) }));
  assert.equal(recusou.status, 502);
  assert.equal(recusou.corpo.mensagem, MENSAGENS.github);
  assert.equal(recusou.d.kv.puts.length, 2, 'a tentativa conta no limite');
  const semComentario = await enviar({ ...VALIDO, email: 'ana@exemplo.com.br' }, deps({ github: githubDeMentira({ falharComentario: true }) }));
  assert.equal(semComentario.status, 201);
  for (const [linha] of console.error.mock.calls.map((c) => c.arguments)) {
    assert.doesNotMatch(linha, /ana@|pontos por real/, 'o log não tem o texto nem o e-mail');
  }
});

// ---------------------------------------------------------------------------
// Cliente do GitHub e a função da Cloudflare

test('cliente do GitHub: endereço, cabeçalhos e erro com status', async () => {
  assert.equal(clienteGithub({ token: '', repo: 'a/b' }), null);
  assert.equal(clienteGithub({ token: 't', repo: 'sem-barra' }), null);
  assert.equal(clienteGithub({ token: 't', repo: undefined }), null);
  const chamadas = [];
  const gh = clienteGithub({
    token: 'tk', repo: 'dono/reportes',
    buscar: async (url, init) => { chamadas.push({ url, init }); return new Response(JSON.stringify({ number: 7 }), { status: 201 }); },
  });
  assert.deepEqual(await gh.criarIssue({ title: 't', body: 'b', labels: ['reporte'] }), { number: 7 });
  await gh.comentar('7', 'oi');
  assert.equal(chamadas[0].url, 'https://api.github.com/repos/dono/reportes/issues');
  assert.equal(chamadas[1].url, 'https://api.github.com/repos/dono/reportes/issues/7/comments');
  assert.equal(chamadas[0].init.headers.Authorization, 'Bearer tk');
  assert.ok(chamadas[0].init.headers['User-Agent']);
  const falha = clienteGithub({ token: 'tk', repo: 'dono/reportes', buscar: async () => new Response('não', { status: 401 }) });
  await assert.rejects(falha.criarIssue({}), (e) => e instanceof ErroDoGithub && e.status === 401);
});

test('função da Cloudflare: sem configuração responde 503; outros métodos 405', async () => {
  const r = await onRequestPost({ request: pedido(VALIDO), env: {} });
  assert.equal(r.status, 503);
  assert.equal((await onRequest()).status, 405);
});

test('função da Cloudflare: lê os dados publicados pelo ASSETS e cria a issue', async (t) => {
  const pedidos = [];
  const env = {
    GITHUB_TOKEN: 'tk',
    REPORTES_REPO: 'dono/reportes',
    REPORTES_LIMITE: kvDeMentira(),
    ASSETS: {
      async fetch(url) {
        const nome = url.pathname.split('/').pop().replace('.json', '');
        return new Response(JSON.stringify(DADOS[nome]), { status: 200 });
      },
    },
  };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    pedidos.push({ url, corpo: JSON.parse(init.body) });
    return new Response(JSON.stringify({ number: 1 }), { status: 201 });
  });
  t.mock.timers.enable({ apis: ['Date'], now: AGORA });
  const r = await onRequestPost({ request: pedido(VALIDO), env });
  assert.equal(r.status, 201);
  assert.equal(pedidos.length, 1);
  assert.deepEqual(pedidos[0].corpo.labels, ['reporte', 'prioridade: oferta ativa']);

  const quebrado = leitorDeDados({ ASSETS: { fetch: async () => new Response('x', { status: 404 }) } }, pedido(VALIDO));
  await assert.rejects(quebrado(), /404/);
  const naoLista = leitorDeDados({ ASSETS: { fetch: async () => new Response('{}', { status: 200 }) } }, pedido(VALIDO));
  await assert.rejects(naoLista(), /não é lista/);
});

test('robô de limpeza do e-mail: apaga o comentário marcado ao fechar e depois de 90 dias', async () => {
  const yml = await readFile(new URL('../servidor/reportar/repo-de-reportes/limpar-emails.yml', import.meta.url), 'utf8');
  assert.ok(yml.includes(`MARCA: '${MARCA_EMAIL}'`), 'mesma marca do comentário');
  assert.match(yml, /types: \[closed\]/);
  assert.match(yml, /DIAS: '90'/);
  assert.match(yml, /-X DELETE/);
  assert.match(yml, /permissions:\n {2}issues: write/);
  assert.doesNotMatch(yml, /uses:/, 'sem action de terceiros');
});

test('_routes.json: a função só roda em /api/*; o resto continua estático', async () => {
  const rotas = JSON.parse(await readFile(new URL('../site/_routes.json', import.meta.url), 'utf8'));
  assert.deepEqual(rotas, { version: 1, include: ['/api/*'], exclude: [] });
});
