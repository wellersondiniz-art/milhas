// Ciclo de vida da oferta na calculadora, com o relógio do navegador.
// A oferta de teste vale de 01/11 a 30/11/2026 e foi conferida em 05/11/2026.
// O dia vira à meia-noite de Brasília, qualquer que seja o fuso do aparelho.
import { readFile } from 'node:fs/promises';
import { abrirInicio, calcular, cartoesDoResultado, expect, fixarRelogio, test, usarDadosDeTeste } from './apoio.mjs';

const LOJA = { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' };

test.describe('ciclo de vida da oferta', () => {
  test.use({ serviceWorkers: 'block', timezoneId: 'Asia/Tokyo' });

  test.beforeEach(async ({ page }) => {
    await usarDadosDeTeste(page);
  });

  test('a 2 dias do fim: selo "Vence em 2 dias"', async ({ page }) => {
    await fixarRelogio(page, new Date('2026-11-28T12:00:00-03:00'));
    await abrirInicio(page);
    await calcular(page, LOJA);
    const melhor = cartoesDoResultado(page).first();
    await expect(melhor.locator('.selo--aviso', { hasText: 'Vence em 2 dias' })).toBeVisible();
    await expect(melhor).toContainText('A oferta vence em 2 dias (30/11/2026).');
  });

  test('último dia às 23:59 de Brasília: ainda vale, "Vence hoje"', async ({ page }) => {
    // Em Tóquio já é 01/12 às 11:59; para a oferta, conta Brasília.
    await fixarRelogio(page, new Date('2026-11-30T23:59:00-03:00'));
    await abrirInicio(page);
    await calcular(page, LOJA);
    await expect(cartoesDoResultado(page).first().locator('.selo--aviso', { hasText: 'Vence hoje' })).toBeVisible();
    await expect(cartoesDoResultado(page).first()).toContainText('R$ 22,00');
  });

  test('meia-noite de Brasília: a oferta sai do ranking', async ({ page }) => {
    await fixarRelogio(page, new Date('2026-12-01T00:00:00-03:00'));
    await abrirInicio(page);
    await calcular(page, LOJA);
    await expect(page.getByText('A Loja Teste não tem oferta de pontos valendo hoje')).toBeVisible();
    await expect(page.getByText('Vence hoje')).toHaveCount(0);
  });

  test('conferida há mais de 30 dias: sai do ranking mesmo dentro da validade', async ({ page }) => {
    // 05/11 + 31 dias = 06/12; a oferta vale até 30/11, então simulamos uma oferta mais longa.
    const ofertas = JSON.parse(await readFile(new URL('./dados-de-teste/ofertas.json', import.meta.url), 'utf8'));
    ofertas[0].fim = '2026-12-31';
    await page.route(/\/dados\/ofertas\.json(\?.*)?$/, (rota) => rota.fulfill({ json: ofertas }));
    await fixarRelogio(page, new Date('2026-12-05T12:00:00-03:00'));
    await abrirInicio(page);
    await calcular(page, LOJA);
    await expect(cartoesDoResultado(page).first()).toContainText('Dado antigo');
    await expect(cartoesDoResultado(page).first()).toContainText('Melhor jeito');
    await expect(page.getByText('A Loja Teste não tem oferta de pontos valendo hoje')).toHaveCount(0);

    await fixarRelogio(page, new Date('2026-12-06T12:00:00-03:00'));
    await page.reload();
    await expect(page.locator('#loja')).toBeEnabled();
    await calcular(page, LOJA);
    await expect(page.getByText('A Loja Teste não tem oferta de pontos valendo hoje')).toBeVisible();
  });
});
