// "Meu cartão não está na lista": a pessoa adiciona um cartão com os números
// dela, ele fica no aparelho, entra na conta marcado como "informado por você",
// vai junto no arquivo exportado e pode ser removido. Nada sai do aparelho.
import { readFile } from 'node:fs/promises';
import { abrirInicio, calcular, cartoesDoResultado, expect, fixarRelogio, test, usarDadosDeTeste } from './apoio.mjs';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await usarDadosDeTeste(page);
  await fixarRelogio(page);
});

const status = (page) => page.locator('#perfil-status');
const meuCartao = (page) => page.getByRole('checkbox', { name: /^Cartão Zeta Gold/ });

async function adicionar(page, { nome = 'Cartão Zeta Gold', programa = 'Programa Alfa', porReal = '3', anuidade = '48000' } = {}) {
  await page.locator('#meu-cartao > summary').click();
  await page.getByLabel('Nome do cartão').fill(nome);
  await page.getByLabel('Programa em que os pontos caem').selectOption({ label: programa });
  await page.getByLabel('Pontos por real').fill(porReal);
  await page.getByLabel('Anuidade por ano (opcional)').fill(anuidade);
  await page.getByRole('button', { name: 'Adicionar meu cartão' }).click();
}

test('adiciona o cartão, ele entra na conta como "informado por você" e continua depois de recarregar', async ({ page }) => {
  const pedidos = [];
  page.on('request', (pedido) => pedidos.push(`${pedido.method()} ${pedido.url()} ${pedido.postData() ?? ''}`));
  await abrirInicio(page, '/#/perfil');
  await page.getByRole('checkbox', { name: 'Programa Alfa', exact: true }).check();
  await expect(status(page)).toHaveText('Salvo neste aparelho.');

  await adicionar(page);
  await expect(status(page)).toHaveText('Pronto: Cartão Zeta Gold foi adicionado e marcado. Ele já entra na conta.');
  await expect(meuCartao(page)).toBeChecked();
  await expect(meuCartao(page)).toBeFocused();
  await expect(page.locator('.perfil__proprio')).toContainText('informado por você · Programa Alfa · 3 pontos por real · anuidade R$ 480,00');

  await page.reload();
  await expect(meuCartao(page)).toBeChecked();

  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Comparar' }).click();
  await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
  const cartoes = cartoesDoResultado(page);
  await expect(cartoes.first()).toContainText('Cartão informado por você');
  await expect(cartoes.first()).toContainText('Cartão Zeta Gold: os pontos do cartão usam os números que você informou em Meu perfil. Não conferimos.');

  for (const p of pedidos) {
    expect(p).not.toMatch(/Zeta|meu-1|48000/);
    expect(p.startsWith('GET ')).toBe(true);
  }
});

test('nome com número de cartão é recusado e nada é salvo', async ({ page }) => {
  await abrirInicio(page, '/#/perfil');
  await adicionar(page, { nome: '4111 1111 1111 1111' });
  const nome = page.getByLabel('Nome do cartão');
  await expect(nome).toHaveAttribute('aria-invalid', 'true');
  await expect(nome).toBeFocused();
  await expect(page.locator('#meu-cartao-nome-erro')).toHaveText('Escreva só o nome do cartão. Nunca o número do cartão nem o CPF.');
  await expect(page.locator('.perfil__proprio')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('comprador-de-milhas:perfil'))).toBeNull();
});

test('sem perfil marcado, o cartão novo entra junto com todos e vai no arquivo exportado; depois sai com "Remover"', async ({ page }) => {
  await abrirInicio(page, '/#/perfil');
  await adicionar(page, { anuidade: '' });
  await expect(status(page)).toHaveText('Pronto: Cartão Zeta Gold foi adicionado. Ele já entra na conta, junto com todos os outros.');
  await expect(meuCartao(page)).not.toBeChecked();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar perfil' }).click(),
  ]);
  const arquivo = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(arquivo.cartoes_proprios).toEqual([{ id: 'meu-1', nome: 'Cartão Zeta Gold', programa_id: 'programa-alfa', pontos_por_real: 3 }]);

  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Comparar' }).click();
  await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
  await expect(page.locator('#resultado')).toContainText('Cartão informado por você');

  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Meu perfil' }).click();
  await page.getByRole('button', { name: 'Remover o cartão Cartão Zeta Gold' }).click();
  await expect(status(page)).toHaveText('Cartão Zeta Gold foi removido deste aparelho.');
  await expect(page.locator('.perfil__proprio')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('comprador-de-milhas:perfil'))).toBeNull();
});

test('o botão "O seu cartão não está aqui?" abre o formulário e leva o foco até ele', async ({ page }) => {
  await abrirInicio(page, '/#/perfil');
  await page.getByRole('button', { name: 'O seu cartão não está aqui? Adicione' }).click();
  await expect(page.getByLabel('Nome do cartão')).toBeFocused();
  // Com o envio de pedidos desligado, aponta para o Contato.
  await expect(page.locator('#perfil-meu-cartao')).toContainText('Quer que o cartão entre na lista para todo mundo? Diga o nome dele em Contato.');
});

test('corrigir o campo tira o aviso de erro dele', async ({ page }) => {
  await abrirInicio(page, '/#/perfil');
  await adicionar(page, { nome: '4111 1111 1111 1111' });
  const nome = page.getByLabel('Nome do cartão');
  await expect(nome).toHaveAttribute('aria-invalid', 'true');
  await nome.fill('Cartão Zeta Gold');
  await expect(nome).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#meu-cartao-nome-erro')).toHaveText('');
});
