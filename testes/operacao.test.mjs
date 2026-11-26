// Testes da operação de produção (docs/operacao.md): logs sem dado pessoal,
// alertas, monitor, vigia e painel de custos. Nada aqui usa rede de verdade:
// todo "fetch" é falso. Segredos e números de exemplo são montados em pedaços
// para a auditoria (seguranca/auditar.sh) não confundir com dado real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { limparTexto, limparRota, registroDeErro, localDoErro, linhaDeLog, gravadorSupabase, registrarErro } from '../servidor/operacao/registro.js';
import { protegerFuncao, origemDaRota, respostaDeErro } from '../servidor/operacao/middleware.js';
import { abrirAlerta, fecharAlerta, clienteGitHub, marcador, lerArgumentos } from '../scripts/operacao/alerta.js';
import { urlDoSite, conferirPonto, conferirSite, textoDoAlerta, linkDaExecucao, PONTOS } from '../scripts/operacao/disponibilidade.js';
import { conferirOfertas, conferirPrsDeOfertas, conferirRobos, conferirErros, aplicarAlertas, diasEntre, prazoDoAmbiente, lerGitHub, PRAZO_PADRAO_DIAS } from '../scripts/operacao/vigia.js';
import { centavosTextoParaNano, periodoDoMes, gastoAnthropic, formatar, percentual, montarPainel, textoDoPainel, medir, NANO_POR_CENTAVO } from '../scripts/operacao/custos.js';
import { clienteOperacao } from '../scripts/operacao/supabase.js';

// --- Dados falsos montados em pedaços -------------------------------------
const CARTAO = ['4111', '1111', '1111', '1111'].join(' ');
const CARTAO_JUNTO = ['4111', '1111', '1111', '1111'].join('');
const CPF = `${['123', '456', '789'].join('.')}-09`;
const CPF_JUNTO = ['123', '456', '789', '09'].join('');
const CHAVE_ANTHROPIC = ['sk', 'ant', 'api03', 'A'.repeat(30)].join('-');
const CHAVE_SUPABASE = ['sb', 'secret', 'B'.repeat(30)].join('_');
const CHAVE_STRIPE = ['rk', 'test', 'C'.repeat(30)].join('_');
const WEBHOOK = ['whsec', 'D'.repeat(30)].join('_');
const JWT = ['eyJ' + 'h'.repeat(12), 'eyJ' + 'p'.repeat(12), 's'.repeat(20)].join('.');
const EMAIL = ['fulana', 'exemplo.com.br'].join('@');

function respostaJson(corpo, status = 200, cabecalhos = {}) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cabecalhos } });
}

/** fetch falso: cada chamada responde pela primeira regra cujo teste casar. */
function fetchFalso(regras) {
  const chamadas = [];
  const f = async (url, opcoes = {}) => {
    const u = String(url);
    chamadas.push({ url: u, opcoes });
    for (const [teste, resposta] of regras) {
      if (teste(u, opcoes)) return typeof resposta === 'function' ? resposta(u, opcoes) : resposta.clone();
    }
    throw new Error(`fetch inesperado: ${u}`);
  };
  f.chamadas = chamadas;
  return f;
}

// =========================================================================
// 2. Logs de erro sem dado pessoal
// =========================================================================

test('limparTexto troca e-mail, CPF, cartão, telefone, IP e segredos por marcadores', () => {
  const sujo = [
    `falhou para ${EMAIL}`,
    `cartão ${CARTAO} e ${CARTAO_JUNTO}`,
    `cpf ${CPF} e ${CPF_JUNTO}`,
    'tel (21) 99876-5432',
    'ip 200.150.10.7 e 2001:db8:85a3:0:0:8a2e:370:7334',
    `chaves ${CHAVE_ANTHROPIC} ${CHAVE_SUPABASE} ${CHAVE_STRIPE} ${WEBHOOK}`,
    `Authorization: Bearer abc.def-123 jwt ${JWT}`,
    'link https://site/api/alertas/confirmar?token=abc123&email=x',
  ].join(' | ');
  const limpo = limparTexto(sujo, 2000);
  for (const proibido of [EMAIL, CARTAO, CARTAO_JUNTO, CPF, CPF_JUNTO, '99876-5432', '200.150.10.7', '8a2e', CHAVE_ANTHROPIC, CHAVE_SUPABASE, CHAVE_STRIPE, WEBHOOK, 'abc.def-123', JWT, 'token=abc123']) {
    assert.ok(!limpo.includes(proibido), `ainda tem ${proibido}: ${limpo}`);
  }
  for (const marca of ['[email]', '[numero]', '[cpf]', '[telefone]', '[ip]', '[segredo]', 'Bearer [segredo]', '?token=[valor]&email=[valor]']) {
    assert.ok(limpo.includes(marca), `falta ${marca}: ${limpo}`);
  }
  assert.ok(!/\d{6,}/.test(limpo));
});

