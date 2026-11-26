// Fluxo da primeira visita e da decisão final, com os dados de teste e o
// relógio parado em 10/11/2026.
//
// Sem perfil, R$ 1.000,00 na Loja Teste (oferta do Programa Alfa):
//   melhor: oferta + Cartão Alfa: 1.000 × 9 + 1.000 × 2 = 11.000 pontos × R$ 20 ÷ 1.000 = R$ 220,00
//   sem cartão de pontos: 1.000 × 7 = 7.000 pontos → R$ 140,00
//   com clube desde 01/11 e Cartão Alfa: 1.000 × 15 + 1.000 × 2 = 17.000 pontos → R$ 340,00
import { abrirInicio, cartoesDoResultado, expect, fixarRelogio, test, usarDadosDeTeste } from './apoio.mjs';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await usarDadosDeTeste(page);
  await fixarRelogio(page);
});

test('um toque num exemplo já mostra o resultado, com os padrões da conta à vista', async ({ page }) => {
  await abrirInicio(page);
  await page.getByRole('button', { name: 'Loja Teste · R$ 1.000,00' }).click();
  const titulo = page.getByRole('heading', { level: 2, name: 'R$ 1.000,00 na Loja Teste' });
  await expect(titulo).toBeFocused();
  await expect(cartoesDoResultado(page).first()).toContainText('R$ 220,00');
  const supos = page.getByRole('region', { name: 'O que a conta supôs' });
  await expect(supos).toContainText('Todos os 2 cartões de pontos que conhecemos.');
  await expect(supos).toContainText('Sem assinatura de clube de pontos.');
  await expect(supos).toContainText('1.000 pontos Programa Alfa valem uns R$ 20,00 (estimativa média).');
  // Os cartões de teste dão pontos por real: o campo do dólar não aparece.
  await expect(page.getByLabel('Quanto está o dólar?')).toHaveCount(0);
});

test('ajuste rápido: muda o cartão e o clube, refaz a conta, guarda e não tira o foco', async ({ page }) => {
  await abrirInicio(page);
  await page.getByRole('button', { name: 'Loja Teste · R$ 1.000,00' }).click();
  await page.getByText('Mudar para o meu caso').click();

  const seletor = page.getByLabel('Com qual cartão você vai pagar?');
  await seletor.focus();
  await seletor.selectOption('nenhum');
  await expect(cartoesDoResultado(page).first()).toContainText('R$ 140,00');
  await expect(seletor).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Pronto: a conta foi refeita' })).toBeVisible();
  await expect(page.locator('#convite-perfil')).toContainText('A conta usa o seu perfil');

  await seletor.selectOption('cartao-alfa');
  await page.getByLabel('Assino o clube Programa Alfa').check();
  await page.getByLabel('Desde quando?').fill('2026-11-01');
  await page.getByLabel('Desde quando?').blur();
  await expect(cartoesDoResultado(page).first()).toContainText('R$ 340,00');
  await expect(page.getByRole('region', { name: 'O que a conta supôs' })).toContainText('Com clube ativo: Programa Alfa.');

  const salvo = await page.evaluate(() => JSON.parse(localStorage.getItem('comprador-de-milhas:perfil')));
  expect(salvo.cartoes).toEqual(['cartao-alfa']);
  expect(salvo.programas.find((p) => p.programa_id === 'programa-alfa')).toEqual({ programa_id: 'programa-alfa', clube_ativo: true, clube_ativo_desde: '2026-11-01' });

  // Recarregando, o ajuste continua.
  await page.reload();
  await page.getByRole('button', { name: 'Loja Teste · R$ 1.000,00' }).click();
  await expect(cartoesDoResultado(page).first()).toContainText('R$ 340,00');
});

test('vale a pena: pontos x cashback x desconto e anuidade', async ({ page }) => {
  await abrirInicio(page);
  await page.getByRole('button', { name: 'Loja Teste · R$ 1.000,00' }).click();
  const vale = page.getByRole('region', { name: 'Vale a pena?' });

  // R$ 220,00 em pontos contra 5% de cashback (R$ 50,00): os pontos ganham.
  // Empate: R$ 50,00 ÷ 11.000 pontos × 1.000 = R$ 4,5454… → R$ 4,55.
  await vale.getByLabel('Cashback oferecido (%)').fill('5');
  await expect(vale).toContainText('Os pontos valem mais: uns R$ 220,00 contra R$ 50,00. Mas só se você usar 1.000 pontos por mais de R$ 4,55');

  // Desconto de R$ 300,00 ganha.
  await vale.getByLabel('O desconto é em').selectOption('reais');
  await vale.getByLabel('Desconto à vista ou cupom').fill('300');
  await expect(vale).toContainText('O desconto rende mais: R$ 300,00 contra uns R$ 220,00 em pontos.');

  await vale.getByLabel('Cashback oferecido (%)').fill('abc');
  await expect(vale.getByRole('alert')).toContainText('Cashback: use um número de 0 a 100');

  // Os cartões de teste não têm anuidade.
  await expect(vale).toContainText('O cartão Cartão Alfa Platinum não tem anuidade no nosso cadastro');
});

test('jeitos a mais ficam em "Ver mais", sem sumir da conta', async ({ page }) => {
  await abrirInicio(page);
  await page.getByRole('button', { name: 'Loja Teste · R$ 1.000,00' }).click();
  // 4 jeitos: o melhor, mais 2 abertos e 1 em "Ver mais".
  await expect(cartoesDoResultado(page)).toHaveCount(4);
  const mais = page.getByText('Ver mais 1 jeito');
  await expect(cartoesDoResultado(page).nth(3)).toBeHidden();
  await mais.click();
  await expect(cartoesDoResultado(page).nth(3)).toBeVisible();
});
