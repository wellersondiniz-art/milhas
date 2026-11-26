// Fluxo 3: instalar e usar sem internet (PWA).
// Usa o site montado de verdade (npm run build), com o service worker ligado
// e os dados reais do repositório.
import { readdir } from 'node:fs/promises';
import { abrirInicio, cartoesDoResultado, expect, test } from './apoio.mjs';

/** Abre o site e espera o service worker assumir a página e guardar os dados. */
/**
 * Quantos arquivos de dados a calculadora usa (dist/dados/*.json). Os de
 * postos (redes-postos, regras-postos) só a tela "Quanto rende abastecer" pede.
 */
const SO_DA_TELA_DE_ABASTECER = new Set(['redes-postos.json', 'regras-postos.json']);
const arquivosDeDados = async () => (await readdir(new URL('../../dist/dados/', import.meta.url)))
  .filter((n) => n.endsWith('.json') && !SO_DA_TELA_DE_ABASTECER.has(n)).length;

async function abrirComServiceWorker(page) {
  await abrirInicio(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Na primeira visita a página ainda não passa pelo service worker. Recarregar
  // faz os dados passarem por ele e ficarem guardados.
  await page.reload();
  await expect(page.locator('#loja')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const nomes = await caches.keys();
    const dados = nomes.find((n) => n === 'milhas-dados');
    return dados ? (await (await caches.open(dados)).keys()).length : 0;
  })).toBe(await arquivosDeDados());
}

test('dá para instalar: manifesto, ícones e service worker do jeito que o Chrome pede', async ({ page, request }) => {
  await abrirComServiceWorker(page);

  const resposta = await request.get('/manifest.webmanifest');
  expect(resposta.ok()).toBe(true);
  const manifesto = await resposta.json();
  expect(manifesto).toMatchObject({ name: 'Milhas da Vez', start_url: '/', scope: '/', display: 'standalone', lang: 'pt-BR' });
  const tamanhos = manifesto.icons.map((i) => `${i.sizes} ${i.purpose}`);
  expect(tamanhos).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
  for (const icone of manifesto.icons) {
    const r = await request.get(`/${icone.src}`);
    expect(r.ok(), icone.src).toBe(true);
    expect(r.headers()['content-type'], icone.src).toBe(icone.type);
  }

  // O próprio Chrome diz se a página pode ser instalada (sem erros = pode).
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
  const { url, data } = await cdp.send('Page.getAppManifest');
  expect(url).toMatch(/\/manifest\.webmanifest$/);
  expect(data.length).toBeGreaterThan(0);
});

test('sem internet, a calculadora abre e calcula com os dados guardados', async ({ page, context }) => {
  await abrirComServiceWorker(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#loja')).toBeEnabled();
  await expect(page.locator('#aviso-conexao')).toContainText('Sem internet');

  await abrirInicio(page, '/?loja=magalu');
  await page.getByRole('textbox', { name: 'Quanto vai custar?' }).fill('10000');
  await page.getByRole('button', { name: 'Ver o resultado' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'R$ 100,00 na Magalu' })).toBeVisible();
  // Com os dados reais: ou aparece o melhor jeito, ou (sem a cotação do dólar
  // e sem oferta) uma mensagem só, sem lista de "Nenhum ponto".
  await expect(page.locator('#resultado')).toContainText(/Melhor jeito|Ainda não dá para calcular os pontos dos cartões/);

  // A internet volta: o aviso some.
  await context.setOffline(false);
  await expect(page.locator('#aviso-conexao')).toBeEmpty();
});

test('sem internet, página de loja nunca aberta mostra o aviso e leva à calculadora', async ({ page, context }) => {
  await abrirComServiceWorker(page);
  await context.setOffline(true);
  await page.goto('/loja/amazon/');
  await expect(page.getByRole('heading', { level: 1, name: 'Sem internet agora' })).toBeVisible();
  await page.getByRole('link', { name: 'Abrir a calculadora' }).click();
  await expect(page.locator('#loja')).toBeEnabled();
});

test('página de loja já aberta continua funcionando sem internet', async ({ page, context }) => {
  await abrirComServiceWorker(page);
  await page.goto('/loja/magalu/');
  const titulo = await page.getByRole('heading', { level: 1 }).textContent();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(titulo);
});

test('o perfil nunca entra no cache do service worker', async ({ page }) => {
  await abrirComServiceWorker(page);
  await page.goto('/#/perfil');
  await page.getByRole('checkbox').first().check();
  await expect(page.locator('#perfil-status')).toContainText('Salvo');
  const { perfil, guardados } = await page.evaluate(async () => {
    const lista = [];
    for (const nome of await caches.keys()) {
      const cache = await caches.open(nome);
      for (const pedido of await cache.keys()) {
        lista.push({ url: pedido.url, corpo: await (await cache.match(pedido)).text() });
      }
    }
    return { perfil: localStorage.getItem('comprador-de-milhas:perfil'), guardados: lista };
  });
  expect(perfil).toBeTruthy();
  expect(guardados.length).toBeGreaterThan(0);
  for (const { url, corpo } of guardados) {
    // Só arquivos do site e dados públicos; nenhum endereço com "perfil" além do código da tela.
    expect(url).toMatch(/\/(|[a-z0-9/._-]+\.(js|css|html|png|svg|webmanifest|json)|(loja\/[a-z0-9-]+|ofertas)\/)$/);
    expect(url).not.toMatch(/[?#].*perfil/i);
    expect(corpo.includes(perfil), url).toBe(false);
  }
});
