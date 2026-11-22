// Métricas sem cookie (site/js/metricas/): só eventos da lista, só códigos
// curtos como valor, nunca valor da compra, cartões ou programas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  EVENTOS, SELETOR_OFERTAS_VENCIDAS, criarMetricas, destinoDoLink, limparUrl, lojaDoCaminho, metricasLigadas, montarEvento,
  observarCliquesDeSaida, observarInstalacao, observarOfertasVencidas, paginaDoCaminho, podeMedir,
} from '../site/js/metricas/metricas.js';
import { ENDERECO_DE_ENVIO } from '../site/js/metricas/config.js';

const RAIZ = new URL('../', import.meta.url);
const SITE = 'milhasdavez.com.br';
const opcoes = { url: `https://${SITE}/loja/magalu/?valor=129900#x`, dominio: SITE };

/** Janela falsa: guarda os ouvintes e os fetch feitos. */
function janelaFalsa({ hostname = SITE, caminho = '/', navegador = {}, secao = null, comObservador = true } = {}) {
  const ouvintes = {};
  const ouvintesDoc = {};
  const pedidos = [];
  const observados = [];
  const janela = {
    location: { hostname, href: `https://${hostname}${caminho}?q=1`, origin: `https://${hostname}`, pathname: caminho },
    navigator: navegador,
    fetch: (url, opcoes) => { pedidos.push({ url, opcoes }); return Promise.resolve({ ok: true }); },
    addEventListener: (tipo, f) => { ouvintes[tipo] = f; },
    document: {
      addEventListener: (tipo, f) => { (ouvintesDoc[tipo] ??= []).push(f); },
      querySelector: (sel) => (sel === SELETOR_OFERTAS_VENCIDAS ? secao : null),
    },
  };
  if (comObservador) {
    janela.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; observados.push(this); }
      observe(el) { this.el = el; }
      disconnect() { this.desligado = true; }
    };
  }
  return { janela, ouvintes, ouvintesDoc, pedidos, observados };
}

const corpos = (pedidos) => pedidos.map((p) => JSON.parse(p.opcoes.body));

test('montarEvento: só eventos e propriedades da lista, endereço sem ? e #', () => {
  assert.deepEqual(montarEvento('busca_loja', { loja: 'magalu', origem: 'calculadora' }, opcoes), {
    n: 'busca_loja', u: `https://${SITE}/loja/magalu/`, d: SITE, p: { loja: 'magalu', origem: 'calculadora' },
  });
  assert.deepEqual(montarEvento('instalacao', {}, opcoes), { n: 'instalacao', u: `https://${SITE}/loja/magalu/`, d: SITE });
  assert.deepEqual(montarEvento('calculo', { loja: 'amazon', origem: undefined, pagina: null }, opcoes).p, { loja: 'amazon' });
  assert.equal(montarEvento('evento_inventado', {}, opcoes), null);
  assert.equal(montarEvento('toString', {}, opcoes), null);
});

test('montarEvento: valor da compra, cartões, programas ou texto digitado derrubam o evento inteiro', () => {
  assert.equal(montarEvento('calculo', { loja: 'magalu', valor: '129900' }, opcoes), null, 'propriedade fora da lista');
  assert.equal(montarEvento('calculo', { loja: 'magalu', cartoes: 'cartao-x' }, opcoes), null);
  assert.equal(montarEvento('calculo', { loja: 'magalu', programa: 'livelo' }, opcoes), null);
  assert.equal(montarEvento('calculo', { loja: 129900 }, opcoes), null, 'número não é código');
  assert.equal(montarEvento('calculo', { loja: ['magalu'] }, opcoes), null);
  for (const ruim of ['Magalu', 'R$ 1.299,00', 'loja da esquina', 'joão@email.com', 'a/b', '', '-x', 'x'.repeat(64)]) {
    assert.equal(montarEvento('busca_loja', { loja: ruim }, opcoes), null, ruim);
  }
  assert.ok(montarEvento('clique_saida', { destino: 'magazineluiza.com.br', pagina: 'inicio', loja: 'magalu' }, opcoes));
});

