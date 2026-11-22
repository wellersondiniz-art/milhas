// Fluxo 1: calcular. Loja → valor → resultado, com teclado e com toque.
// Usa os dados falsos de dados-de-teste/ e o relógio parado em 10/11/2026.
//
// Sem perfil, a conta usa todos os cartões e programas (Programa Alfa e Beta,
// sem clube). Compra de R$ 100,00 na Loja Teste:
//   1º oferta + Cartão Alfa: 100 × 9 + 100 × 2 = 1.100 pontos Alfa → 1.100 × R$ 20,00 ÷ 1.000 = R$ 22,00
//   2º oferta + Cartão Beta: 100 × 7 (Alfa) + 100 × 3 (Beta) = 1.000 pontos (Beta sem milheiro)
//   3º sem oferta, Cartão Beta: 300 pontos
//   4º sem oferta, Cartão Alfa: 200 pontos → R$ 4,00
import { readFile } from 'node:fs/promises';
import {
  abrirInicio, calcular, cartoesDoResultado, escolherLojaPeloTeclado, expect, fixarRelogio, test, usarDadosDeTeste,
} from './apoio.mjs';

test.describe('com dados de teste', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await usarDadosDeTeste(page);
    await fixarRelogio(page);
  });

  test('calcula só com o teclado e mostra o melhor jeito primeiro', async ({ page }) => {
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });

    await expect(page.getByRole('textbox', { name: 'Quanto vai custar?' })).toHaveValue('100,00');
    const titulo = page.getByRole('heading', { level: 2, name: 'R$ 100,00 na Loja Teste' });
    await expect(titulo).toBeVisible();
    await expect(titulo).toBeFocused();

    const cartoes = cartoesDoResultado(page);
    await expect(cartoes).toHaveCount(4);
    await expect(cartoes.nth(0)).toContainText('Melhor jeito');
    await expect(cartoes.nth(0)).toContainText('R$ 22,00');
    await expect(cartoes.nth(0)).toContainText('Cartão Alfa Platinum');
    await expect(cartoes.nth(0)).toContainText('1.100 pontos');
    await expect(cartoes.nth(1)).toContainText('Cartão Beta Gold');
    await expect(cartoes.nth(3)).toContainText('R$ 4,00');
  });

  test('"Como calcular" abre a conta passo a passo', async ({ page }) => {
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    const primeiro = cartoesDoResultado(page).first();
    await primeiro.getByText('Como calcular', { exact: true }).click();
    await expect(primeiro.getByText('Pontos do programa: R$ 100,00 × 9 = 900 pontos.')).toBeVisible();
  });

  test('escolhe a loja tocando na lista', async ({ page }) => {
    await abrirInicio(page);
    const campo = page.getByRole('combobox', { name: 'Em qual loja você vai comprar?' });
    await campo.click();
    await campo.pressSequentially('outra');
    await page.getByRole('option', { name: 'Outra Loja' }).click();
    await expect(campo).toHaveValue('Outra Loja');
    await page.getByRole('textbox', { name: 'Quanto vai custar?' }).fill('5000');
    await page.getByRole('button', { name: 'Ver o resultado' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'R$ 50,00 na Outra Loja' })).toBeVisible();
    // Sem oferta nessa loja: só os dois cartões.
    await expect(cartoesDoResultado(page)).toHaveCount(2);
    await expect(cartoesDoResultado(page).first()).toContainText('Sem oferta');
  });

  test('aponta o que falta: loja fora da lista e valor zero', async ({ page }) => {
    await abrirInicio(page);
    const campo = page.getByRole('combobox', { name: 'Em qual loja você vai comprar?' });
    await campo.fill('Loja que não existe');
    await expect(page.getByText('Não achamos essa loja.', { exact: false })).toBeVisible();
    await campo.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
    await page.getByRole('button', { name: 'Ver o resultado' }).click();
    await expect(page.getByText('Escolha uma loja da lista.')).toBeVisible();
    await expect(campo).toHaveAttribute('aria-invalid', 'true');

    await escolherLojaPeloTeclado(page, 'loj', 'Loja Teste');
    await expect(campo).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Ver o resultado' }).click();
    const valor = page.getByRole('textbox', { name: 'Quanto vai custar?' });
    await expect(valor).toHaveAttribute('aria-invalid', 'true');
    await expect(valor).toBeFocused();
    await expect(page.locator('#passo-resultado')).toBeHidden();
  });

  test('vindo da página da loja (?loja=), a loja já chega escolhida', async ({ page }) => {
    await abrirInicio(page, '/?loja=loja-teste');
    await expect(page.getByRole('combobox', { name: 'Em qual loja você vai comprar?' })).toHaveValue('Loja Teste');
    await expect(page.getByRole('textbox', { name: 'Quanto vai custar?' })).toBeVisible();
  });
});

test.describe('quando os dados não carregam', () => {
  test.use({ serviceWorkers: 'block', erroEsperado: /lojas\.json|Failed to load resource|503/ });

  test('mostra o erro e "Tentar de novo" funciona', async ({ page }) => {
    let falhar = true;
    await usarDadosDeTeste(page);
    await page.route(/\/dados\/lojas\.json/, async (rota) => {
      if (falhar) await rota.fulfill({ status: 503, body: 'fora do ar' });
      else await rota.fallback();
    });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('A internet falhou ou o site está fora do ar');
    falhar = false;
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByRole('combobox', { name: 'Em qual loja você vai comprar?' })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('com os dados reais do repositório', () => {
  test.use({ serviceWorkers: 'block' });

  test('toda loja calcula sem erro', async ({ page }) => {
    const lojas = JSON.parse(await readFile(new URL('../../dados/lojas.json', import.meta.url), 'utf8'));
    for (const loja of lojas) {
      await abrirInicio(page, `/?loja=${loja.id}`);
      await page.getByRole('textbox', { name: 'Quanto vai custar?' }).fill('129900');
      await page.getByRole('button', { name: 'Ver o resultado' }).click();
      await expect(page.getByRole('heading', { level: 2, name: `R$ 1.299,00 na ${loja.nome}` })).toBeVisible();
      await expect(cartoesDoResultado(page).first()).toContainText('Melhor jeito');
      await expect(page.getByText('Não deu para calcular')).toHaveCount(0);
    }
  });
});
