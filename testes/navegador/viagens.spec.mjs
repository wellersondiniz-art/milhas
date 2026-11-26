// Fluxo 4: "Milhas em viagens" com os dados reais, no dia em que foram conferidos.
import { expect, fixarRelogio, test } from './apoio.mjs';

const DIA_DOS_DADOS = new Date('2026-11-25T12:00:00-03:00');

test.beforeEach(async ({ page }) => {
  await fixarRelogio(page, DIA_DOS_DADOS);
  await page.goto('/viagens/');
  await expect(page.locator('#transferir-ver')).toBeEnabled();
});

test('mostra o bônus de hoje e o menu leva para Viagens', async ({ page }) => {
  await expect(page.locator('#bonus-hoje-lista')).toContainText('Livelo → Smiles: até 80% de bônus');
  await expect(page.locator('#bonus-hoje-lista')).toContainText('Termina hoje.');
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Viagens' })).toHaveAttribute('aria-current', 'page');
});

test('transfere só com o teclado: 50.000 Livelo com clube viram 90.000 Smiles', async ({ page }) => {
  await page.locator('#transferir-origem').selectOption({ label: 'Livelo' });
  await page.locator('#transferir-pontos').focus();
  await page.keyboard.type('50000');
  await expect(page.locator('#transferir-pontos')).toHaveValue('50.000');
  await page.locator('#transferir-clube').focus();
  await page.keyboard.press('Space');
  await page.locator('#transferir-pontos').focus();
  await page.keyboard.press('Enter');
  const resultado = page.locator('#transferir-resultado');
  await expect(resultado).toBeVisible();
  await expect(resultado).toContainText('90.000 pontos Smiles');
  await expect(resultado).toContainText('Bônus de 80% hoje');
  await expect(page.locator('#viagens-anuncio')).toContainText('Rende mais na');
});

test('bônus digitado refaz a conta do card', async ({ page }) => {
  await page.locator('#transferir-pontos').fill('10000');
  await page.locator('#transferir-origem').selectOption({ label: 'Livelo' });
  await page.locator('#transferir-ver').click();
  const latam = page.locator('article', { hasText: 'Livelo → LATAM Pass' });
  await expect(latam).toContainText('10.000 pontos LATAM Pass');
  await latam.getByText('Viu outro bônus? Refaça a conta').click();
  await latam.getByLabel('Bônus da LATAM Pass hoje, em %').fill('50');
  await latam.getByRole('button', { name: 'Refazer a conta' }).click();
  await expect(page.locator('article', { hasText: 'Livelo → LATAM Pass' })).toContainText('15.000 pontos LATAM Pass');
});

test('pede os pontos antes de calcular', async ({ page }) => {
  await page.locator('#transferir-ver').click();
  await expect(page.locator('#transferir-pontos-erro')).toHaveText('Digite quantos pontos você tem.');
  await expect(page.locator('#transferir-pontos')).toHaveAttribute('aria-invalid', 'true');
});

test('passagem LATAM nacional: R$ 400 rendem 600 pontos e a categoria muda a conta', async ({ page }) => {
  await page.locator('#passagem-companhia').selectOption('LATAM');
  await page.locator('#passagem-valor').fill('40000');
  await page.locator('#passagem-ver').click();
  const resultado = page.locator('#passagem-resultado');
  await expect(resultado).toContainText('600 pontos LATAM Pass');
  await page.locator('#categoria-latam-pass').selectOption({ label: 'Platinum' });
  await expect(resultado).toContainText('1.400 pontos LATAM Pass');
  await page.reload();
  await expect(page.locator('#categoria-latam-pass')).toHaveValue(/platinum/i);
});

test('passagem internacional pede a cotação do dólar e usa a digitada', async ({ page }) => {
  await page.locator('#passagem-companhia').selectOption('GOL');
  await page.getByLabel('Fora da América do Sul').check();
  await page.locator('#passagem-valor').fill('300000');
  await page.locator('#passagem-ver').click();
  await expect(page.locator('#passagem-resultado')).toContainText('falta a cotação');
  await page.getByText('Cotação do dólar (opcional)').click();
  await page.locator('#passagem-dolar').fill('60000');
  await page.locator('#passagem-ver').click();
  // R$ 3.000 ÷ 6 = US$ 500 × 5 Smiles por dólar = 2.500
  await expect(page.locator('#passagem-resultado')).toContainText('2.500 pontos Smiles');
});

test('hotel: compara Accor e Booking pela Smiles', async ({ page }) => {
  await page.locator('#hotel-valor').fill('90000');
  await page.locator('#hotel-ver').click();
  const resultado = page.locator('#hotel-resultado');
  await expect(resultado).toContainText('pontos ALL Accor');
  await expect(resultado).toContainText('1.800 pontos Smiles');
});
