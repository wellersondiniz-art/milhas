// Fluxo 2: salvar o perfil. Marca programa, clube e cartão; o perfil fica no
// aparelho (localStorage), volta depois de recarregar e muda a conta.
// Também: exportar/importar, apagar tudo e navegador que não deixa guardar.
//
// Com o perfil (Programa Alfa com clube desde 01/11 + Cartão Alfa), R$ 100,00 na Loja Teste:
//   100 × 15 (clube + cartão) + 100 × 2 (cartão) = 1.700 pontos → 1.700 × R$ 20,00 ÷ 1.000 = R$ 34,00
import { readFile } from 'node:fs/promises';
import { abrirInicio, calcular, cartoesDoResultado, expect, fixarRelogio, test, usarDadosDeTeste } from './apoio.mjs';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await usarDadosDeTeste(page);
  await fixarRelogio(page);
});

const programaAlfa = (page) => page.getByRole('checkbox', { name: 'Programa Alfa', exact: true });
const clubeAlfa = (page) => page.getByRole('checkbox', { name: 'Assino o clube Programa Alfa' });
const cartaoAlfa = (page) => page.getByRole('checkbox', { name: /^Cartão Alfa Platinum/ });
const status = (page) => page.locator('#perfil-status');

async function marcarPerfil(page) {
  await abrirInicio(page, '/#/perfil');
  await expect(page.getByRole('heading', { level: 1, name: 'Meu perfil' })).toBeVisible();
  await programaAlfa(page).check();
  await clubeAlfa(page).check();
  await page.locator('#perfil-programa-alfa-desde').fill('2026-11-01');
  await cartaoAlfa(page).check();
  await expect(status(page)).toHaveText('Salvo neste aparelho.');
}

test('marca o perfil, ele continua depois de recarregar e a conta passa a usar só ele', async ({ page }) => {
  await marcarPerfil(page);

  await page.reload();
  await expect(programaAlfa(page)).toBeChecked();
  await expect(clubeAlfa(page)).toBeChecked();
  await expect(page.locator('#perfil-programa-alfa-desde')).toHaveValue('2026-11-01');
  await expect(cartaoAlfa(page)).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^Cartão Beta Gold/ })).not.toBeChecked();

  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Comparar' }).click();
  await expect(page.locator('#convite-perfil')).toContainText('A conta usa o seu perfil: 1 programa (1 com clube) e 1 cartão.');
  await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
  const cartoes = cartoesDoResultado(page);
  await expect(cartoes).toHaveCount(2); // com oferta e sem oferta, só com o Cartão Alfa
  await expect(cartoes.first()).toContainText('R$ 34,00');
  await expect(cartoes.first()).toContainText('1.700 pontos');
});

test('o perfil não sai do aparelho: nenhum pedido de rede leva o que foi marcado', async ({ page }) => {
  const pedidos = [];
  page.on('request', (pedido) => pedidos.push(`${pedido.method()} ${pedido.url()} ${pedido.postData() ?? ''}`));
  await marcarPerfil(page);
  await page.reload();
  await expect(cartaoAlfa(page)).toBeChecked();
  for (const p of pedidos) {
    expect(p).not.toMatch(/cartao-alfa|programa-alfa.*clube|clube_ativo|2026-11-01/);
    expect(p.startsWith('GET ')).toBe(true);
  }
  const guardado = await page.evaluate(() => localStorage.getItem('comprador-de-milhas:perfil'));
  expect(JSON.parse(guardado)).toMatchObject({ cartoes: ['cartao-alfa'] });
});

test('exporta para um arquivo e importa de volta', async ({ page }) => {
  await marcarPerfil(page);
  const baixando = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar perfil' }).click();
  const arquivo = await baixando;
  expect(arquivo.suggestedFilename()).toBe('meu-perfil-milhas-2026-11-10.json');
  const caminho = await arquivo.path();
  const conteudo = JSON.parse(await readFile(caminho, 'utf8'));
  expect(conteudo).toMatchObject({ cartoes: ['cartao-alfa'], programas: [{ programa_id: 'programa-alfa', clube_ativo: true, clube_ativo_desde: '2026-11-01' }] });

  // Apaga e traz de volta pelo arquivo.
  await page.getByRole('button', { name: 'Apagar tudo' }).click();
  await page.getByRole('button', { name: 'Sim, apagar tudo' }).click();
  await expect(cartaoAlfa(page)).not.toBeChecked();

  await page.locator('#perfil-arquivo').setInputFiles(caminho);
  await expect(page.getByText('Perfil importado', { exact: true })).toBeVisible();
  await expect(programaAlfa(page)).toBeChecked();
  await expect(cartaoAlfa(page)).toBeChecked();
});

test('importar arquivo quebrado não muda nada', async ({ page }) => {
  await marcarPerfil(page);
  await page.locator('#perfil-arquivo').setInputFiles({
    name: 'perfil.json', mimeType: 'application/json', buffer: Buffer.from('{ isto não é json'),
  });
  await expect(page.getByRole('alert')).toContainText('Não importamos esse arquivo');
  await expect(cartaoAlfa(page)).toBeChecked();
});

test('apagar tudo pede confirmação; cancelar não apaga', async ({ page }) => {
  await marcarPerfil(page);
  await page.getByRole('button', { name: 'Apagar tudo' }).click();
  await expect(page.getByText('Tem certeza?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(cartaoAlfa(page)).toBeChecked();

  await page.getByRole('button', { name: 'Apagar tudo' }).click();
  await page.getByRole('button', { name: 'Sim, apagar tudo' }).click();
  await expect(status(page)).toContainText('Tudo apagado deste aparelho.');
  await page.reload();
  await expect(programaAlfa(page)).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('comprador-de-milhas:perfil'))).toBeNull();
});

test('navegador que não deixa guardar (modo privado): avisa e o perfil vale nesta aba', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('O acesso ao armazenamento foi negado.', 'SecurityError'); },
    });
  });
  await abrirInicio(page, '/#/perfil');
  await expect(page.getByText('Este navegador não deixa guardar dados')).toBeVisible();
  await programaAlfa(page).check();
  await expect(status(page)).toHaveText('Salvo neste aparelho. Vale só enquanto esta aba estiver aberta.');

  // Trocar de tela não perde o que foi marcado.
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Comparar' }).click();
  await expect(page.locator('#convite-perfil')).toContainText('A conta usa o seu perfil');
});

test('vencimento dos pontos: a data do extrato vira aviso no topo e fica no aparelho', async ({ page }) => {
  await marcarPerfil(page);
  const vencimentos = page.locator('#perfil-vencimentos');
  await expect(vencimentos).toBeHidden();
  // Relógio do teste: 10/11/2026. 20/11 está a 10 dias.
  await page.getByLabel('Quando vencem os próximos pontos Programa Alfa?').fill('2026-11-20');
  await expect(vencimentos).toContainText('Pontos vencendo');
  await expect(vencimentos).toContainText('Programa Alfa: vence em 10 dias (20/11/2026).');
  await page.reload();
  await expect(page.locator('#perfil-programa-alfa-vence')).toHaveValue('2026-11-20');
  await expect(vencimentos).toContainText('vence em 10 dias');
  // Longe: some o alerta e fica só a confirmação.
  await page.locator('#perfil-programa-alfa-vence').fill('2027-06-01');
  await expect(vencimentos).toContainText('Nenhum ponto vence nos próximos 90 dias');
});
