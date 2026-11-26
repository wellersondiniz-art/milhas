// Alertas por e-mail: rotas HTTP (Pages Functions), clientes do Supabase e do
// Resend (com fetch falso), o script da rodada semanal e as partes puras do
// formulário do site.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MENSAGENS, configurado, tratarCancelar, tratarConfirmar, tratarInscricao } from '../servidor/alertas/pedido.js';
import { repositorioSupabase, ErroDoBanco } from '../servidor/alertas/supabase.js';
import { clienteResend, ErroDeEnvio } from '../servidor/alertas/resend.js';
import { dependencias, leitorDeDados } from '../servidor/alertas/cloudflare.js';
import { faltando, principal, textoDoResumo } from '../scripts/alertas/enviar.js';
import { conferirCampos, montarCorpo, mensagemDaResposta, resumoDoPerfil } from '../site/js/alertas/pedido.js';
import { onRequest as rotaInscrever } from '../functions/api/alertas/inscrever.js';
import { onRequest as rotaConfirmar } from '../functions/api/alertas/confirmar.js';
import { onRequest as rotaCancelar } from '../functions/api/alertas/cancelar.js';
import {
  PERFIL_COM_CLUBE, SEGREDO, SEGREDO_IP, URL_SITE, cancelarDoEmail, correioFalso, dadosDeTeste, repoEmMemoria, tokenDoEmail,
} from './alertas/apoio.mjs';

const dados = dadosDeTeste();
const AGORA = new Date('2026-11-10T15:00:00Z');

function deps(extra = {}) {
  return {
    repo: repoEmMemoria(), correio: correioFalso(), segredo: SEGREDO, segredoIp: SEGREDO_IP, urlSite: URL_SITE,
    buscarDados: async () => dados, agora: () => AGORA, ...extra,
  };
}

const CORPO_BOM = {
  email: 'pessoa@exemplo.com', loja_id: 'loja-teste', programa_id: null, pontos_por_real: '10',
  perfil: PERFIL_COM_CLUBE, consentimento: true, site: '', tempo_no_formulario_ms: 9000,
};