test('nenhum evento pode levar propriedade de valor, cartão ou programa', () => {
  for (const [nome, { propriedades, descricao }] of Object.entries(EVENTOS)) {
    for (const p of propriedades) assert.doesNotMatch(p, /valor|preco|cart|programa|perfil|clube|milheiro|cotacao/, `${nome}.${p}`);
    assert.ok(descricao.length > 10, nome);
  }
  assert.deepEqual(Object.keys(EVENTOS), ['busca_loja', 'calculo', 'clique_saida', 'instalacao', 'oferta_vencida_vista']);
});

test('todo id de loja cabe no formato aceito', async () => {
  const lojas = JSON.parse(await readFile(new URL('dados/lojas.json', RAIZ), 'utf8'));
  for (const l of lojas) {
    assert.ok(montarEvento('busca_loja', { loja: l.id }, opcoes), l.id);
    assert.ok(montarEvento('clique_saida', { destino: l.dominio.replace(/^www\./, '') }, opcoes), l.dominio);
  }
});

test('podeMedir: só no endereço configurado e sem pedido de não rastrear', () => {
  assert.equal(podeMedir({ dominio: SITE, hostname: SITE, navegador: {} }), true);
  assert.equal(podeMedir({ dominio: 'A_CONFIRMAR', hostname: SITE, navegador: {} }), false);
  assert.equal(podeMedir({ dominio: '', hostname: '', navegador: {} }), false);
  assert.equal(podeMedir({ dominio: SITE, hostname: 'localhost', navegador: {} }), false);
  assert.equal(podeMedir({ dominio: SITE, hostname: `abc123.${SITE}`, navegador: {} }), false, 'prévia');
  assert.equal(podeMedir({ dominio: SITE, hostname: SITE, navegador: { globalPrivacyControl: true } }), false);
  assert.equal(podeMedir({ dominio: SITE, hostname: SITE, navegador: { doNotTrack: '1' } }), false);
  assert.equal(podeMedir({ dominio: SITE, hostname: SITE, navegador: { doNotTrack: '0' } }), true);
  assert.equal(podeMedir({ dominio: SITE, hostname: SITE }), true);
  assert.equal(metricasLigadas('A_CONFIRMAR'), false);
  assert.equal(metricasLigadas(SITE), true);
  assert.equal(metricasLigadas(''), false);
});

test('criarMetricas manda POST sem cookie, sem referrer e com keepalive', async () => {
  const { janela, pedidos } = janelaFalsa({ caminho: '/' });
  const m = criarMetricas({ dominio: SITE, janela });
  assert.equal(m.ligada, true);
  assert.equal(m.registrar('calculo', { loja: 'magalu' }), true);
  assert.equal(pedidos.length, 1);
  const { url, opcoes: o } = pedidos[0];
  assert.equal(url, ENDERECO_DE_ENVIO);
  assert.equal(o.method, 'POST');
  assert.equal(o.credentials, 'omit');
  assert.equal(o.referrerPolicy, 'no-referrer');
  assert.equal(o.keepalive, true);
  assert.deepEqual(JSON.parse(o.body), { n: 'calculo', u: `https://${SITE}/`, d: SITE, p: { loja: 'magalu' } });
  assert.equal(m.registrar('calculo', { loja: 'magalu', valor: '100' }), false);
  assert.equal(pedidos.length, 1);
});

