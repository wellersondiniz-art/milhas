// Testes do modo app (PWA): manifesto, ícones, geração do service worker,
// estratégias de cache e textos do aviso de sem internet.
//
// O service worker roda aqui dentro de um "navegador de mentira" (node:vm),
// com caches, fetch e clients falsos. Assim dá para testar as regras sem abrir
// um navegador de verdade.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { calcularVersao, listarArquivosDoApp, montarSw } from '../scripts/gerar-sw.js';
import { avisoSemInternet, maisAntiga, quandoForamSalvos } from '../site/js/pwa/textos.js';

const raiz = new URL('../', import.meta.url);
const site = new URL('site/', raiz);
const ORIGEM = 'https://milhasdavez.pages.dev';

// ---------------------------------------------------------------------------
// Manifesto e ícones

function tamanhoPng(buffer) {
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG');
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test('manifesto tem nome, cores, start_url, standalone e ícones 192/512 normais e maskable', async () => {
  const m = JSON.parse(await readFile(new URL('manifest.webmanifest', site), 'utf8'));
  assert.equal(m.name, 'Milhas da Vez');
  assert.ok(m.short_name && m.short_name.length <= 15);
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.equal(m.lang, 'pt-BR');
  assert.equal(m.theme_color, '#1f6b3a');
  assert.equal(m.background_color, '#fbf6ec');
  for (const proposito of ['any', 'maskable']) {
    for (const tam of [192, 512]) {
      const icone = m.icons.find((i) => i.purpose === proposito && i.sizes === `${tam}x${tam}`);
      assert.ok(icone, `falta ícone ${proposito} ${tam}`);
      const png = await readFile(new URL(icone.src, site));
      assert.deepEqual(tamanhoPng(png), [tam, tam], `${icone.src} não tem ${tam}x${tam}`);
    }
  }
});

test('index.html liga o manifesto e os ícones', async () => {
  const html = await readFile(new URL('index.html', site), 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="img\/icones\/apple-touch-icon\.png">/);
  assert.match(html, /id="aviso-versao"/);
  assert.match(html, /id="aviso-conexao"/);
});

test('_headers manda conferir o sw.js a cada visita e a CSP permite o worker', async () => {
  const headers = await readFile(new URL('_headers', site), 'utf8');
  assert.match(headers, /\/sw\.js\n\s+Cache-Control: no-cache/);
  assert.match(headers, /worker-src 'self'/);
  assert.match(headers, /manifest-src 'self'/);
});

// ---------------------------------------------------------------------------
// Geração do sw.js

test('lista do app tem o essencial e deixa de fora vitrine, dados e páginas geradas', async () => {
  const lista = await listarArquivosDoApp(site);
  for (const a of ['index.html', 'offline.html', 'manifest.webmanifest', 'css/base.css', 'js/app.js', 'js/motor/calcular.js', 'js/pwa/pwa.js', 'img/icones/icone-192.png']) {
    assert.ok(lista.includes(a), `falta ${a}`);
  }
  assert.ok(!lista.includes('js/vitrine.js'));
  assert.ok(!lista.includes('estilo.html'));
  assert.ok(!lista.some((a) => a.startsWith('dados/') || a.startsWith('loja/') || a.startsWith('ofertas/')));
  assert.ok(!lista.includes('sw.js'));
  assert.equal(new Set(lista).size, lista.length);
});

test('versão muda quando um arquivo do app muda, e só então', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'sw-'));
  try {
    await cp(new URL('.', site), pasta, { recursive: true });
    const copia = pathToFileURL(`${pasta}/`);
    const lista = await listarArquivosDoApp(copia);
    const v1 = await calcularVersao(copia, lista);
    assert.equal(await calcularVersao(copia, lista), v1);
    await writeFile(new URL('css/estilo.css', copia), '/* mudou */', { flag: 'a' });
    const v2 = await calcularVersao(copia, lista);
    assert.notEqual(v2, v1);
    assert.match(v2, /^[0-9a-f]{12}$/);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test('montarSw recusa versão estranha e modelo sem as marcas', () => {
  assert.throws(() => montarSw("const VERSAO = '__VERSAO__';", { versao: "x'; alert(1)//", arquivos: [] }));
  assert.throws(() => montarSw('nada', { versao: 'abcdef012345', arquivos: [] }));
});

// ---------------------------------------------------------------------------
// Navegador de mentira

class CacheFalso {
  constructor() { this.itens = new Map(); }
  chave(pedido, ignoreSearch) {
    const url = new URL(typeof pedido === 'string' ? pedido : pedido.url, `${ORIGEM}/sw.js`);
    if (ignoreSearch) url.search = '';
    return url.href;
  }
  async match(pedido, opcoes = {}) {
    if (opcoes.ignoreSearch) {
      const alvo = this.chave(pedido, true);
      for (const [k, v] of this.itens) if (this.chave(k, true) === alvo) return v.clone();
      return undefined;
    }
    return this.itens.get(this.chave(pedido))?.clone();
  }
  async put(pedido, resposta) { this.itens.set(this.chave(pedido), resposta.clone()); }
  async addAll(pedidos) {
    for (const p of pedidos) {
      const r = await this.fetch(p);
      if (!r.ok) throw new Error(`addAll: ${p.url} ${r.status}`);
      await this.put(p, r);
    }
  }
}

function respostaBasica(corpo, { status = 200, headers = {} } = {}) {
  const r = new Response(corpo, { status, headers });
  Object.defineProperty(r, 'type', { value: 'basic' });
  const clonar = r.clone.bind(r);
  r.clone = () => { const c = clonar(); Object.defineProperty(c, 'type', { value: 'basic' }); return c; };
  return r;
}

async function carregarSw({ arquivos = ['index.html', 'offline.html', 'js/app.js', 'css/base.css'], versao = 'aaaaaaaaaaaa', rede } = {}) {
  const modelo = await readFile(new URL('scripts/pwa/sw-modelo.js', raiz), 'utf8');
  const codigo = montarSw(modelo, { versao, arquivos });
  const ouvintes = {};
  const caixas = new Map();
  const mensagens = [];
  const pedidosDeRede = [];
  const estado = { pulouEspera: false, rede: rede ?? (async (url) => respostaBasica(`rede:${url}`)) };
  const fetchFalso = async (pedido, opcoes) => {
    const url = new URL(typeof pedido === 'string' ? pedido : pedido.url, `${ORIGEM}/sw.js`).href;
    pedidosDeRede.push({ url, opcoes });
    return estado.rede(url);
  };
  const caches = {
    async open(nome) {
      if (!caixas.has(nome)) { const c = new CacheFalso(); c.fetch = fetchFalso; caixas.set(nome, c); }
      return caixas.get(nome);
    },
    async keys() { return [...caixas.keys()]; },
    async delete(nome) { return caixas.delete(nome); },
    async match(pedido, { cacheName } = {}) { return caixas.get(cacheName)?.match(pedido); },
  };
  const self = {
    location: new URL(`${ORIGEM}/sw.js`),
    registration: { scope: `${ORIGEM}/` },
    addEventListener(tipo, fn) { ouvintes[tipo] = fn; },
    skipWaiting() { estado.pulouEspera = true; return Promise.resolve(); },
    clients: {
      claim: async () => {},
      get: async (id) => ({ postMessage: (m) => mensagens.push({ id, m: JSON.parse(JSON.stringify(m)) }) }),
    },
  };
  const contexto = vm.createContext({
    self, caches, fetch: fetchFalso, Request, Response, Headers, URL, Set, Promise, Date, JSON,
  });
  vm.runInContext(codigo, contexto, { filename: 'sw.js' });

  async function disparar(tipo, dados = {}) {
    const espera = [];
    let resposta;
    const evento = {
      ...dados,
      waitUntil: (p) => espera.push(p),
      respondWith: (p) => { resposta = p; },
    };
    ouvintes[tipo](evento);
    const r = await resposta;
    await Promise.all(espera);
    return { resposta: r, respondeu: resposta !== undefined, espera };
  }

  const pedir = (caminho, { modo = 'cors', metodo = 'GET', clientId = 'pagina-1' } = {}) => disparar('fetch', {
    request: { url: new URL(caminho, `${ORIGEM}/`).href, method: metodo, mode: modo },
    clientId,
  });

  return { contexto, caixas, mensagens, pedidosDeRede, estado, disparar, pedir };
}

// ---------------------------------------------------------------------------
// Regras do service worker

test('classificar: app, dados, páginas e o que passa direto', async () => {
  const { contexto } = await carregarSw();
  const c = (url, modo = 'cors', metodo = 'GET') => contexto.classificar(metodo, `${ORIGEM}${url}`, modo);
  assert.equal(c('/', 'navigate'), 'app');
  assert.equal(c('/?loja=magalu', 'navigate'), 'app');
  assert.equal(c('/index.html'), 'app');
  assert.equal(c('/js/app.js'), 'app');
  assert.equal(c('/dados/lojas.json'), 'dados');
  assert.equal(c('/loja/magalu/', 'navigate'), 'pagina');
  assert.equal(c('/ofertas/', 'navigate'), 'pagina');
  assert.equal(c('/viagens/', 'navigate'), 'pagina');
  // Passa direto, sem cache:
  assert.equal(c('/sw.js'), 'ignorar');
  assert.equal(c('/estilo.html', 'navigate'), 'ignorar');
  assert.equal(c('/dados/lojas.json', 'cors', 'POST'), 'ignorar');
  assert.equal(c('/dados/lojas.json?x=1'), 'ignorar');
  assert.equal(c('/js/desconhecido.js'), 'ignorar');
  assert.equal(c('/loja/magalu/foto.png'), 'ignorar');
  assert.equal(contexto.classificar('GET', 'https://outro.site/dados/lojas.json', 'cors'), 'ignorar');
  assert.equal(contexto.classificar('GET', 'blob:https://milhasdavez.pages.dev/123', 'cors'), 'ignorar');
});

test('nada com "perfil" no endereço entra no cache', async () => {
  const { contexto, pedir, caixas } = await carregarSw({ arquivos: ['index.html', 'offline.html', 'js/perfil/armazem.js'] });
  for (const url of ['/perfil', '/perfil.json', '/dados/perfil.json', '/?perfil=1', '/meu-perfil/', '/js/perfil/armazem.js?perfil']) {
    assert.equal(contexto.classificar('GET', `${ORIGEM}${url}`, 'navigate'), 'ignorar', url);
    const { respondeu } = await pedir(url, { modo: 'navigate' });
    assert.equal(respondeu, false, `${url} não deveria passar pelo service worker`);
  }
  for (const cache of caixas.values()) assert.equal(cache.itens.size, 0);
  // O código da tela do perfil é arquivo do app (igual para todos) e precisa funcionar sem internet.
  assert.equal(contexto.classificar('GET', `${ORIGEM}/js/perfil/armazem.js`, 'script'), 'app');
});

test('o código do service worker não toca em localStorage, cookies nem IndexedDB', async () => {
  const modelo = await readFile(new URL('scripts/pwa/sw-modelo.js', raiz), 'utf8');
  const codigo = modelo.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(codigo, /localStorage|sessionStorage|indexedDB|document\.cookie/);
});

test('instalar guarda o app e NÃO pula a espera sozinho', async () => {
  const sw = await carregarSw();
  await sw.disparar('install');
  const app = sw.caixas.get('milhas-app-aaaaaaaaaaaa');
  assert.equal(app.itens.size, 4);
  assert.equal(sw.estado.pulouEspera, false);
  await sw.disparar('message', { data: { tipo: 'outra-coisa' } });
  assert.equal(sw.estado.pulouEspera, false);
  await sw.disparar('message', { data: { tipo: 'atualizar-agora' } });
  assert.equal(sw.estado.pulouEspera, true);
});

test('ativar apaga caches de versões antigas e mantém os dados', async () => {
  const velho = await carregarSw({ versao: '111111111111' });
  await velho.disparar('install');
  const sw = await carregarSw({ versao: '222222222222' });
  // mesmo "aparelho": o novo vê os caches do velho
  for (const [nome, c] of velho.caixas) sw.caixas.set(nome, c);
  sw.caixas.set('milhas-dados', new CacheFalso());
  sw.caixas.set('milhas-paginas-111111111111', new CacheFalso());
  sw.caixas.set('outro-site-cache', new CacheFalso());
  await sw.disparar('install');
  await sw.disparar('activate');
  assert.deepEqual([...sw.caixas.keys()].sort(), ['milhas-app-222222222222', 'milhas-dados', 'outro-site-cache']);
});

test('app: cache primeiro; "/" e "/?loja=x" abrem o index.html guardado, mesmo sem internet', async () => {
  const sw = await carregarSw();
  await sw.disparar('install');
  sw.estado.rede = async () => { throw new TypeError('sem internet'); };
  for (const url of ['/', '/?loja=magalu', '/index.html']) {
    const { resposta } = await sw.pedir(url, { modo: 'navigate' });
    assert.equal(await resposta.text(), `rede:${ORIGEM}/index.html`, url);
  }
  const { resposta } = await sw.pedir('/js/app.js');
  assert.equal(await resposta.text(), `rede:${ORIGEM}/js/app.js`);
});

test('dados: sem cópia, busca na rede e guarda com a hora (X-Salvo-Em)', async () => {
  const sw = await carregarSw();
  const { resposta } = await sw.pedir('/dados/lojas.json');
  assert.equal(await resposta.text(), `rede:${ORIGEM}/dados/lojas.json`);
  assert.equal(resposta.headers.get('X-Salvo-Em'), null);
  const guardado = await sw.caixas.get('milhas-dados').match(`${ORIGEM}/dados/lojas.json`);
  assert.ok(!Number.isNaN(new Date(guardado.headers.get('X-Salvo-Em')).getTime()));
});

test('dados: com cópia, responde a cópia na hora e atualiza em segundo plano', async () => {
  const sw = await carregarSw();
  await sw.pedir('/dados/ofertas.json');
  sw.estado.rede = async () => respostaBasica('[{"nova":true}]');
  const { resposta } = await sw.pedir('/dados/ofertas.json');
  assert.equal(await resposta.text(), `rede:${ORIGEM}/dados/ofertas.json`, 'primeiro vem a cópia guardada');
  assert.ok(resposta.headers.get('X-Salvo-Em'));
  const depois = await sw.caixas.get('milhas-dados').match(`${ORIGEM}/dados/ofertas.json`);
  assert.equal(await depois.text(), '[{"nova":true}]', 'a cópia foi trocada em segundo plano');
  const ultimo = sw.pedidosDeRede.at(-1);
  assert.equal(ultimo.opcoes?.cache, 'no-cache');
});

test('dados: sem internet, usa a cópia e avisa a página com a data', async () => {
  const sw = await carregarSw();
  await sw.pedir('/dados/lojas.json');
  const salvo = (await sw.caixas.get('milhas-dados').match(`${ORIGEM}/dados/lojas.json`)).headers.get('X-Salvo-Em');
  sw.estado.rede = async () => { throw new TypeError('sem internet'); };
  const { resposta } = await sw.pedir('/dados/lojas.json', { clientId: 'aba-7' });
  assert.equal(resposta.status, 200);
  assert.deepEqual(sw.mensagens, [{ id: 'aba-7', m: { tipo: 'dados-sem-rede', salvoEm: salvo } }]);
});

test('dados: resposta com erro ou "no-store" não substitui a cópia', async () => {
  const sw = await carregarSw();
  await sw.pedir('/dados/lojas.json');
  const antes = await (await sw.caixas.get('milhas-dados').match(`${ORIGEM}/dados/lojas.json`)).text();
  for (const ruim of [respostaBasica('erro', { status: 500 }), respostaBasica('x', { headers: { 'Cache-Control': 'no-store' } })]) {
    sw.estado.rede = async () => ruim;
    await sw.pedir('/dados/lojas.json');
    assert.equal(await (await sw.caixas.get('milhas-dados').match(`${ORIGEM}/dados/lojas.json`)).text(), antes);
  }
});

test('páginas de loja: rede primeiro; sem internet usa a cópia ou a página "sem internet"', async () => {
  const sw = await carregarSw();
  await sw.disparar('install');
  const online = await sw.pedir('/loja/magalu/', { modo: 'navigate' });
  assert.equal(await online.resposta.text(), `rede:${ORIGEM}/loja/magalu/`);
  sw.estado.rede = async () => { throw new TypeError('sem internet'); };
  const copia = await sw.pedir('/loja/magalu/', { modo: 'navigate' });
  assert.equal(await copia.resposta.text(), `rede:${ORIGEM}/loja/magalu/`);
  const nunca = await sw.pedir('/loja/amazon/', { modo: 'navigate' });
  assert.equal(await nunca.resposta.text(), `rede:${ORIGEM}/offline.html`);
});

// ---------------------------------------------------------------------------
// Textos do aviso

test('quandoForamSalvos: hoje, ontem e data completa, no fuso do aparelho', () => {
  const agora = new Date(2026, 10, 22, 15, 0);
  assert.equal(quandoForamSalvos(new Date(2026, 10, 22, 9, 5).toISOString(), agora), 'de hoje, 09:05');
  assert.equal(quandoForamSalvos(new Date(2026, 10, 21, 23, 59).toISOString(), agora), 'de ontem, 23:59');
  assert.equal(quandoForamSalvos(new Date(2026, 10, 1, 8, 0).toISOString(), agora), 'de 01/11/2026, 08:00');
  assert.equal(quandoForamSalvos(new Date(2026, 0, 1, 10, 0).toISOString(), new Date(2026, 0, 2, 9, 0)), 'de ontem, 10:00');
  assert.equal(quandoForamSalvos('lixo', agora), null);
  assert.equal(quandoForamSalvos(null, agora), null);
});

test('avisoSemInternet traz a data no título e pede para conferir', () => {
  const agora = new Date(2026, 10, 22, 15, 0);
  const { titulo, texto } = avisoSemInternet(new Date(2026, 10, 20, 10, 30).toISOString(), agora);
  assert.equal(titulo, 'Sem internet: dados de 20/11/2026, 10:30');
  assert.match(texto, /confira antes de comprar/);
  assert.equal(avisoSemInternet(null, agora).titulo, 'Sem internet');
});

test('maisAntiga escolhe a cópia mais velha e ignora vazias', () => {
  assert.equal(maisAntiga([null, '2026-11-22T10:00:00.000Z', '2026-11-20T10:00:00.000Z', 'lixo']), '2026-11-20T10:00:00.000Z');
  assert.equal(maisAntiga([null, null]), null);
});