function pedidoJson(corpo, { origem = URL_SITE, tipo = 'application/json', metodo = 'POST', extras = {} } = {}) {
  return new Request(`${URL_SITE}/api/alertas/inscrever`, {
    method: metodo,
    headers: { ...(origem ? { Origin: origem } : {}), 'Content-Type': tipo, ...extras },
    body: metodo === 'POST' ? (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Inscrição

test('inscrever: pedido certo responde 202 e manda UM e-mail de confirmação', async () => {
  const d = deps();
  const r = await tratarInscricao(pedidoJson(CORPO_BOM), d);
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { ok: true, mensagem: MENSAGENS.recebido });
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal(d.correio.enviados.length, 1);
  assert.match(d.correio.enviados[0].texto, new RegExp(`${URL_SITE}/api/alertas/confirmar\\?t=`));
});

test('inscrever: resposta igual para e-mail novo, repetido, confirmado e no limite (sem enumeração)', async () => {
  const d = deps();
  const respostas = [];
  for (let i = 0; i < 5; i++) {
    const r = await tratarInscricao(pedidoJson(CORPO_BOM), d);
    respostas.push([r.status, await r.text()]);
  }
  assert.equal(new Set(respostas.map((r) => JSON.stringify(r))).size, 1);
  assert.equal(d.correio.enviados.length, 3);
});

test('inscrever: limite por IP (S1): o 11º pedido do mesmo IP no dia é recusado, sem e-mail', async () => {
  const d = deps();
  const doIp = (ip, i) => pedidoJson({ ...CORPO_BOM, email: `p${i}@exemplo.com` }, { extras: { 'CF-Connecting-IP': ip } });
  for (let i = 0; i < 10; i++) assert.equal((await tratarInscricao(doIp('203.0.113.7', i), d)).status, 202);
  const r = await tratarInscricao(doIp('203.0.113.7', 10), d);
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { ok: false, mensagem: MENSAGENS.muitosDoMesmoLugar });
  assert.equal(r.headers.get('Retry-After'), '3600');
  assert.equal(d.correio.enviados.length, 10);
  assert.ok(d.repo.log.some((l) => l.resultado === 'limite' && l.quantidade_alertas === 0));
  // Outro IP continua passando.
  assert.equal((await tratarInscricao(doIp('198.51.100.2', 11), d)).status, 202);
  // O contador não guarda o IP, só o resumo.
  assert.ok(![...d.repo.contadores.keys()].some((k) => k.includes('203.0.113.7')));
  assert.ok([...d.repo.contadores.keys()].every((k) => /^(ip:[0-9a-f]{64}|total):2026-11-10$/.test(k)));
});

test('inscrever: teto do dia somando todo mundo (S1): passa de 80, ninguém mais recebe e-mail hoje', async () => {
  const d = deps();
  for (let i = 0; i < 80; i++) {
    const r = await tratarInscricao(pedidoJson({ ...CORPO_BOM, email: `t${i}@exemplo.com` }, { extras: { 'CF-Connecting-IP': `10.0.${Math.floor(i / 10)}.${i}` } }), d);
    assert.equal(r.status, 202);
  }
  const r = await tratarInscricao(pedidoJson({ ...CORPO_BOM, email: 'ultimo@exemplo.com' }, { extras: { 'CF-Connecting-IP': '10.9.9.9' } }), d);
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { ok: false, mensagem: MENSAGENS.muitosNoDia });
  assert.equal(d.correio.enviados.length, 80);
});

test('inscrever: contador fora do ar responde 503 e não manda e-mail', async () => {
  const d = deps();
  d.repo.contar = async () => { throw new ErroDoBanco('contar pedido', 500); };
  assert.equal((await tratarInscricao(pedidoJson(CORPO_BOM), d)).status, 503);
  assert.equal(d.correio.enviados.length, 0);
});

test('inscrever: pedidos ao mesmo tempo não furam o limite (a contagem é do banco)', async () => {
  const d = deps();
  const respostas = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    tratarInscricao(pedidoJson({ ...CORPO_BOM, email: `c${i}@exemplo.com` }, { extras: { 'CF-Connecting-IP': '203.0.113.9' } }), d)));
  assert.equal(respostas.filter((r) => r.status === 202).length, 10);
  assert.equal(respostas.filter((r) => r.status === 429).length, 20);
});

test('inscrever: travas na ordem (configuração, método, origem, tipo, tamanho, JSON)', async () => {
  assert.equal((await tratarInscricao(pedidoJson(CORPO_BOM), deps({ correio: null }))).status, 503);
  assert.equal((await tratarInscricao(pedidoJson(CORPO_BOM), deps({ segredo: 'curto' }))).status, 503);
  assert.equal((await tratarInscricao(pedidoJson(null, { metodo: 'GET' }), deps())).status, 405);
  assert.equal((await tratarInscricao(pedidoJson(CORPO_BOM, { origem: 'https://outro.exemplo' }), deps())).status, 403);
  assert.equal((await tratarInscricao(pedidoJson(CORPO_BOM, { origem: null }), deps())).status, 403);
  assert.equal((await tratarInscricao(pedidoJson(CORPO_BOM, { extras: { 'Sec-Fetch-Site': 'cross-site' } }), deps())).status, 403);
  assert.equal((await tratarInscricao(pedidoJson(CORPO_BOM, { tipo: 'text/plain' }), deps())).status, 415);
  assert.equal((await tratarInscricao(pedidoJson({ ...CORPO_BOM, x: 'a'.repeat(9000) }), deps())).status, 413);
  assert.equal((await tratarInscricao(pedidoJson('{quebrado'), deps())).status, 400);
  assert.equal((await tratarInscricao(pedidoJson('[1]'), deps())).status, 400);
});