test('limparTexto deixa a mensagem técnica legível, numa linha e com tamanho máximo', () => {
  assert.equal(limparTexto("Cannot read properties of undefined (reading 'loja')"), "Cannot read properties of undefined (reading 'loja')");
  assert.equal(limparTexto('Supabase: inscrição respondeu 409'), 'Supabase: inscrição respondeu 409');
  assert.equal(limparTexto('linha 1\nlinha 2\r\n\tfim'), 'linha 1 linha 2 fim');
  assert.equal(limparTexto(null), '');
  const longo = limparTexto('x'.repeat(1000));
  assert.equal(longo.length, 300);
  assert.ok(longo.endsWith('…'));
  // Código longo sem prefixo conhecido (id, token) vira [id].
  assert.equal(limparTexto(`id ${'a1'.repeat(15)}`), 'id [id]');
});

test('limparRota guarda só o caminho, sem query, domínio ou pedaços variáveis', () => {
  assert.equal(limparRota('https://milhasdavez.com.br/api/alertas/inscrever?email=x#y'), '/api/alertas/inscrever');
  assert.equal(limparRota('https://x/api/alertas/cancelar/3f2a9c1e-0000-4000-8000-1234567890ab'), '/api/alertas/cancelar/[id]');
  assert.equal(limparRota(`https://x/api/${encodeURIComponent(EMAIL)}`), '/api/[id]');
  assert.equal(limparRota('https://x/api/%E0%A4%A'), '/api/[id]');
  assert.equal(limparRota('https://x/'), '/');
  assert.equal(limparRota('/api/explicar'), '/api/explicar');
  assert.equal(limparRota('http://[::1'), '[rota inválida]');
  assert.equal(limparRota(`https://x/${'a/'.repeat(100)}`).length, 120);
});

test('registroDeErro só tem os campos permitidos, todos limpos', () => {
  const erro = new TypeError(`não achei ${EMAIL}`);
  const r = registroDeErro({ origem: 'Alertas', url: `https://x/api/alertas/inscrever?e=${EMAIL}`, status: 500, erro, agora: new Date('2026-11-24T12:00:00Z') });
  assert.deepEqual(Object.keys(r).sort(), ['local', 'mensagem', 'origem', 'quando', 'rota', 'status', 'tipo']);
  assert.equal(r.quando, '2026-11-24T12:00:00.000Z');
  assert.equal(r.origem, 'alertas');
  assert.equal(r.rota, '/api/alertas/inscrever');
  assert.equal(r.status, 500);
  assert.equal(r.tipo, 'typeerror');
  assert.equal(r.mensagem, 'não achei [email]');
  assert.match(r.local, /^operacao\.test\.mjs:\d+$/);
  assert.ok(!JSON.stringify(r).includes(EMAIL));
});

test('registroDeErro lida com valores que não são Error e com campos estranhos', () => {
  const r1 = registroDeErro({ origem: 'nome com espaço', status: 999, erro: `texto ${CPF}` });
  assert.equal(r1.origem, 'desconhecida');
  assert.equal(r1.status, null);
  assert.equal(r1.tipo, 'valor');
  assert.equal(r1.mensagem, 'texto [cpf]');
  assert.equal(r1.rota, null);
  assert.equal(r1.local, null);
  const r2 = registroDeErro({ origem: 'x', erro: { senha: 'segredo' } });
  assert.equal(r2.mensagem, 'valor não-Error lançado');
  const r3 = registroDeErro({ origem: 'x', url: 'https://x/api/x', status: 502 });
  assert.equal(r3.tipo, 'resposta');
  assert.equal(r3.mensagem, '');
  const semPilha = new Error('a');
  semPilha.stack = undefined;
  assert.equal(localDoErro(semPilha), null);
  const pilhaEstranha = new Error('a');
  pilhaEstranha.stack = 'Error: a\n    at <anonymous>';
  assert.equal(localDoErro(pilhaEstranha), null);
  const comNome = new Error('a');
  comNome.name = 'Nome Com Espaço';
  assert.equal(registroDeErro({ origem: 'x', erro: comNome }).tipo, 'error');
});

test('linhaDeLog é uma linha de JSON', () => {
  const linha = linhaDeLog(registroDeErro({ origem: 'x', erro: new Error('a\nb') }));
  assert.ok(!linha.includes('\n'));
  assert.equal(JSON.parse(linha).erro_operacao.mensagem, 'a b');
});

test('gravadorSupabase manda só os campos do registro, com a chave só no cabeçalho, e nunca lança', async () => {
  assert.equal(gravadorSupabase({ url: 'https://x.supabase.co', chave: '' }), null);
  assert.equal(gravadorSupabase({ url: 'http://x.supabase.co', chave: 'k' }), null);
  assert.equal(gravadorSupabase({ url: undefined, chave: 'k' }), null);
  const f = fetchFalso([[() => true, new Response(null, { status: 201 })]]);
  const gravar = gravadorSupabase({ url: 'https://x.supabase.co/', chave: CHAVE_SUPABASE, fetch: f });
  const registro = registroDeErro({ origem: 'alertas', url: 'https://x/api/alertas', status: 500, erro: new Error('falhou') });
  assert.equal(await gravar(registro), true);
  const { url, opcoes } = f.chamadas[0];
  assert.equal(url, 'https://x.supabase.co/rest/v1/operacao_erros');
  assert.equal(opcoes.headers.apikey, CHAVE_SUPABASE);
  const corpo = JSON.parse(opcoes.body);
  assert.deepEqual(Object.keys(corpo).sort(), ['local', 'mensagem', 'origem', 'rota', 'status', 'tipo']);
  assert.ok(!opcoes.body.includes(CHAVE_SUPABASE));
  const quebrado = gravadorSupabase({ url: 'https://x.supabase.co', chave: 'k', fetch: async () => { throw new Error('rede'); } });
  assert.equal(await quebrado(registro), false);
});