test('criarMetricas: umaVez não repete; desligada não manda; falha de rede não quebra', async () => {
  const enviados = [];
  const { janela } = janelaFalsa();
  const m = criarMetricas({ dominio: SITE, janela, enviar: (c) => { enviados.push(c); } });
  assert.equal(m.registrar('busca_loja', { loja: 'magalu' }, { umaVez: true }), true);
  assert.equal(m.registrar('busca_loja', { loja: 'magalu' }, { umaVez: true }), false);
  assert.equal(m.registrar('busca_loja', { loja: 'amazon' }, { umaVez: true }), true);
  assert.equal(enviados.length, 2);

  const desligada = criarMetricas({ dominio: 'A_CONFIRMAR', janela, enviar: () => assert.fail('não devia mandar') });
  assert.equal(desligada.ligada, false);
  assert.equal(desligada.registrar('calculo', { loja: 'magalu' }), false);
  assert.equal(criarMetricas({ dominio: SITE, janela: undefined }).ligada, false);

  const quebra = criarMetricas({ dominio: SITE, janela, enviar: () => { throw new Error('sem rede'); } });
  assert.equal(quebra.registrar('calculo', { loja: 'magalu' }), true);
  const rejeita = criarMetricas({ dominio: SITE, janela, enviar: () => Promise.reject(new Error('bloqueado')) });
  assert.equal(rejeita.registrar('calculo', { loja: 'magalu' }), true);
  await new Promise((r) => setTimeout(r, 0));
});

test('caminhos: página e loja', () => {
  assert.equal(paginaDoCaminho('/'), 'inicio');
  assert.equal(paginaDoCaminho('/index.html'), 'inicio');
  assert.equal(paginaDoCaminho('/loja/magalu/'), 'loja');
  assert.equal(paginaDoCaminho('/loja/magalu/index.html'), 'loja');
  assert.equal(paginaDoCaminho('/ofertas/'), 'ofertas');
  assert.equal(paginaDoCaminho('/privacidade/'), 'outra');
  assert.equal(lojaDoCaminho('/loja/mercado-livre/'), 'mercado-livre');
  assert.equal(lojaDoCaminho('/ofertas/'), null);
  assert.equal(limparUrl('https://a.b/c/?x=1#y'), 'https://a.b/c/');
});

test('destinoDoLink: só links para fora, em http(s), sem www', () => {
  const origem = `https://${SITE}`;
  assert.equal(destinoDoLink('https://www.amazon.com.br/promo?tag=x', origem), 'amazon.com.br');
  assert.equal(destinoDoLink('http://livelo.com.br/', origem), 'livelo.com.br');
  assert.equal(destinoDoLink('/loja/magalu/', origem), null);
  assert.equal(destinoDoLink(`${origem}/ofertas/`, origem), null);
  assert.equal(destinoDoLink('mailto:oi@x.com', origem), null);
  assert.equal(destinoDoLink('#/perfil', origem), null);
  assert.equal(destinoDoLink('http://[', origem), null);
});

test('observarCliquesDeSaida: clique e clique do meio em link de fora', () => {
  const { janela, ouvintesDoc, pedidos } = janelaFalsa();
  const m = criarMetricas({ dominio: SITE, janela });
  observarCliquesDeSaida({ janela, metricas: m, pagina: 'inicio', loja: () => 'magalu' });
  const link = (href) => ({ closest: () => ({ getAttribute: () => href }) });
  const [clique] = ouvintesDoc.click;
  const [auxiliar] = ouvintesDoc.auxclick;
  clique({ type: 'click', target: link('https://www.magazineluiza.com.br/x') });
  clique({ type: 'click', target: link('/ofertas/') });
  clique({ type: 'click', target: { closest: () => null } });
  clique({ type: 'click', target: null });
  auxiliar({ type: 'auxclick', button: 2, target: link('https://fonte.com.br/') });
  auxiliar({ type: 'auxclick', button: 1, target: link('https://fonte.com.br/') });
  assert.deepEqual(corpos(pedidos).map((c) => c.p), [
    { destino: 'magazineluiza.com.br', pagina: 'inicio', loja: 'magalu' },
    { destino: 'fonte.com.br', pagina: 'inicio', loja: 'magalu' },
  ]);

  const semLoja = janelaFalsa();
  const m2 = criarMetricas({ dominio: SITE, janela: semLoja.janela });
  observarCliquesDeSaida({ janela: semLoja.janela, metricas: m2, pagina: 'ofertas' });
  semLoja.ouvintesDoc.click[0]({ type: 'click', target: link('https://x.com.br/') });
  assert.deepEqual(corpos(semLoja.pedidos)[0].p, { destino: 'x.com.br', pagina: 'ofertas' });
});