test('inscrever: armadilhas de robô respondem "ok" e não fazem nada', async () => {
  for (const corpo of [{ ...CORPO_BOM, site: 'http://spam' }, { ...CORPO_BOM, tempo_no_formulario_ms: 500 }, { ...CORPO_BOM, tempo_no_formulario_ms: undefined }]) {
    const d = deps();
    const r = await tratarInscricao(pedidoJson(corpo), d);
    assert.equal(r.status, 202);
    assert.equal(d.correio.enviados.length, 0);
    assert.equal(d.repo.inscricoes.size, 0);
  }
});

test('inscrever: campos errados → 422 com a mensagem de cada campo; dados fora do ar → 503', async () => {
  const r = await tratarInscricao(pedidoJson({ ...CORPO_BOM, email: 'x', consentimento: false }), deps());
  assert.equal(r.status, 422);
  const corpo = await r.json();
  assert.deepEqual(Object.keys(corpo.erros).sort(), ['consentimento', 'email']);
  const semDados = await tratarInscricao(pedidoJson(CORPO_BOM), deps({ buscarDados: async () => { throw new Error('x'); } }));
  assert.equal(semDados.status, 503);
});

test('inscrever: banco fora do ar → 503, sem e-mail no log', async (t) => {
  const erros = t.mock.method(console, 'error', () => {});
  const d = deps();
  d.repo.inscricaoPorEmail = async () => { throw new ErroDoBanco('ler inscrição', 500); };
  const r = await tratarInscricao(pedidoJson(CORPO_BOM), d);
  assert.equal(r.status, 503);
  assert.equal(erros.mock.calls.length, 1);
  assert.ok(!String(erros.mock.calls[0].arguments[0]).includes('@'));
  const d2 = deps();
  d2.correio.falhar = true;
  assert.equal((await tratarInscricao(pedidoJson(CORPO_BOM), d2)).status, 202, 'erro do Resend não muda a resposta');
});

// ---------------------------------------------------------------------------
// Confirmar e cancelar (páginas HTML)

async function inscritoComEmail(d) {
  await tratarInscricao(pedidoJson(CORPO_BOM), d);
  return d.correio.enviados.at(-1);
}