test('registrarErro escreve a linha limpa no log e devolve a gravação', async () => {
  const linhas = [];
  assert.equal(await registrarErro({ origem: 'x', erro: new Error(EMAIL) }, { log: (l) => linhas.push(l) }), false);
  assert.equal(linhas.length, 1);
  assert.ok(!linhas[0].includes(EMAIL));
  let gravado = null;
  assert.equal(await registrarErro({ origem: 'x' }, { log: () => {}, gravar: async (r) => { gravado = r; return true; } }), true);
  assert.equal(gravado.origem, 'x');
});

test('middleware: erro não tratado vira 500 genérico, registrado sem dado pessoal', async () => {
  const linhas = [];
  const esperas = [];
  const f = fetchFalso([[() => true, new Response(null, { status: 201 })]]);
  const resposta = await protegerFuncao({
    request: new Request(`https://milhasdavez.com.br/api/alertas/inscrever?email=${EMAIL}`),
    env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: CHAVE_SUPABASE },
    next: async () => { throw new Error(`banco recusou ${EMAIL} com cartão ${CARTAO}`); },
    waitUntil: (p) => esperas.push(p),
  }, { log: (l) => linhas.push(l), fetch: f });
  assert.equal(resposta.status, 500);
  const corpo = await resposta.json();
  assert.equal(corpo.ok, false);
  assert.ok(!JSON.stringify(corpo).includes('banco'));
  await Promise.all(esperas);
  assert.equal(linhas.length, 1);
  for (const proibido of [EMAIL, CARTAO]) {
    assert.ok(!linhas[0].includes(proibido));
    assert.ok(!f.chamadas[0].opcoes.body.includes(proibido));
  }
  assert.equal(JSON.parse(linhas[0]).erro_operacao.origem, 'alertas');
});

test('middleware: 5xx da função é registrado (menos 503 de "desligado"); o resto passa direto', async () => {
  const linhas = [];
  const rodar = (status) => protegerFuncao({
    request: new Request('https://x/api/explicar'),
    env: {},
    next: async () => new Response('x', { status }),
  }, { log: (l) => linhas.push(l) });
  assert.equal((await rodar(200)).status, 200);
  assert.equal((await rodar(404)).status, 404);
  assert.equal((await rodar(503)).status, 503);
  assert.equal(linhas.length, 0);
  assert.equal((await rodar(502)).status, 502);
  assert.equal(linhas.length, 1);
  assert.equal(JSON.parse(linhas[0]).erro_operacao.status, 502);
});

