// "Salas VIP pelo cartão" com os dados reais, no dia em que foram conferidos.
import { expect, fixarRelogio, test } from './apoio.mjs';

test.beforeEach(async ({ page }) => {
  await fixarRelogio(page, new Date('2026-11-26T12:00:00-03:00'));
});

test('lista os cartões do que dá mais acesso ao que dá menos, com fonte', async ({ page }) => {
  await page.goto('/salas-vip/');
  const lista = page.locator('#salas-lista');
  await expect(lista).not.toHaveAttribute('aria-busy', 'true');
  const primeiro = lista.locator('li.card').first();
  await expect(primeiro.getByRole('heading', { level: 3 })).toHaveText('Bradesco Visa Aeternum');
  await expect(primeiro).toContainText('Bradesco Lounge');
  await expect(primeiro).toContainText('Acesso ilimitado');
  await expect(primeiro.getByRole('link', { name: 'Fonte oficial' }).first()).toHaveAttribute('href', /^https:\/\/banco\.bradesco\//);
  await expect(lista).toContainText('Sem sala VIP confirmada');
  await expect(lista).toContainText('Azul Itaú Platinum');
  // Sem perfil, o filtro nem aparece.
  await expect(page.locator('#salas-filtro')).toBeHidden();
});

test('com cartões no perfil, dá para ver só os seus (pelo teclado)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('comprador-de-milhas:perfil', JSON.stringify({
      versao: 2, programas: [], cartoes: ['c6-carbon', 'azul-itau-platinum'], valor_milheiro_brl: {},
    }));
  });
  await page.goto('/salas-vip/');
  const filtro = page.getByRole('checkbox', { name: 'Só os cartões do meu perfil' });
  await expect(filtro).toBeVisible();
  await filtro.focus();
  await page.keyboard.press('Space');
  const cartoes = page.locator('#salas-lista li.card');
  await expect(cartoes).toHaveCount(1);
  await expect(cartoes.first()).toContainText('C6 Carbon');
  await expect(cartoes.first()).toContainText('4 acessos grátis por ano');
  await expect(page.locator('#salas-lista')).toContainText('Azul Itaú Platinum');
  await expect(page.locator('#salas-anuncio')).toHaveText('1 cartão com sala VIP.');
});

test('a página de viagens leva para as salas VIP', async ({ page }) => {
  await page.goto('/viagens/');
  await page.getByRole('link', { name: 'Salas VIP pelo cartão' }).click();
  await expect(page).toHaveURL(/\/salas-vip\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Salas VIP pelo cartão');
});
