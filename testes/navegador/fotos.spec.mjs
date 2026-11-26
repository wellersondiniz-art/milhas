// Regressão visual: compara a tela com as fotos de referência em fotos/<projeto>/.
//
// As fotos foram tiradas no Linux da imagem oficial do Playwright (a mesma do
// CI). Em outro sistema a letra sai um pouco diferente, então aqui as fotos só
// são comparadas no CI ou com FOTOS=1 (npm run test:fotos, que usa o Docker).
//
// Mudou a tela de propósito? Atualize as fotos com npm run test:fotos:atualizar
// e confira as imagens novas no diff do pull request.
import { abrirInicio, calcular, expect, fixarRelogio, test, usarDadosDeTeste } from './apoio.mjs';

test.skip(!process.env.CI && !process.env.FOTOS, 'Fotos só no CI ou com FOTOS=1 (npm run test:fotos).');

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await usarDadosDeTeste(page);
  await fixarRelogio(page);
});

async function marcarPerfil(page) {
  await abrirInicio(page, '/#/perfil');
  await page.getByRole('checkbox', { name: 'Programa Alfa', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Assino o clube Programa Alfa' }).check();
  await page.locator('#perfil-programa-alfa-desde').fill('2026-11-01');
  await page.getByRole('checkbox', { name: /^Cartão Alfa Platinum/ }).check();
  await expect(page.locator('#perfil-status')).toHaveText('Salvo neste aparelho.');
}

for (const tema of ['claro', 'escuro']) {
  test.describe(`tema ${tema}`, () => {
    test.use({ colorScheme: tema === 'claro' ? 'light' : 'dark' });

    test('tela inicial', async ({ page }) => {
      await abrirInicio(page);
      await expect(page).toHaveScreenshot(`inicio-${tema}.png`);
    });

    test('resultado', async ({ page }) => {
      await abrirInicio(page);
      await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
      await expect(page.getByRole('heading', { level: 2, name: 'R$ 100,00 na Loja Teste' })).toBeFocused();
      await expect(page).toHaveScreenshot(`resultado-${tema}.png`, { fullPage: true });
    });

    test('abastecer', async ({ page }) => {
      await page.goto('/abastecer/');
      await expect(page.getByRole('button', { name: 'Ver quanto rende' })).toBeEnabled();
      await page.getByRole('textbox', { name: 'Quantos litros?' }).fill('40');
      await page.getByRole('textbox', { name: 'Preço do litro na bomba (opcional)' }).pressSequentially('5000');
      await page.getByRole('button', { name: 'Ver quanto rende' }).click();
      await expect(page.getByRole('heading', { level: 2, name: '40 litros de gasolina comum' })).toBeFocused();
      await expect(page).toHaveScreenshot(`abastecer-${tema}.png`, { fullPage: true });
    });

    test('meu perfil', async ({ page }) => {
      await marcarPerfil(page);
      await page.locator('#perfil-titulo').focus();
      await expect(page).toHaveScreenshot(`perfil-${tema}.png`, { fullPage: true });
    });
  });
}

test('página sem internet', async ({ page }) => {
  await page.goto('/offline.html');
  await expect(page).toHaveScreenshot('sem-internet.png');
});

test('lista de lojas aberta', async ({ page }) => {
  await abrirInicio(page);
  const campo = page.getByRole('combobox', { name: 'Em qual loja você vai comprar?' });
  await campo.click();
  await campo.pressSequentially('lo');
  await expect(page.getByRole('option', { name: 'Loja Teste' })).toBeVisible();
  await expect(page).toHaveScreenshot('lista-de-lojas.png');
});
