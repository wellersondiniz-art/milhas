// Fluxo 1: calcular. Loja → valor → resultado, com teclado e com toque.
// Usa os dados falsos de dados-de-teste/ e o relógio parado em 10/11/2026.
//
// Sem perfil, a conta usa todos os cartões e programas (Programa Alfa e Beta,
// sem clube). Compra de R$ 100,00 na Loja Teste:
//   1º oferta + Cartão Alfa: 100 × 9 + 100 × 2 = 1.100 pontos Alfa → 1.100 × R$ 20,00 ÷ 1.000 = R$ 22,00
//   2º oferta + Cartão Beta: 100 × 7 (Alfa) + 100 × 3 (Beta) = 1.000 pontos (Beta sem milheiro;
//      só a parte Alfa já vale 700 × R$ 20,00 ÷ 1.000 = R$ 14,00, e isso conta na ordem)
//   3º sem oferta, Cartão Alfa: 200 pontos → R$ 4,00
//   4º sem oferta, Cartão Beta: 300 pontos (sem valor em reais conhecido)
// A ordem é pelo valor em reais, não pela soma de pontos de programas diferentes.
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
    await expect(cartoes.nth(2)).toContainText('R$ 4,00');
    await expect(cartoes.nth(3)).toContainText('Cartão Beta Gold');
  });

  test('link de afiliado para a loja: depois do resultado, com rel sponsored e aviso de comissão visível', async ({ page }) => {
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    const link = page.getByRole('link', { name: 'Ir para a loja Loja Teste' });
    await expect(link).toHaveAttribute('href', 'https://www.loja-teste.invalid/?parceiro=codigo-de-teste');
    await expect(link).toHaveAttribute('rel', 'sponsored noopener noreferrer');
    await expect(link).toHaveAccessibleDescription('Podemos ganhar uma comissão se você comprar por aqui, sem custo extra para você.');
    await expect(page.getByText('Podemos ganhar uma comissão se você comprar por aqui, sem custo extra para você.')).toBeVisible();
    // O link vem depois de todos os jeitos: a ordem é só pelo resultado da conta.
    const depoisDoUltimo = await cartoesDoResultado(page).last().evaluate((ultimo, a) => Boolean(ultimo.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING), await link.elementHandle());
    expect(depoisDoUltimo).toBe(true);
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
    // Link comum (sem código de afiliado): sem "sponsored" e sem aviso de comissão.
    const link = page.getByRole('link', { name: 'Ir para a loja Outra Loja' });
    await expect(link).toHaveAttribute('href', 'https://outra-loja.invalid/');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByText('Podemos ganhar uma comissão', { exact: false })).toHaveCount(0);
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

  test('sem cotação do dólar e sem oferta: uma mensagem só, sem "Melhor jeito" em cima de "Nenhum ponto"', async ({ page }) => {
    // Força a cotação "A_CONFIRMAR", para o teste não depender de quando ela for preenchida.
    await page.route('**/dados/cambio.json', async (rota) => {
      const resposta = await rota.fetch();
      const cambio = (await resposta.json()).map((c) => ({ ...c, reais_por_dolar: 'A_CONFIRMAR', data_referencia: 'A_CONFIRMAR' }));
      await rota.fulfill({ response: resposta, json: cambio });
    });
    await page.route('**/dados/ofertas.json', (rota) => rota.fulfill({ json: [] }));
    await abrirInicio(page, '/?loja=magalu');
    await page.getByRole('textbox', { name: 'Quanto vai custar?' }).fill('50000');
    await page.getByRole('button', { name: 'Ver o resultado' }).click();
    // Desde a primeira tela sem cadastro (PR 38), o pedido do dólar vem com o campo ali mesmo.
    await expect(page.getByText('Falta só a cotação do dólar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Informar o dólar' })).toBeVisible();
    await expect(cartoesDoResultado(page)).toHaveCount(0);
    await expect(page.locator('#resultado')).not.toContainText('Melhor jeito');
  });

  test('Magalu sem perfil: oferta real com selo de data e fonte, e destaque da campanha', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T15:00:00-03:00'));
    await abrirInicio(page, '/?loja=magalu');
    await page.getByRole('textbox', { name: 'Quanto vai custar?' }).fill('100000');
    await page.getByRole('button', { name: 'Ver o resultado' }).click();
    const melhor = cartoesDoResultado(page).first();
    await expect(melhor).toContainText('Conferido hoje (25/11/2026)');
    await expect(melhor.getByRole('link', { name: 'livelo.com.br', exact: true })).toHaveAttribute('href', /^https:\/\/www\.livelo\.com\.br\//);
    await expect(melhor).toContainText('Rende mais nesta oferta');
  });

  test('Amazon: diz o que conferimos e por que não há oferta, com fonte', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T15:00:00-03:00'));
    await abrirInicio(page, '/?loja=amazon');
    await page.getByRole('textbox', { name: 'Quanto vai custar?' }).fill('10000');
    await page.getByRole('button', { name: 'Ver o resultado' }).click();
    await expect(page.getByText('A Amazon não tem oferta de pontos valendo hoje')).toBeVisible();
    await expect(page.getByText(/A Livelo diz que a parceria para juntar pontos na Amazon está inativa\. Conferido hoje/)).toBeVisible();
  });

  test('toda loja calcula sem erro', async ({ page }) => {
    const lojas = JSON.parse(await readFile(new URL('../../dados/lojas.json', import.meta.url), 'utf8'));
    for (const loja of lojas) {
      await abrirInicio(page, `/?loja=${loja.id}`);
      await page.getByRole('textbox', { name: 'Quanto vai custar?' }).fill('129900');
      await page.getByRole('button', { name: 'Ver o resultado' }).click();
      const na = { o: 'no', as: 'nas', os: 'nos' }[loja.artigo] ?? 'na';
      await expect(page.getByRole('heading', { level: 2, name: `R$ 1.299,00 ${na} ${loja.nome}` })).toBeVisible();
      await expect(cartoesDoResultado(page).first()).toContainText('Melhor jeito');
      // Todo card mostra quando o dado foi conferido.
      await expect(cartoesDoResultado(page).first()).toContainText('Conferido');
      await expect(page.getByText('Não deu para calcular')).toHaveCount(0);
    }
  });
});
