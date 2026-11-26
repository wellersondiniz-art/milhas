// Métricas sem cookie: o que sai do navegador para o Plausible.
//
// O build normal tem o Plausible desligado (A_CONFIRMAR). Aqui o arquivo
// js/metricas/config.js é trocado no caminho para ligar as métricas em
// 127.0.0.1, e os envios para plausible.io são interceptados (nada sai daqui).
import {
  abrirInicio, calcular, escolherLojaPeloTeclado, expect, fixarRelogio, test, usarDadosDeTeste,
} from './apoio.mjs';

const ENVIO = 'https://plausible.io/api/event';

async function ligarMetricas(page, { dominio = '127.0.0.1' } = {}) {
  await page.route('**/js/metricas/config.js', (rota) => rota.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: `export const DOMINIO_NO_PLAUSIBLE = '${dominio}';\nexport const ENDERECO_DE_ENVIO = '${ENVIO}';\n`,
  }));
}

/** Guarda cada evento enviado (corpo e cabeçalhos) e responde como o Plausible. */
async function capturarEnvios(page) {
  const envios = [];
  await page.route(ENVIO, async (rota) => {
    const pedido = rota.request();
    envios.push({ corpo: JSON.parse(pedido.postData()), cabecalhos: await pedido.allHeaders() });
    await rota.fulfill({ status: 202, body: 'ok', headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173' } });
  });
  return envios;
}

/** Sites de fora abertos por clique: página em branco, sem rede de verdade. */
async function sitesDeFora(page) {
  // Qualquer site de fora (fontes e lojas) responde aqui: o teste nunca sai para a internet.
  await page.route((url) => url.protocol === 'https:' && !/(^|\.)plausible\.io$/.test(url.hostname),
    (rota) => rota.fulfill({ status: 200, contentType: 'text/html', body: '<p>fora</p>' }));
}

const nomes = (envios) => envios.map((e) => e.corpo.n);

test.describe('métricas ligadas', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await usarDadosDeTeste(page);
    await fixarRelogio(page);
    await ligarMetricas(page);
    await sitesDeFora(page);
  });

  test('calculadora: busca, conta e clique de saída, sem valor e sem cartões', async ({ page }) => {
    const envios = await capturarEnvios(page);
    await abrirInicio(page, '/?loja=x&utm_source=teste');
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '12345' });
    await expect(page.getByRole('heading', { level: 2, name: 'R$ 123,45 na Loja Teste' })).toBeVisible();
    await expect.poll(() => nomes(envios)).toEqual(['busca_loja', 'calculo']);

    // Link para a loja (como o do PR de links de saída), posto na tela pelo teste.
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = 'https://www.loja-teste.invalid/produto?id=1';
      a.textContent = 'Link posto pelo teste';
      document.getElementById('resultado').append(a);
    });
    await page.getByRole('link', { name: 'Link posto pelo teste' }).click();
    await expect.poll(() => nomes(envios)).toEqual(['busca_loja', 'calculo', 'clique_saida']);

    const [busca, conta, clique] = envios.map((e) => e.corpo);
    expect(busca).toEqual({ n: 'busca_loja', u: 'http://127.0.0.1:4173/', d: '127.0.0.1', p: { loja: 'loja-teste', origem: 'calculadora' } });
    expect(conta).toEqual({ n: 'calculo', u: 'http://127.0.0.1:4173/', d: '127.0.0.1', p: { loja: 'loja-teste' } });
    expect(clique.p).toEqual({ destino: 'loja-teste.invalid', pagina: 'inicio', loja: 'loja-teste' });

    const tudo = JSON.stringify(envios.map((e) => e.corpo));
    for (const proibido of ['12345', '123,45', '123.45', 'Alfa', 'Beta', 'cartao', 'programa', 'utm_source', 'produto']) {
      expect(tudo, proibido).not.toContain(proibido);
    }
    for (const { cabecalhos } of envios) {
      expect(cabecalhos.cookie).toBeUndefined();
      expect(cabecalhos.referer).toBeUndefined();
    }
    expect(await page.context().cookies()).toEqual([]);
  });

  test('loja fora da lista conta sem mandar o que foi digitado', async ({ page }) => {
    const envios = await capturarEnvios(page);
    await abrirInicio(page);
    const campo = page.getByRole('combobox', { name: 'Em qual loja você vai comprar?' });
    await campo.fill('Padaria do João');
    await campo.press('Escape');
    await page.getByRole('button', { name: 'Ver o resultado' }).click();
    await expect(page.getByText('Escolha uma loja da lista.')).toBeVisible();
    await expect.poll(() => envios.map((e) => e.corpo.p)).toEqual([{ loja: 'fora-da-lista', origem: 'calculadora' }]);
    expect(JSON.stringify(envios)).not.toContain('Padaria');

    await escolherLojaPeloTeclado(page, 'loj', 'Loja Teste');
    await page.getByRole('textbox', { name: 'Quanto vai custar?' }).pressSequentially('10000');
    await page.getByRole('button', { name: 'Ver o resultado' }).click();
    await expect.poll(() => nomes(envios)).toEqual(['busca_loja', 'busca_loja', 'calculo']);
  });

  test('página de loja: conta a visita e o clique na fonte', async ({ page }) => {
    const envios = await capturarEnvios(page);
    await page.goto('/loja/magalu/');
    await expect.poll(() => envios.map((e) => e.corpo.p)).toEqual([{ loja: 'magalu', origem: 'pagina-da-loja' }]);
    await page.getByRole('link', { name: 'Ver a fonte' }).first().click();
    await expect.poll(() => nomes(envios)).toEqual(['busca_loja', 'clique_saida']);
    // A primeira fonte da página da Magalu é a da oferta mais vantajosa (dados reais).
    expect(envios[1].corpo.p).toMatchObject({ pagina: 'loja', loja: 'magalu' });
    expect(envios[1].corpo.p.destino).toMatch(/^[a-z0-9.-]+\.com(\.br)?$/);
    expect(envios[1].corpo.u).toBe('http://127.0.0.1:4173/loja/magalu/');
  });

  test('oferta vencida vista: conta uma vez quando o histórico aparece na tela', async ({ page }) => {
    const envios = await capturarEnvios(page);
    // A seção de histórico vem do PR do ciclo de vida das ofertas; aqui ela é posta na página.
    await page.route('**/ofertas/', async (rota) => {
      const resposta = await rota.fetch();
      const corpo = (await resposta.text()).replace('</main>',
        `${'<p>texto</p>'.repeat(80)}<section aria-labelledby="historico-titulo"><h2 id="historico-titulo">Histórico: ofertas que já acabaram</h2></section></main>`);
      await rota.fulfill({ response: resposta, body: corpo });
    });
    await page.goto('/ofertas/');
    await page.waitForTimeout(300);
    expect(nomes(envios)).toEqual([]);
    await page.getByRole('heading', { name: 'Histórico: ofertas que já acabaram' }).scrollIntoViewIfNeeded();
    await expect.poll(() => envios.map((e) => e.corpo)).toEqual([{ n: 'oferta_vencida_vista', u: 'http://127.0.0.1:4173/ofertas/', d: '127.0.0.1', p: { pagina: 'ofertas' } }]);
    await page.mouse.wheel(0, -5000);
    await page.getByRole('heading', { name: 'Histórico: ofertas que já acabaram' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    expect(envios).toHaveLength(1);
  });

  test('quem pede para não ser rastreado não manda nada', async ({ page }) => {
    const envios = await capturarEnvios(page);
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    await expect(page.getByRole('heading', { level: 2, name: 'R$ 100,00 na Loja Teste' })).toBeVisible();
    await page.goto('/loja/magalu/');
    await page.waitForTimeout(300);
    expect(envios).toEqual([]);
  });

  test('em outro endereço (prévia, computador de quem desenvolve) não manda nada', async ({ page }) => {
    await ligarMetricas(page, { dominio: 'milhasdavez.com.br' });
    const envios = await capturarEnvios(page);
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    await expect(page.getByRole('heading', { level: 2, name: 'R$ 100,00 na Loja Teste' })).toBeVisible();
    await page.waitForTimeout(300);
    expect(envios).toEqual([]);
  });
});

test.describe('build normal (Plausible A_CONFIRMAR)', () => {
  test.use({ serviceWorkers: 'block' });

  test('nenhum pedido sai para fora do site', async ({ page }) => {
    await usarDadosDeTeste(page);
    await fixarRelogio(page);
    const deFora = [];
    page.on('request', (pedido) => { if (!pedido.url().startsWith('http://127.0.0.1')) deFora.push(pedido.url()); });
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    await expect(page.getByRole('heading', { level: 2, name: 'R$ 100,00 na Loja Teste' })).toBeVisible();
    await page.goto('/loja/magalu/');
    await page.goto('/privacidade/');
    await expect(page.getByText('Hoje não usamos nenhuma ferramenta de métrica')).toBeVisible();
    expect(deFora).toEqual([]);
  });
});