test('observadores não fazem nada com as métricas desligadas', () => {
  const { janela, ouvintes, ouvintesDoc } = janelaFalsa({ secao: {} });
  const m = criarMetricas({ dominio: 'A_CONFIRMAR', janela });
  observarCliquesDeSaida({ janela, metricas: m, pagina: 'inicio' });
  observarInstalacao({ janela, metricas: m });
  observarOfertasVencidas({ janela, metricas: m, pagina: 'loja' });
  assert.deepEqual(ouvintes, {});
  assert.deepEqual(ouvintesDoc, {});
});

test('observarInstalacao conta uma vez', () => {
  const { janela, ouvintes, pedidos } = janelaFalsa();
  observarInstalacao({ janela, metricas: criarMetricas({ dominio: SITE, janela }) });
  ouvintes.appinstalled();
  ouvintes.appinstalled();
  assert.deepEqual(corpos(pedidos).map((c) => c.n), ['instalacao']);
});

test('observarOfertasVencidas: conta uma vez quando o histórico aparece na tela', () => {
  const secao = { nome: 'historico' };
  const { janela, pedidos, observados } = janelaFalsa({ secao, caminho: '/loja/magalu/' });
  observarOfertasVencidas({ janela, metricas: criarMetricas({ dominio: SITE, janela }), pagina: 'loja', loja: 'magalu' });
  assert.equal(observados.length, 1);
  assert.equal(observados[0].el, secao);
  observados[0].cb([{ isIntersecting: false }]);
  assert.equal(pedidos.length, 0);
  observados[0].cb([{ isIntersecting: true }]);
  observados[0].cb([{ isIntersecting: true }]);
  assert.equal(observados[0].desligado, true);
  assert.deepEqual(corpos(pedidos).map((c) => c.p), [{ pagina: 'loja', loja: 'magalu' }]);

  // Sem histórico na página: nada.
  const vazia = janelaFalsa();
  observarOfertasVencidas({ janela: vazia.janela, metricas: criarMetricas({ dominio: SITE, janela: vazia.janela }), pagina: 'ofertas' });
  assert.equal(vazia.observados.length, 0);

  // Navegador sem IntersectionObserver: conta ao abrir.
  const antigo = janelaFalsa({ secao, comObservador: false });
  observarOfertasVencidas({ janela: antigo.janela, metricas: criarMetricas({ dominio: SITE, janela: antigo.janela }), pagina: 'ofertas' });
  assert.deepEqual(corpos(antigo.pedidos).map((c) => c.p), [{ pagina: 'ofertas' }]);
});

test('o código de métricas não usa cookie, localStorage nem script de fora', async () => {
  const pasta = new URL('site/js/metricas/', RAIZ);
  const arquivos = await readdir(pasta);
  const codigo = (await Promise.all(arquivos.map((a) => readFile(new URL(a, pasta), 'utf8')))).join('\n')
    .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(codigo, /document\.cookie|localStorage|sessionStorage|indexedDB|createElement\(['"]script/);
  assert.doesNotMatch(codigo, /\.(innerHTML|outerHTML)/);
});

test('o app nunca passa valor, perfil ou cartões para as métricas', async () => {
  const app = await readFile(new URL('site/js/app.js', RAIZ), 'utf8');
  const chamadas = [...app.matchAll(/metricas\.registrar\(([^;]*)\);/g)].map((m) => m[1]);
  assert.equal(chamadas.length, 3);
  for (const c of chamadas) assert.doesNotMatch(c, /centavos|valor|perfil|cart|programa|campoLoja\.value[^.]/);
});