function postForm(caminho, campos) {
  return new Request(`${URL_SITE}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos).toString(),
  });
}

test('confirmar: GET só mostra o botão (não confirma); POST confirma; CSP fechada', async () => {
  const d = deps();
  const email = await inscritoComEmail(d);
  const token = tokenDoEmail(email);
  const pagina = await tratarConfirmar(new Request(`${URL_SITE}/api/alertas/confirmar?t=${token}`), d);
  assert.equal(pagina.status, 200);
  const html = await pagina.text();
  assert.match(html, /<form method="post" action="\/api\/alertas\/confirmar">/);
  assert.ok(html.includes(`value="${token}"`));
  assert.equal([...d.repo.inscricoes.values()][0].confirmado_em, null, 'GET não confirma');
  const csp = pagina.headers.get('Content-Security-Policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /style-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.equal(pagina.headers.get('X-Robots-Tag'), 'noindex');
  assert.ok(!/<script/i.test(html));

  const feito = await tratarConfirmar(postForm('/api/alertas/confirmar', { t: token }), d);
  assert.equal(feito.status, 200);
  assert.match(await feito.text(), /Alerta confirmado/);
  assert.ok([...d.repo.inscricoes.values()][0].confirmado_em);
  const deNovo = await tratarConfirmar(postForm('/api/alertas/confirmar', { t: token }), d);
  assert.equal(deNovo.status, 400);
  assert.match(await deNovo.text(), /vencido ou já usado/);
});

test('confirmar: hash do estilo na CSP bate com o <style> da página', async () => {
  const { createHash } = await import('node:crypto');
  const pagina = await tratarConfirmar(new Request(`${URL_SITE}/api/alertas/confirmar?t=${'a'.repeat(43)}`), deps());
  const html = await pagina.text();
  const estilo = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const hash = createHash('sha256').update(estilo).digest('base64');
  assert.ok(pagina.headers.get('Content-Security-Policy').includes(`'sha256-${hash}'`));
});

test('confirmar: link quebrado, método errado, corpo errado, limite de alertas e banco fora', async (t) => {
  t.mock.method(console, 'error', () => {});
  const d = deps();
  assert.equal((await tratarConfirmar(new Request(`${URL_SITE}/api/alertas/confirmar?t=x`), d)).status, 400);
  assert.equal((await tratarConfirmar(new Request(`${URL_SITE}/api/alertas/confirmar`, { method: 'PUT' }), d)).status, 405);
  const semTipo = new Request(`${URL_SITE}/api/alertas/confirmar`, { method: 'POST', body: 't=1' });
  assert.equal((await tratarConfirmar(semTipo, d)).status, 400);
  assert.equal((await tratarConfirmar(new Request(`${URL_SITE}/api/alertas/confirmar?t=x`), deps({ repo: null }))).status, 503);

  const cheio = deps();
  const email = await inscritoComEmail(cheio);
  cheio.repo.alertasDe = async () => Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, loja_id: `loja-${i}`, programa_id: null }));
  const r = await tratarConfirmar(postForm('/api/alertas/confirmar', { t: tokenDoEmail(email) }), cheio);
  assert.equal(r.status, 409);
  assert.match(await r.text(), /até 10 alertas/);

  const fora = deps();
  const email2 = await inscritoComEmail(fora);
  fora.repo.inscricaoPorToken = async () => { throw new ErroDoBanco('ler inscrição', 500); };
  assert.equal((await tratarConfirmar(postForm('/api/alertas/confirmar', { t: tokenDoEmail(email2) }), fora)).status, 503);
});

test('cancelar: GET mostra o botão; POST (botão ou um clique do provedor) apaga tudo', async () => {
  const d = deps();
  const email = await inscritoComEmail(d);
  const { i, a } = cancelarDoEmail(email);
  const url = `${URL_SITE}/api/alertas/cancelar?i=${i}&a=${a}`;
  const pagina = await tratarCancelar(new Request(url), d);
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /Cancelar e apagar meu e-mail/);
  assert.equal(d.repo.inscricoes.size, 1, 'GET não apaga');
  // "Cancelar em um clique" (RFC 8058): POST sem Origin, corpo List-Unsubscribe=One-Click.
  const umClique = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  const feito = await tratarCancelar(umClique, d);
  assert.equal(feito.status, 200);
  assert.match(await feito.text(), /Alertas cancelados/);
  assert.equal(d.repo.inscricoes.size, 0);
});

test('cancelar: link incompleto, assinatura errada, método errado e banco fora', async (t) => {
  t.mock.method(console, 'error', () => {});
  const d = deps();
  const email = await inscritoComEmail(d);
  const { i, a } = cancelarDoEmail(email);
  assert.equal((await tratarCancelar(new Request(`${URL_SITE}/api/alertas/cancelar?i=${i}`), d)).status, 400);
  assert.equal((await tratarCancelar(new Request(`${URL_SITE}/api/alertas/cancelar?i=${i}&a=${'b'.repeat(43)}`, { method: 'POST' }), d)).status, 400);
  assert.equal((await tratarCancelar(new Request(`${URL_SITE}/api/alertas/cancelar?i=${i}&a=${a}`, { method: 'DELETE' }), d)).status, 405);
  assert.equal(d.repo.inscricoes.size, 1);
  assert.equal((await tratarCancelar(new Request(`${URL_SITE}/api/alertas/cancelar`), deps({ correio: null }))).status, 503);
  d.repo.apagarInscricao = async () => { throw new ErroDoBanco('apagar inscrição', 500); };
  assert.equal((await tratarCancelar(new Request(`${URL_SITE}/api/alertas/cancelar?i=${i}&a=${a}`, { method: 'POST' }), d)).status, 503);
});

test('configurado: exige banco, correio, segredo de 32+ e endereço', () => {
  assert.equal(configurado(deps()), true);
  for (const falta of [{ repo: null }, { correio: null }, { segredo: undefined }, { segredoIp: undefined }, { segredoIp: 'curto' }, { urlSite: '' }]) {
    assert.equal(configurado(deps(falta)), false);
  }
});

// ---------------------------------------------------------------------------
// Pages Functions (ligação com o ambiente da Cloudflare)

test('functions/api/alertas: sem variáveis de ambiente, tudo responde 503', async () => {
  const env = { ASSETS: { fetch: async () => new Response('[]') } };
  const r1 = await rotaInscrever({ request: pedidoJson(CORPO_BOM), env });
  assert.equal(r1.status, 503);
  const r2 = await rotaConfirmar({ request: new Request(`${URL_SITE}/api/alertas/confirmar?t=x`), env });
  assert.equal(r2.status, 503);
  const r3 = await rotaCancelar({ request: new Request(`${URL_SITE}/api/alertas/cancelar`), env });
  assert.equal(r3.status, 503);
});

test('cloudflare: monta as dependências do ambiente e lê os dados publicados do próprio site', async () => {
  const pedidos = [];
  const env = {
    SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SECRET_KEY: 'chave', RESEND_API_KEY: 'chave', ALERTAS_REMETENTE: 'Milhas <a@b.c>', ALERTAS_SEGREDO: SEGREDO, IP_SEGREDO: SEGREDO_IP,
    ASSETS: { fetch: async (url) => { pedidos.push(String(url)); return new Response(JSON.stringify(dados[/dados\/(\w+)\.json/.exec(url)[1]])); } },
  };
  const request = new Request('https://milhasdavez.com.br/api/alertas/inscrever');
  const d = dependencias(env, request);
  assert.equal(configurado(d), true);
  assert.equal(d.urlSite, 'https://milhasdavez.com.br');
  assert.ok(d.agora() instanceof Date);
  const lidos = await d.buscarDados();
  assert.deepEqual(Object.keys(lidos).sort(), ['cartoes', 'lojas', 'ofertas', 'programas']);
  assert.ok(pedidos.every((u) => u.startsWith('https://milhasdavez.com.br/dados/')));
  const quebrado = leitorDeDados({ ASSETS: { fetch: async () => new Response('x', { status: 404 }) } }, request);
  await assert.rejects(quebrado, /404/);
  const naoLista = leitorDeDados({ ASSETS: { fetch: async () => new Response('{}') } }, request);
  await assert.rejects(naoLista, /não é lista/);
});

// ---------------------------------------------------------------------------
// Clientes (fetch falso)

function fetchFalso(respostas) {
  const chamadas = [];
  const buscar = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), ...opcoes });
    const r = respostas.shift() ?? { status: 200, corpo: [] };
    return new Response(r.status === 204 ? null : (typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo)), { status: r.status });
  };
  return { buscar, chamadas };
}

test('supabase: contador do limite chama a função atômica do banco e apaga dias antigos', async () => {
  const { buscar, chamadas } = fetchFalso([{ status: 200, corpo: 4 }, { status: 200, corpo: [{ chave: 'a' }, { chave: 'b' }] }, { status: 200, corpo: '' }]);
  const repo = repositorioSupabase({ url: 'https://abc.supabase.co', chave: 'k', fetch: buscar });
  assert.equal(await repo.contar('total:2026-11-10', '2026-11-10'), 4);
  assert.equal(chamadas[0].url, 'https://abc.supabase.co/rest/v1/rpc/alertas_contar');
  assert.equal(chamadas[0].method, 'POST');
  assert.deepEqual(JSON.parse(chamadas[0].body), { p_chave: 'total:2026-11-10', p_dia: '2026-11-10' });
  assert.equal(await repo.apagarContadoresAntes('2026-11-08'), 2);
  assert.equal(chamadas[1].url, 'https://abc.supabase.co/rest/v1/alertas_contadores?dia=lt.2026-11-08&select=chave');
  assert.equal(chamadas[1].method, 'DELETE');
  assert.equal(await repo.apagarContadoresAntes('2026-11-08'), 0);
});

test('supabase: chave só no cabeçalho apikey, filtros com encode, erros sem corpo', async () => {
  assert.equal(repositorioSupabase({ url: '', chave: 'x' }), null);
  assert.equal(repositorioSupabase({ url: 'http://inseguro.exemplo', chave: 'x' }), null);
  assert.equal(repositorioSupabase({ url: 'https://abc.supabase.co/', chave: '' }), null);
  const { buscar, chamadas } = fetchFalso([
    { status: 200, corpo: [{ id: '1', email: 'a+b@exemplo.com' }] },
    { status: 200, corpo: [] },
    { status: 201, corpo: [{ id: '2' }] },
    { status: 204 },
    { status: 204 },
    { status: 200, corpo: [{ id: '3' }, { id: '4' }] },
    { status: 200, corpo: '' },
    { status: 201, corpo: [{ id: 'a1' }] },
    { status: 204 },
    { status: 201, corpo: '' },
    { status: 200, corpo: [{ id: '5' }] },
    { status: 500, corpo: { message: 'detalhe com e-mail a@b.c' } },
  ]);
  const repo = repositorioSupabase({ url: 'https://abc.supabase.co/', chave: 'sb_secret_teste', fetch: buscar });
  assert.deepEqual(await repo.inscricaoPorEmail('a+b@exemplo.com'), { id: '1', email: 'a+b@exemplo.com' });
  assert.equal(chamadas[0].url, 'https://abc.supabase.co/rest/v1/alertas_inscricoes?select=*&email=eq.a%2Bb%40exemplo.com');
  assert.equal(chamadas[0].headers.apikey, 'sb_secret_teste');
  assert.equal(chamadas[0].headers.Authorization, undefined);
  assert.equal(await repo.inscricaoPorId('x'), null);
  assert.deepEqual(await repo.criarInscricao({ email: 'x@y.z' }), { id: '2' });
  assert.equal(chamadas[2].method, 'POST');
  assert.equal(chamadas[2].headers.Prefer, 'return=representation');
  await repo.atualizarInscricao('2', { pendente: null });
  assert.equal(chamadas[3].method, 'PATCH');
  await repo.apagarInscricao('2');
  assert.equal(chamadas[4].method, 'DELETE');
  assert.equal(await repo.apagarNaoConfirmadasVencidas(new Date('2026-11-10T00:00:00Z')), 2);
  assert.match(chamadas[5].url, /confirmado_em=is\.null&token_expira_em=lt\.2026-11-10T00%3A00%3A00\.000Z/);
  assert.deepEqual(await repo.alertasDe('2'), []);
  assert.deepEqual(await repo.criarAlerta({ loja_id: 'x' }), { id: 'a1' });
  await repo.atualizarAlerta('a1', { ultimo_aviso_chave: null });
  await repo.registrarEnvio({ tipo: 'alerta', resultado: 'enviado', quantidade_alertas: 1 });
  assert.deepEqual(await repo.inscricaoPorToken('f'.repeat(64)), { id: '5' });
  await assert.rejects(() => repo.inscricaoPorId('y'), (e) => e instanceof ErroDoBanco && e.status === 500 && !e.message.includes('@'));
});

test('supabase: lista as inscrições confirmadas em páginas de 500', async () => {
  const pagina = (n, inicio) => Array.from({ length: n }, (_, i) => ({ id: String(inicio + i), alertas_email: i === 0 ? null : [{ id: 'a' }] }));
  const { buscar, chamadas } = fetchFalso([{ status: 200, corpo: pagina(500, 0) }, { status: 200, corpo: pagina(3, 500) }]);
  const repo = repositorioSupabase({ url: 'https://abc.supabase.co', chave: 'k', fetch: buscar });
  const todas = [];
  for await (const i of repo.inscricoesConfirmadas()) todas.push(i);
  assert.equal(todas.length, 503);
  assert.deepEqual(todas[0].alertas, []);
  assert.deepEqual(todas[1].alertas, [{ id: 'a' }]);
  assert.equal(chamadas[1].headers.Range, '500-999');
  assert.match(chamadas[0].url, /confirmado_em=not\.is\.null/);
});

test('resend: um destinatário, chave no cabeçalho, idempotência e erro só com status', async () => {
  assert.equal(clienteResend({ chave: '', remetente: 'x' }), null);
  const { buscar, chamadas } = fetchFalso([{ status: 200, corpo: { id: 'm1' } }, { status: 422, corpo: { message: 'a@b.c inválido' } }]);
  const correio = clienteResend({ chave: 're_teste', remetente: 'Milhas da Vez <alertas@exemplo.com>', fetch: buscar });
  await correio.enviar({ para: 'a@exemplo.com', assunto: 'A', texto: 't', html: '<p>t</p>', cabecalhos: { 'List-Unsubscribe': '<x>' }, idempotencia: 'k1' });
  const corpo = JSON.parse(chamadas[0].body);
  assert.deepEqual(corpo.to, ['a@exemplo.com']);
  assert.equal(corpo.cc, undefined);
  assert.equal(corpo.bcc, undefined);
  assert.equal(corpo.headers['List-Unsubscribe'], '<x>');
  assert.equal(chamadas[0].headers.Authorization, 'Bearer re_teste');
  assert.equal(chamadas[0].headers['Idempotency-Key'], 'k1');
  await assert.rejects(() => correio.enviar({ para: 'a@exemplo.com', assunto: 'A', texto: 't' }), (e) => e instanceof ErroDeEnvio && e.status === 422 && !e.message.includes('@'));
  await assert.rejects(() => correio.enviar({ para: 'a@exemplo.com,b@exemplo.com', assunto: 'A', texto: 't' }), /um destinatário/);
});

// ---------------------------------------------------------------------------
// Script da rodada semanal

test('enviar.js: sem configuração avisa e sai com 0; diz só o NOME do que falta', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  assert.equal(await principal({ env: {}, argv: [] }), 0);
  assert.match(log.mock.calls[0].arguments[0], /Alertas desligados: faltam SUPABASE_URL, SUPABASE_SECRET_KEY, RESEND_API_KEY, ALERTAS_REMETENTE, ALERTAS_SEGREDO/);
  assert.deepEqual(faltando({ SUPABASE_URL: 'x', SUPABASE_SECRET_KEY: 'y' }, true), []);
});

test('enviar.js --simular: lê os dados do repositório, avalia e não envia', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const { buscar, chamadas } = fetchFalso([{ status: 200, corpo: [] }, { status: 200, corpo: [] }]);
  const codigo = await principal({
    env: { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x' }, argv: ['--simular'], agora: new Date('2026-11-26T15:00:00Z'), fetch: buscar,
  });
  assert.equal(codigo, 0);
  // Lê quem tem o plano pago e as inscrições; não apaga nem grava nada.
  assert.equal(chamadas.length, 2, 'simulação não apaga nem grava');
  assert.match(chamadas[0].url, /plano_assinaturas/);
  assert.ok(chamadas.every((c) => (c.method ?? 'GET') === 'GET'));
  assert.match(log.mock.calls.at(-1).arguments[0], /Simulação: nada foi enviado nem gravado/);
});

test('enviar.js: URL inválida e banco fora do ar saem com 1, sem corpo de resposta', async (t) => {
  const erro = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  const env = { SUPABASE_URL: 'http://inseguro', SUPABASE_SECRET_KEY: 'k', RESEND_API_KEY: 'r', ALERTAS_REMETENTE: 'x', ALERTAS_SEGREDO: SEGREDO };
  assert.equal(await principal({ env, argv: [], agora: new Date('2026-11-23T12:00:00Z') }), 1);
  const { buscar } = fetchFalso([{ status: 500, corpo: { message: 'segredo@vazado' } }]);
  assert.equal(await principal({ env: { ...env, SUPABASE_URL: 'https://abc.supabase.co' }, argv: [], agora: new Date('2026-11-23T12:00:00Z'), fetch: buscar }), 1);
  assert.ok(erro.mock.calls.every((c) => !String(c.arguments[0]).includes('@')));
});

test('enviar.js: resumo só com contagens', () => {
  const texto = textoDoResumo({
    simulacao: false, pedidos_vencidos_apagados: 1, inscricoes: 2, alertas_avaliados: 3, alertas_no_alvo: 1,
    emails_enviados: 1, emails_barrados_pelo_limite: 0, erros_de_envio: 0, erros_de_avaliacao: 0,
  });
  assert.match(texto, /Rodada de alertas concluída/);
  assert.match(texto, /E-mails enviados: 1/);
});

// ---------------------------------------------------------------------------
// Formulário do site (partes puras)

test('formulário: confere campos antes de enviar', () => {
  assert.deepEqual(conferirCampos({ loja_id: 'x', pontos_por_real: '2,5', email: 'a@b.co', consentimento: true }), {});
  assert.deepEqual(Object.keys(conferirCampos({ loja_id: '', pontos_por_real: '0', email: 'a', consentimento: false })).sort(),
    ['consentimento', 'email', 'loja_id', 'pontos_por_real']);
  assert.ok(conferirCampos({ loja_id: 'x', pontos_por_real: 'dez', email: 'a@b.co', consentimento: true }).pontos_por_real);
  assert.ok(conferirCampos({ loja_id: 'x', pontos_por_real: undefined, email: undefined, consentimento: true }).email);
});

test('formulário: corpo do pedido e resumo do perfil', () => {
  const corpo = montarCorpo({ email: ' a@b.co ', loja_id: 'loja-teste', programa_id: '', pontos_por_real: ' 10 ', consentimento: true }, PERFIL_COM_CLUBE, 3456.7);
  assert.deepEqual(corpo, {
    email: 'a@b.co', loja_id: 'loja-teste', programa_id: null, pontos_por_real: '10', consentimento: true,
    perfil: { programas: PERFIL_COM_CLUBE.programas, cartoes: PERFIL_COM_CLUBE.cartoes }, site: '', tempo_no_formulario_ms: 3457,
  });
  assert.equal(montarCorpo({ email: 'a', loja_id: 'x', pontos_por_real: '1', site: 'robô' }, null, -5).perfil, null);
  assert.equal(resumoDoPerfil(PERFIL_COM_CLUBE, dados), 'Programas: Programa Alfa (com clube). Cartões: Cartão Alfa Platinum.');
  assert.equal(resumoDoPerfil({ programas: [{ programa_id: 'programa-alfa' }, { programa_id: 'programa-beta' }, { programa_id: 'sumiu' }], cartoes: [] }, dados),
    'Programas: Programa Alfa, Programa Beta e sumiu.');
  assert.equal(resumoDoPerfil({ programas: [], cartoes: [] }, dados), null);
  assert.equal(resumoDoPerfil(null, dados), null);
});

test('formulário: mensagem da resposta do servidor', () => {
  assert.deepEqual(mensagemDaResposta(202, { ok: true, mensagem: 'ok' }), { ok: true, texto: 'ok', erros: {} });
  assert.deepEqual(mensagemDaResposta(422, { ok: false, mensagem: 'm', erros: { email: 'e' } }), { ok: false, texto: 'm', erros: { email: 'e' } });
  assert.match(mensagemDaResposta(429, null).texto, /Muitos pedidos/);
  assert.match(mensagemDaResposta(500, null).texto, /Não conseguimos/);
});
