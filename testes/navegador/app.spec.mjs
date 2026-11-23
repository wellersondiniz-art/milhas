// O app das lojas (Android/iOS, via Capacitor), simulado no Chromium.
//
// Monta a pasta do app (a mesma de npm run app:montar, com a CSP em <meta>)
// e abre como o Android abre: em https://localhost/. A ponte nativa
// (window.Capacitor) é falsa, mas fala com o "cofre" do jeito que o plugin
// @aparajita/capacitor-secure-storage fala. O cofre fica aqui no Node, então
// sobrevive ao recarregar, como no aparelho.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { montarApp } from '../../scripts/app/montar-app.js';
import { ENDERECO_DO_SITE } from '../../site/js/nativo/config.js';
import { AGORA_DE_TESTE, calcular, cartoesDoResultado, expect, test } from './apoio.mjs';

const APP = 'https://localhost';
const DADOS_DE_TESTE = new URL('./dados-de-teste/', import.meta.url);
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

test.use({ serviceWorkers: 'allow' });

let pasta;
test.beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), 'app-www-'));
  await montarApp(pathToFileURL(`${pasta}/`));
});
test.afterAll(async () => { await rm(pasta, { recursive: true, force: true }); });

/**
 * Abre o app. siteNoAr: false simula site fora do ar / sem internet para os dados.
 * Devolve o cofre (Map) e a lista de chamadas feitas a ele.
 */
async function abrirApp(page, { siteNoAr = true, cofre = new Map(), chamadas = [] } = {}) {
  await page.clock.setFixedTime(AGORA_DE_TESTE);
  await page.exposeFunction('__cofreDoTeste', (plugin, metodo, opcoes) => {
    chamadas.push({ plugin, metodo, opcoes });
    if (metodo === 'internalGetItem') return { data: cofre.has(opcoes.prefixedKey) ? cofre.get(opcoes.prefixedKey) : null };
    if (metodo === 'internalSetItem') { cofre.set(opcoes.prefixedKey, opcoes.data); return {}; }
    if (metodo === 'internalRemoveItem') return { success: cofre.delete(opcoes.prefixedKey) };
    throw new Error(`método inesperado: ${metodo}`);
  });
  await page.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      PluginHeaders: [{ name: 'SecureStorage', methods: [] }],
      nativePromise: (plugin, metodo, opcoes) => window.__cofreDoTeste(plugin, metodo, opcoes),
    };
  });
  // Arquivos do app: https://localhost/... sai de app/www (a cópia de dentro do app).
  await page.route(`${APP}/**`, async (rota) => {
    let caminho = decodeURIComponent(new URL(rota.request().url()).pathname);
    if (caminho.endsWith('/')) caminho += 'index.html';
    if (caminho.startsWith('/dados/')) {
      // A cópia dos dados que veio dentro do app (aqui, os dados de teste).
      const corpo = await readFile(new URL(caminho.slice('/dados/'.length), DADOS_DE_TESTE));
      return rota.fulfill({ status: 200, contentType: 'application/json', body: corpo });
    }
    try {
      const corpo = await readFile(join(pasta, caminho));
      return rota.fulfill({ status: 200, contentType: TIPOS[extname(caminho)] ?? 'application/octet-stream', body: corpo });
    } catch {
      return rota.fulfill({ status: 404, body: 'não encontrado' });
    }
  });
  // Dados atualizados no site.
  await page.route(`${ENDERECO_DO_SITE}/**`, async (rota) => {
    if (!siteNoAr) return rota.abort('internetdisconnected');
    const nome = new URL(rota.request().url()).pathname.split('/').pop();
    const corpo = await readFile(new URL(nome, DADOS_DE_TESTE));
    return rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: corpo });
  });
  await page.goto(`${APP}/`);
  await expect(page.locator('#loja')).toBeEnabled();
  return { cofre, chamadas };
}

const cartaoAlfa = (page) => page.getByRole('checkbox', { name: /^Cartão Alfa Platinum/ });

test('o perfil vai para o cofre do aparelho, não para o localStorage, e volta ao abrir o app de novo', async ({ page }) => {
  const { cofre, chamadas } = await abrirApp(page);
  await page.goto(`${APP}/#/perfil`);
  await cartaoAlfa(page).check();
  await expect(page.locator('#perfil-status')).toHaveText('Salvo neste aparelho.');

  await expect.poll(() => cofre.get('capacitor-storage_comprador-de-milhas:perfil') ?? '').toContain('cartao-alfa');
  const gravacao = chamadas.find((c) => c.metodo === 'internalSetItem');
  expect(gravacao.plugin).toBe('SecureStorage');
  expect(gravacao.opcoes.access).toBe(1); // só neste aparelho, só desbloqueado
  expect(gravacao.opcoes.sync).toBe(false); // sem sincronizar com o iCloud
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);

  await page.reload();
  await expect(page.locator('#loja')).toBeEnabled();
  await page.goto(`${APP}/#/perfil`);
  await expect(cartaoAlfa(page)).toBeChecked();

  // "Apagar tudo" também apaga do cofre.
  await page.getByRole('button', { name: /Apagar/ }).first().click();
  await page.locator('#perfil-sim-apagar').click();
  await expect.poll(() => cofre.has('capacitor-storage_comprador-de-milhas:perfil')).toBe(false);
});

test('busca as ofertas atualizadas no site e a conta funciona', async ({ page }) => {
  const pedidos = [];
  page.on('request', (p) => pedidos.push(p));
  await abrirApp(page);
  const doSite = pedidos.filter((p) => p.url().startsWith(`${ENDERECO_DO_SITE}/dados/`));
  expect(doSite.length).toBeGreaterThanOrEqual(5);
  for (const p of doSite) {
    expect(p.method()).toBe('GET');
    expect(await p.allHeaders()).not.toHaveProperty('cookie');
  }
  await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
  await expect(cartoesDoResultado(page).first()).toBeVisible();
});

test.describe('sem internet', () => {
  test.use({ erroEsperado: /Failed to load resource|ERR_INTERNET_DISCONNECTED/ });
  test('usa a cópia dos dados que veio dentro do app', async ({ page }) => {
    await abrirApp(page, { siteNoAr: false });
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    await expect(cartoesDoResultado(page).first()).toBeVisible();
  });
});

test('no app: sem service worker, sem botão de exportar e com a CSP dentro da página', async ({ page }) => {
  await abrirApp(page);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(0);
  expect(await page.evaluate(() => document.documentElement.dataset.app)).toBe('android');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain(`connect-src 'self' ${ENDERECO_DO_SITE}`);
  expect(csp).toContain("script-src 'self';");
  await page.goto(`${APP}/#/perfil`);
  await expect(page.getByRole('button', { name: 'Importar perfil' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar perfil' })).toBeHidden();
  await expect(page.locator('#perfil-transferir')).toContainText('exporte no site');
});

test.describe('CSP', () => {
  test.use({ erroEsperado: /Content Security Policy/ });
  test('a CSP do app barra endereço de fora (só o site e o próprio app)', async ({ page }) => {
    await abrirApp(page);
    const resultado = await page.evaluate(() => fetch('https://exemplo.invalid/x.json').then(() => 'passou', () => 'barrado'));
    expect(resultado).toBe('barrado');
  });
});
