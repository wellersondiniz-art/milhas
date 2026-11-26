// Fluxo 3: "Quanto rende abastecer" (abastecer/). Dados de teste em
// testes/navegador/dados-de-teste/ (redes e regras fictícias).
//
// Sem perfil (todos os cartões e programas), 40 litros de gasolina comum a R$ 5,000 = R$ 200,00:
//   Rede Alfa (2 pontos por litro, CPF no caixa: soma o cartão)
//     + Cartão Beta Gold (3 por real): 80 + 600 = 680 pontos (Beta sem milheiro: sem valor em reais)
//     + Cartão Alfa Platinum (2 por real): 80 + 400 = 480 pontos × R$ 20,00 ÷ 1.000 = R$ 9,60
//   Só o cartão: Beta 600; Alfa 400 (R$ 8,00)
//   Rede Beta (1 ponto por real, só pelo app): 200 pontos, sem somar cartão
import { abrirInicio, expect, fixarRelogio, test, usarDadosDeTeste } from './apoio.mjs';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await usarDadosDeTeste(page);
  await fixarRelogio(page);
});

const cards = (page) => page.locator('#abastecer-resultado .resultado__card');

async function abrir(page) {
  await page.goto('/abastecer/');
  await expect(page.getByRole('button', { name: 'Ver quanto rende' })).toBeEnabled();
}

test('o topo leva para a tela de abastecer', async ({ page }) => {
  await abrirInicio(page);
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Abastecer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Quanto rende abastecer' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abastecer' })).toHaveAttribute('aria-current', 'page');
});

test('litros + preço: compara as redes, do melhor ao pior', async ({ page }) => {
  await abrir(page);
  await expect(page.getByRole('combobox', { name: 'Em qual rede de postos?' })).toContainText('Rede Beta (RB)');
  await page.getByRole('textbox', { name: 'Quantos litros?' }).fill('40');
  await page.getByRole('textbox', { name: 'Preço do litro na bomba (opcional)' }).pressSequentially('5000');
  await expect(page.getByRole('textbox', { name: 'Preço do litro na bomba (opcional)' })).toHaveValue('5,000');
  await page.getByRole('button', { name: 'Ver quanto rende' }).click();

  const titulo = page.getByRole('heading', { level: 2, name: '40 litros de gasolina comum' });
  await expect(titulo).toBeFocused();
  await expect(cards(page)).toHaveCount(5);
  await expect(cards(page).nth(0).locator('.card__valor')).toHaveText('680 pontos');
  await expect(cards(page).nth(0)).toContainText('Abasteça nos postos Rede Alfa usando o Programa Alfa e pague com o cartão Cartão Beta Gold.');
  await expect(cards(page).nth(2).locator('.card__valor')).toHaveText('R$ 9,60');
  await expect(cards(page).nth(4)).toContainText('Abasteça nos postos Rede Beta usando o Programa Beta.');
  await expect(cards(page).nth(4)).toContainText('por isso não somamos os pontos do seu cartão aqui');
  // Regra sem número confirmado fica fora da conta, com a fonte.
  await expect(page.getByText('Programa Alfa nos postos Rede Gama: ainda não confirmamos')).toBeVisible();
  await expect(page.locator('#abastecer-anuncio')).toHaveText(/^Resultado para 40 litros de gasolina comum\. O melhor jeito rende 680 pontos\./);
});

test('litros sem preço: só a regra por litro entra e a tela pede o preço para o resto', async ({ page }) => {
  await abrir(page);
  await page.getByRole('textbox', { name: 'Quantos litros?' }).fill('40,5');
  await page.getByRole('button', { name: 'Ver quanto rende' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '40,5 litros de gasolina comum' })).toBeFocused();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).nth(0).locator('.card__valor')).toHaveText('R$ 1,62'); // 81 pontos × R$ 20,00 ÷ 1.000
  await expect(page.getByText('Informe o preço do litro para ver mais')).toBeVisible();
  await expect(page.getByText('Programa Beta nos postos Rede Beta conta 1 ponto por real.', { exact: false })).toBeVisible();
});

test('em reais, só numa rede, e com combustível que a rede não pontua', async ({ page }) => {
  await abrir(page);
  await page.getByRole('combobox', { name: 'Em qual rede de postos?' }).selectOption('rede-alfa');
  await page.getByRole('combobox', { name: 'Qual combustível?' }).selectOption('gnv');
  await page.getByRole('radio', { name: 'Valor em reais' }).check();
  await expect(page.getByRole('textbox', { name: 'Quantos litros?' })).toBeHidden();
  const reais = page.getByRole('textbox', { name: 'Quanto vai pagar?' });
  await reais.pressSequentially('10000');
  await expect(reais).toHaveValue('100,00');
  await page.getByRole('button', { name: 'Ver quanto rende' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'R$ 100,00 de GNV (gás natural veicular), nos postos Rede Alfa' })).toBeFocused();
  await expect(page.getByText('Nenhum programa de posto vale para este abastecimento')).toBeVisible();
  await expect(page.getByText('esta regra não vale para GNV (gás natural veicular).', { exact: false })).toBeVisible();
  // Só o cartão: Beta 300 pontos; Alfa 200 pontos.
  await expect(cards(page).nth(0)).toContainText('Abasteça nos postos Rede Alfa e pague com o cartão Cartão Beta Gold.');
});

test('erros do formulário e preço do litro que não fica guardado', async ({ page }) => {
  await abrir(page);
  await page.getByRole('button', { name: 'Ver quanto rende' }).click();
  const litros = page.getByRole('textbox', { name: 'Quantos litros?' });
  await expect(litros).toBeFocused();
  await expect(litros).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#abastecer-litros-erro')).toHaveText('Digite quantos litros você vai abastecer.');
  await litros.fill('quarenta');
  await page.getByRole('button', { name: 'Ver quanto rende' }).click();
  await expect(page.locator('#abastecer-litros-erro')).toHaveText(/^Use só números/);
  await page.getByRole('radio', { name: 'Valor em reais' }).check();
  await page.getByRole('button', { name: 'Ver quanto rende' }).click();
  await expect(page.locator('#abastecer-reais-erro')).toHaveText('Digite quanto vai custar o abastecimento.');

  await page.getByRole('radio', { name: 'Litros' }).check();
  await litros.fill('40');
  await page.getByRole('textbox', { name: 'Preço do litro na bomba (opcional)' }).pressSequentially('6299');
  await page.getByRole('button', { name: 'Ver quanto rende' }).click();
  await expect(cards(page).first()).toBeVisible();
  const guardado = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(guardado).not.toMatch(/6299|6,299/);
});

test.describe('dados fora do ar', () => {
  test.use({ erroEsperado: /redes-postos|404|Failed to load/ });
  test('mostra o erro e deixa tentar de novo', async ({ page }) => {
    await page.route(/\/dados\/redes-postos\.json/, (rota) => rota.fulfill({ status: 404, body: 'não' }));
    await page.goto('/abastecer/');
    await expect(page.getByText('A internet falhou ou o site está fora do ar')).toBeVisible();
    await page.unroute(/\/dados\/redes-postos\.json/);
    await usarDadosDeTeste(page);
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByRole('button', { name: 'Ver quanto rende' })).toBeEnabled();
  });
});