test('middleware: nome do módulo e resposta de erro', async () => {
  assert.equal(origemDaRota('https://x/api/alertas/inscrever'), 'alertas');
  assert.equal(origemDaRota('https://x/api/'), 'site');
  assert.equal(origemDaRota('https://x/loja/magalu'), 'loja');
  assert.equal(origemDaRota('nada'), 'site');
  const r = respostaDeErro();
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('functions/_middleware.js usa a proteção e _routes.json limita as funções a /api/*', async () => {
  const meio = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
  assert.match(meio, /protegerFuncao/);
  const rotas = JSON.parse(await readFile(new URL('../site/_routes.json', import.meta.url), 'utf8'));
  assert.deepEqual(rotas, { version: 1, include: ['/api/*'], exclude: [] });
});

// =========================================================================
// Alertas (issues no GitHub)
// =========================================================================

function githubFalso({ abertas = [], comentarios = [] } = {}) {
  const feito = [];
  return {
    feito,
    issuesAbertas: async () => abertas,
    comentarios: async () => comentarios,
    criar: async (d) => { feito.push(['criar', d]); return { number: 9 }; },
    comentar: async (n, t) => { feito.push(['comentar', n, t]); },
    fechar: async (n) => { feito.push(['fechar', n]); },
  };
}

test('abrirAlerta abre uma issue com a chave no título, etiqueta e o dono atribuído', async () => {
  const gh = githubFalso();
  assert.equal(await abrirAlerta(gh, { chave: 'backup', titulo: 'Backup falhou', corpo: 'texto', dono: 'dono' }), 'aberto');
  assert.deepEqual(gh.feito[0], ['criar', { title: '[operacao:backup] Backup falhou', body: 'texto', labels: ['operacao'], assignees: ['dono'] }]);
  const semDono = githubFalso();
  await abrirAlerta(semDono, { chave: 'backup', titulo: 't', corpo: 'c' });
  assert.equal(semDono.feito[0][1].assignees, undefined);
});

test('abrirAlerta não repete o mesmo texto e comenta quando muda', async () => {
  const aberta = { number: 3, title: '[operacao:custos] x', body: 'v1' };
  const pr = { number: 4, title: '[operacao:custos] x', pull_request: {} };
  assert.equal(await abrirAlerta(githubFalso({ abertas: [pr, aberta] }), { chave: 'custos', titulo: 'x', corpo: 'v1' }), 'igual');
  assert.equal(await abrirAlerta(githubFalso({ abertas: [aberta], comentarios: [{ body: 'v2' }] }), { chave: 'custos', titulo: 'x', corpo: 'v2' }), 'igual');
  const gh = githubFalso({ abertas: [aberta], comentarios: [{ body: 'v2' }] });
  assert.equal(await abrirAlerta(gh, { chave: 'custos', titulo: 'x', corpo: 'v3' }), 'comentado');
  assert.deepEqual(gh.feito, [['comentar', 3, 'v3']]);
});

test('fecharAlerta comenta e fecha só a issue da chave', async () => {
  const outras = [{ number: 1, title: '[operacao:backup] x' }, { number: 2, title: '[operacao:custos] y' }, { number: 5, title: null }];
  const gh = githubFalso({ abertas: outras });
  assert.equal(await fecharAlerta(gh, { chave: 'custos' }), 'fechado');
  assert.deepEqual(gh.feito.map((f) => f.slice(0, 2)), [['comentar', 2], ['fechar', 2]]);
  assert.equal(await fecharAlerta(githubFalso(), { chave: 'custos' }), 'nada');
});

test('marcador recusa chave estranha (vai no título público)', () => {
  assert.equal(marcador('ofertas-paradas'), '[operacao:ofertas-paradas]');
  assert.throws(() => marcador('Chave Com Espaço'));
  assert.throws(() => marcador(undefined));
});

test('clienteGitHub fala com a API do repositório com o token só no cabeçalho', async () => {
  assert.equal(clienteGitHub({ token: '', repositorio: 'a/b' }), null);
  assert.equal(clienteGitHub({ token: 't', repositorio: 'sem-barra' }), null);
  const f = fetchFalso([
    [(u, o) => o.method === 'GET' && u.includes('/issues?'), respostaJson([{ number: 1 }])],
    [(u, o) => o.method === 'GET', respostaJson([])],
    [(u, o) => o.method === 'PATCH', new Response(null, { status: 204 })],
    [(u, o) => o.method === 'POST' && u.endsWith('/comments'), respostaJson({}, 500)],
    [() => true, respostaJson({ number: 2 }, 201)],
  ]);
  const gh = clienteGitHub({ token: 'tok', repositorio: 'dono/milhas', fetch: f });
  assert.deepEqual(await gh.issuesAbertas(), [{ number: 1 }]);
  assert.deepEqual(await gh.comentarios(1), []);
  assert.deepEqual(await gh.criar({ title: 't' }), { number: 2 });
  assert.equal(await gh.fechar(1), null);
  await assert.rejects(gh.comentar(1, 'x'), /respondeu 500/);
  assert.equal(f.chamadas[0].url, 'https://api.github.com/repos/dono/milhas/issues?state=open&labels=operacao&per_page=100');
  assert.equal(f.chamadas[0].opcoes.headers.authorization, 'Bearer tok');
  assert.equal(JSON.parse(f.chamadas[3].opcoes.body).state, 'closed');
});

test('lerArgumentos da linha de comando dos alertas', () => {
  assert.deepEqual(lerArgumentos(['abrir', '--chave', 'backup', '--titulo', 'T', '--corpo-arquivo', 'f.md']), { acao: 'abrir', chave: 'backup', titulo: 'T', corpoArquivo: 'f.md' });
  assert.deepEqual(lerArgumentos(['fechar', '--chave', 'backup']), { acao: 'fechar', chave: 'backup' });
  assert.throws(() => lerArgumentos(['apagar']), /use:/);
  assert.throws(() => lerArgumentos(['abrir', '--chave', 'backup']), /--titulo/);
  assert.throws(() => lerArgumentos(['fechar', '--outra', 'x']), /argumento inválido/);
  assert.throws(() => lerArgumentos(['fechar', '--chave']), /argumento inválido/);
});

// =========================================================================
// 1. Monitor de disponibilidade (reserva no GitHub Actions)
// =========================================================================

test('urlDoSite aceita só https://dominio e desliga sem valor', () => {
  assert.equal(urlDoSite(''), null);
  assert.equal(urlDoSite(undefined), null);
  assert.equal(urlDoSite(' https://milhasdavez.com.br/ '), 'https://milhasdavez.com.br');
  assert.throws(() => urlDoSite('http://milhasdavez.com.br'), /só https/);
  assert.throws(() => urlDoSite('https://milhasdavez.com.br/loja'), /só https/);
  assert.throws(() => urlDoSite('https://x.com/?a=1'), /só https/);
  assert.throws(() => urlDoSite('não é url'), /inválida/);
});

const SITE_OK = [
  [(u) => u.endsWith('/dados/ofertas.json'), respostaJson([])],
  [() => true, new Response('<!doctype html><html lang="pt-BR"></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })],
];

test('conferirSite: tudo no ar', async () => {
  const f = fetchFalso(SITE_OK);
  const r = await conferirSite('https://x', { fetch: f, esperar: async () => assert.fail('não devia esperar') });
  assert.ok(r.every((p) => p.ok));
  assert.equal(f.chamadas.length, PONTOS.length);
  assert.equal(f.chamadas[0].opcoes.headers['user-agent'], 'milhas-monitor/1.0');
});

test('conferirSite tenta de novo antes de acusar e só acusa o que continuou falhando', async () => {
  let vez = 0;
  const f = fetchFalso([
    [(u) => u.endsWith('/'), () => (vez++ === 0 ? new Response('x', { status: 502 }) : new Response('<html>', { headers: { 'content-type': 'text/html' } }))],
    [(u) => u.endsWith('/dados/ofertas.json'), new Response('{"nao":"lista"}', { headers: { 'content-type': 'application/json' } })],
  ]);
  let esperou = 0;
  const r = await conferirSite('https://x', { fetch: f, esperar: async (ms) => { esperou = ms; }, pausaMs: 30_000 });
  assert.equal(esperou, 30_000);
  assert.equal(r[0].ok, true);
  assert.equal(r[1].ok, false);
  assert.match(r[1].motivo, /conteúdo não é o esperado/);
  const texto = textoDoAlerta('https://x', r, 'https://github.com/a/b/actions/runs/1');
  assert.match(texto, /\| Página inicial \(\/\) \| ok \|/);
  assert.match(texto, /\*\*falhou\*\*/);
  assert.match(texto, /actions\/runs\/1/);
  assert.ok(!textoDoAlerta('https://x', r, null).includes('Execução do robô'));
});

test('conferirPonto explica status, tempo esgotado, falha de conexão e conteúdo errado', async () => {
  const [inicio, dados] = PONTOS;
  const relogio = (() => { let t = 0; return () => (t += 100); })();
  assert.deepEqual(await conferirPonto('https://x', inicio, { fetch: async () => new Response('x', { status: 503 }), relogio }), { ok: false, motivo: 'respondeu 503', ms: 100 });
  const tempo = Object.assign(new Error('t'), { name: 'TimeoutError' });
  assert.match((await conferirPonto('https://x', inicio, { fetch: async () => { throw tempo; } })).motivo, /não respondeu em 15 s/);
  assert.match((await conferirPonto('https://x', inicio, { fetch: async () => { throw new TypeError('fetch failed'); } })).motivo, /não conectou/);
  assert.equal((await conferirPonto('https://x', inicio, { fetch: async () => new Response('<html>') })).ok, false, 'sem content-type de HTML');
  assert.equal((await conferirPonto('https://x', dados, { fetch: async () => new Response('não é json') })).ok, false);
});

test('linkDaExecucao monta o link do robô só com as três variáveis', () => {
  assert.equal(linkDaExecucao({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'a/b', GITHUB_RUN_ID: '7' }), 'https://github.com/a/b/actions/runs/7');
  assert.equal(linkDaExecucao({}), null);
});

// =========================================================================
// 3. Vigia: ofertas paradas, PR sem merge, robôs com falha, erros
// =========================================================================

test('diasEntre e prazoDoAmbiente', () => {
  assert.equal(diasEntre('2026-11-22', '2026-12-01'), 9);
  assert.equal(diasEntre('2026-02-28', '2026-03-01'), 1);
  assert.equal(prazoDoAmbiente(undefined), PRAZO_PADRAO_DIAS);
  assert.equal(prazoDoAmbiente('10'), 10);
  assert.equal(prazoDoAmbiente('0'), PRAZO_PADRAO_DIAS);
  assert.equal(prazoDoAmbiente('abc'), PRAZO_PADRAO_DIAS);
});

test('conferirOfertas acusa quando a conferência mais recente passou do prazo', () => {
  const ofertas = [{ verificado_em: '2026-11-15' }, { verificado_em: '2026-11-22' }, { verificado_em: 'A_CONFIRMAR' }, { verificado_em: '2027-01-01' }, {}];
  const dentro = conferirOfertas(ofertas, '2026-11-30');
  assert.equal(dentro.problema, false);
  assert.match(dentro.resumo, /2026-11-22 \(8 dia/);
  const fora = conferirOfertas(ofertas, '2026-12-01');
  assert.equal(fora.problema, true);
  assert.equal(fora.titulo, 'Ofertas sem atualização há 9 dias');
  assert.match(fora.corpo, /npm run coletar/);
  assert.equal(conferirOfertas(ofertas, '2026-12-01', 10).problema, false);
});

test('conferirOfertas não acusa antes de a operação começar', () => {
  assert.equal(conferirOfertas([], '2026-12-01').problema, false);
  assert.equal(conferirOfertas(null, '2026-12-01').problema, false);
});

test('conferirPrsDeOfertas acusa PR de ofertas aberto há mais de 3 dias', () => {
  const agora = new Date('2026-12-10T12:00:00Z');
  const prs = [
    { number: 40, head: { ref: 'ofertas/2026-12-01' }, created_at: '2026-12-01T12:00:00Z' },
    { number: 41, head: { ref: 'ofertas/2026-12-09' }, created_at: '2026-12-09T12:00:00Z' },
    { number: 42, head: { ref: 'claude/outra-coisa' }, created_at: '2026-11-01T12:00:00Z' },
    { number: 43 },
  ];
  const r = conferirPrsDeOfertas(prs, agora);
  assert.equal(r.problema, true);
  assert.match(r.corpo, /#40 \(ofertas\/2026-12-01\)/);
  assert.ok(!r.corpo.includes('#41'));
  assert.equal(conferirPrsDeOfertas(undefined, agora).problema, false);
});

test('conferirRobos olha só a última execução de cada robô e ignora os que têm alerta próprio', () => {
  const execucoes = [
    { workflow_id: 1, name: 'alertas', status: 'completed', conclusion: 'failure', created_at: '2026-12-01T10:00:00Z', html_url: 'u1' },
    { workflow_id: 1, name: 'alertas', status: 'completed', conclusion: 'success', created_at: '2026-12-02T10:00:00Z', html_url: 'u2' },
    { workflow_id: 2, name: 'custos', status: 'completed', conclusion: 'success', created_at: '2026-12-01T10:00:00Z', html_url: 'u3' },
    { workflow_id: 2, name: 'custos', status: 'completed', conclusion: 'timed_out', created_at: '2026-12-02T10:00:00Z', html_url: 'u4' },
    { workflow_id: 3, name: 'testes', status: 'in_progress', conclusion: null, created_at: '2026-12-03T10:00:00Z' },
    { workflow_id: 4, name: 'backup', status: 'completed', conclusion: 'failure', created_at: '2026-12-03T10:00:00Z' },
    { workflow_id: 5, name: 'ativo', status: 'completed', conclusion: 'failure', created_at: '2026-12-03T10:00:00Z', html_url: 'u5' },
  ];
  const r = conferirRobos(execucoes);
  assert.equal(r.problema, true);
  assert.equal(r.titulo, 'Robô com falha: ativo, custos');
  assert.match(r.corpo, /- custos: u4/);
  assert.ok(!r.corpo.includes('alertas'));
  assert.equal(conferirRobos([]).problema, false);
  assert.equal(conferirRobos(undefined).resumo, '0 robô(s) conferido(s), nenhum com falha');
});

test('conferirErros: desligado sem Supabase; acusa erro 500 ou 20 erros em 24 h', () => {
  assert.equal(conferirErros(null).desligado, true);
  assert.equal(conferirErros({ erros_24h: 3, erros_500_24h: 0 }).problema, false);
  assert.equal(conferirErros({ erros_24h: 1, erros_500_24h: 1 }).problema, true);
  assert.equal(conferirErros({ erros_24h: 20, erros_500_24h: 0 }).problema, true);
  assert.equal(conferirErros({}).problema, false);
});

test('aplicarAlertas abre o que tem problema, fecha o que resolveu e pula o desligado', async () => {
  const gh = githubFalso({ abertas: [{ number: 7, title: '[operacao:robos-com-falha] x', body: 'antigo' }] });
  const feito = await aplicarAlertas(gh, [
    { chave: 'ofertas-paradas', problema: true, titulo: 'T', corpo: 'C' },
    { chave: 'robos-com-falha', problema: false },
    { chave: 'erros-servidor', desligado: true },
  ], { dono: 'dono', link: 'L' });
  assert.deepEqual(feito, [['ofertas-paradas', 'aberto'], ['robos-com-falha', 'fechado']]);
  assert.equal(gh.feito[0][1].body, 'C\n\nExecução do vigia: L\n');
  const semLink = githubFalso();
  await aplicarAlertas(semLink, [{ chave: 'x', problema: true, titulo: 'T', corpo: 'C' }]);
  assert.equal(semLink.feito[0][1].body, 'C\n');
});

test('lerGitHub busca PRs abertos e execuções da main', async () => {
  const f = fetchFalso([
    [(u) => u.includes('/pulls?'), respostaJson([{ number: 1 }])],
    [(u) => u.includes('/actions/runs?'), respostaJson({ workflow_runs: [{ id: 2 }] })],
  ]);
  assert.deepEqual(await lerGitHub({ token: 't', repositorio: 'a/b', fetch: f }), { prs: [{ number: 1 }], execucoes: [{ id: 2 }] });
  const vazio = fetchFalso([[(u) => u.includes('/pulls?'), respostaJson([])], [() => true, respostaJson({})]]);
  assert.deepEqual((await lerGitHub({ token: 't', repositorio: 'a/b', fetch: vazio })).execucoes, []);
  await assert.rejects(lerGitHub({ token: 't', repositorio: 'a/b', fetch: async () => new Response('', { status: 403 }) }), /respondeu 403/);
});

// =========================================================================
// 5. Painel de custos
// =========================================================================

test('centavosTextoParaNano converte o texto decimal sem usar número quebrado', () => {
  assert.equal(NANO_POR_CENTAVO, 10_000_000);
  assert.equal(centavosTextoParaNano('0'), 0);
  assert.equal(centavosTextoParaNano('1'), 10_000_000);
  assert.equal(centavosTextoParaNano('123.45'), 1_234_500_000);
  assert.equal(centavosTextoParaNano('0.0000001'), 1);
  assert.equal(centavosTextoParaNano('0.123456789'), 1_234_567, 'abaixo de 1 nanodólar é descartado');
  assert.equal(centavosTextoParaNano(' 7 '), 70_000_000);
  assert.throws(() => centavosTextoParaNano('-1'), /inválido/);
  assert.throws(() => centavosTextoParaNano('1e3'), /inválido/);
  assert.throws(() => centavosTextoParaNano(undefined), /inválido/);
  assert.throws(() => centavosTextoParaNano('9'.repeat(20)), /grande demais/);
});

test('periodoDoMes vai do dia 1 (UTC) até a hora cheia atual', () => {
  assert.deepEqual(periodoDoMes(new Date('2026-11-24T13:45:10Z')), { inicio: '2026-11-01T00:00:00.000Z', fim: '2026-11-24T13:00:00.000Z', vazio: false });
  assert.equal(periodoDoMes(new Date('2026-12-01T00:20:00Z')).vazio, true);
});

test('gastoAnthropic soma todas as linhas e páginas da API de custos', async () => {
  const chave = ['sk', 'ant', 'admin01', 'E'.repeat(30)].join('-');
  const f = fetchFalso([
    [(u) => !u.includes('page='), respostaJson({ data: [{ amount: '150.5' }, { amount: null }, { results: [{ amount: '10' }, {}] }], has_more: true, next_page: 'p2' })],
    [(u) => u.includes('page=p2'), respostaJson({ data: [{ amount: '39.5' }], has_more: false })],
  ]);
  const nano = await gastoAnthropic({ chave, agora: new Date('2026-11-24T13:45:00Z'), fetch: f });
  assert.equal(nano, 200 * NANO_POR_CENTAVO);
  const primeira = new URL(f.chamadas[0].url);
  assert.equal(primeira.pathname, '/v1/organizations/analytics/cost');
  assert.equal(primeira.searchParams.get('starting_at'), '2026-11-01T00:00:00.000Z');
  assert.equal(primeira.searchParams.get('ending_at'), '2026-11-24T13:00:00.000Z');
  assert.equal(f.chamadas[0].opcoes.headers['x-api-key'], chave);
  assert.equal(f.chamadas[0].opcoes.headers['anthropic-beta'], 'analytics-usage-cost-2026-08-24');
  assert.equal(await gastoAnthropic({ chave, agora: new Date('2026-12-01T00:10:00Z'), fetch: async () => assert.fail('não devia chamar') }), 0);
  await assert.rejects(gastoAnthropic({ chave, agora: new Date('2026-11-24T13:00:00Z'), fetch: async () => respostaJson({}, 401) }), /respondeu 401/);
  const semFim = async () => respostaJson({ data: [], has_more: true, next_page: 'x' });
  await assert.rejects(gastoAnthropic({ chave, agora: new Date('2026-11-24T13:00:00Z'), fetch: semFim }), /páginas demais/);
  const semDados = async () => respostaJson({ has_more: false });
  assert.equal(await gastoAnthropic({ chave, agora: new Date('2026-11-24T13:00:00Z'), fetch: semDados }), 0);
});

test('formatar arredonda só para mostrar, no jeito brasileiro', () => {
  assert.equal(formatar(1_234_567_890_123, 'nano_usd'), 'US$ 1.234,57');
  assert.equal(formatar(500, 'centavos_usd'), 'US$ 5,00');
  assert.equal(formatar(524_288_000, 'bytes'), '500,0 MB');
  assert.equal(formatar(3 * 1024 ** 3, 'bytes'), '3,0 GB');
  assert.equal(formatar(1500, 'bytes'), '2 KB');
  assert.equal(formatar(3000, 'emails'), '3.000');
  assert.equal(percentual(79, 100), 79);
  assert.equal(percentual(1, 0), null);
});

test('montarPainel compara cada cota com o limite e acusa a partir de 80%', async () => {
  const config = JSON.parse(await readFile(new URL('../operacao/custos.json', import.meta.url), 'utf8'));
  const painel = montarPainel(config, {
    anthropic_custo_mes: 850 * NANO_POR_CENTAVO,
    supabase_banco_bytes: 10 * 1024 ** 2,
    emails_mes: 3000,
    // emails_24h sem medição
  });
  const porCota = Object.fromEntries(painel.linhas.map((l) => [l.cota, l]));
  assert.equal(porCota['Gasto no mês'].usado, 'US$ 8,50');
  assert.equal(porCota['Gasto no mês'].limiteTexto, 'US$ 10,00');
  assert.equal(porCota['Gasto no mês'].pct, 85);
  assert.equal(porCota['Gasto no mês'].situacao, 'ATENÇÃO');
  assert.equal(porCota['Tamanho do banco'].situacao, 'ok');
  assert.equal(porCota['E-mails no mês'].situacao, 'LIMITE ESTOURADO');
  assert.equal(porCota['E-mails nas últimas 24 h'].situacao, 'sem medição (falta configurar)');
  assert.equal(porCota['-'].situacao, 'sem cota medida');
  assert.equal(painel.problema, true);
  assert.equal(painel.estourado, true);
  assert.equal(painel.totalNano, 850 * NANO_POR_CENTAVO);
  const texto = textoDoPainel(painel, { hoje: '2026-11-24' });
  assert.match(texto, /## Custos do mês \(até 2026-11-24\)/);
  assert.match(texto, /\| 85% \| ATENÇÃO \|/);
  assert.match(texto, /Total do mês até agora \(fixos \+ medidos\): \*\*US\$ 8,50\*\*/);
  assert.match(textoDoPainel(painel), /## Custos do mês\n/);
});

test('montarPainel sem nenhuma medição não alerta; custo fixo entra no total', () => {
  const config = { servicos: [{ nome: 'Banco', plano: 'Pro', custo_fixo_centavos_usd: 2500, cotas: [{ nome: 'Gasto', unidade: 'centavos_usd', limite: 5000, medicao: 'x' }] }] };
  const painel = montarPainel(config, {});
  assert.equal(painel.alertaEm, 80);
  assert.equal(painel.problema, false);
  assert.equal(formatar(painel.totalNano, 'nano_usd'), 'US$ 25,00');
});

test('medir junta Anthropic e Supabase e segue em frente quando um falha', async () => {
  const f = fetchFalso([
    [(u) => u.includes('api.anthropic.com'), respostaJson({ data: [{ amount: '100' }], has_more: false })],
    [(u) => u.includes('/rpc/operacao_resumo'), respostaJson({ banco_bytes: 1000, emails_mes: 5, emails_24h: 1 })],
  ]);
  const env = { ANTHROPIC_ADMIN_KEY: 'k', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 's' };
  const tudo = await medir(env, { fetch: f, agora: new Date('2026-11-24T13:00:00Z') });
  assert.deepEqual(tudo, { medidas: { anthropic_custo_mes: 100 * NANO_POR_CENTAVO, supabase_banco_bytes: 1000, emails_mes: 5, emails_24h: 1 }, avisos: [] });
  const quebrado = await medir(env, { fetch: async () => respostaJson({}, 500), agora: new Date('2026-11-24T13:00:00Z') });
  assert.deepEqual(quebrado.medidas, {});
  assert.equal(quebrado.avisos.length, 2);
  assert.deepEqual(await medir({}), { medidas: {}, avisos: [] });
});

test('clienteOperacao chama só as duas funções da migração, com a chave no cabeçalho', async () => {
  assert.equal(clienteOperacao({ url: 'https://x.supabase.co', chave: '' }), null);
  assert.equal(clienteOperacao({ url: 'ftp://x', chave: 'k' }), null);
  const f = fetchFalso([[() => true, respostaJson(3)]]);
  const banco = clienteOperacao({ url: 'https://x.supabase.co/', chave: CHAVE_SUPABASE, fetch: f });
  assert.equal(await banco.limparErros(30), 3);
  assert.equal(f.chamadas[0].url, 'https://x.supabase.co/rest/v1/rpc/operacao_limpar_erros');
  assert.deepEqual(JSON.parse(f.chamadas[0].opcoes.body), { dias: 30 });
  assert.equal(f.chamadas[0].opcoes.headers.apikey, CHAVE_SUPABASE);
  await banco.resumo();
  assert.equal(f.chamadas[1].url, 'https://x.supabase.co/rest/v1/rpc/operacao_resumo');
});

// =========================================================================
// Arquivos da operação
// =========================================================================

test('custos.json: limites em inteiros, toda linha com fonte e data', async () => {
  const config = JSON.parse(await readFile(new URL('../operacao/custos.json', import.meta.url), 'utf8'));
  assert.ok(Number.isInteger(config.alerta_percentual));
  for (const s of config.servicos) {
    assert.match(s.fonte_url, /^https:\/\//);
    assert.match(s.verificado_em, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isInteger(s.custo_fixo_centavos_usd));
    for (const c of s.cotas) {
      assert.ok(Number.isInteger(c.limite) && c.limite > 0, `${s.id}/${c.id}`);
      assert.ok(['centavos_usd', 'bytes', 'emails'].includes(c.unidade));
    }
  }
});

test('robôs da operação: actions fixadas por SHA, sem segredo escrito e com permissões mínimas', async () => {
  for (const nome of ['disponibilidade', 'vigia', 'custos', 'backup']) {
    const yml = await readFile(new URL(`../.github/workflows/${nome}.yml`, import.meta.url), 'utf8');
    for (const uso of yml.match(/uses:\s*\S+/g) ?? []) assert.match(uso, /@[0-9a-f]{40}$/, `${nome}: ${uso}`);
    assert.match(yml, /permissions:\n\s+contents: read\n\s+issues: write/);
    assert.ok(!/contents: write/.test(yml), `${nome} não precisa escrever no repositório`);
    // Segredo só por ${{ secrets.X }}, nunca valor escrito.
    assert.ok(!/(SENHA|KEY|SECRETA|URL):\s*['"][^$]/.test(yml), nome);
  }
});

test('docs/operacao.md cobre as seis partes pedidas', async () => {
  const doc = await readFile(new URL('../docs/operacao.md', import.meta.url), 'utf8');
  for (const parte of ['Monitor de disponibilidade', 'Logs de erro', 'Atualização de ofertas', 'Backup', 'Painel de custos', 'Plano de resposta a incidente']) {
    assert.ok(doc.includes(parte), `falta a parte "${parte}"`);
  }
});
