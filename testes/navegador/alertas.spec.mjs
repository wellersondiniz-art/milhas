// Formulário "Alerta de pontos por e-mail" (site/alertas/). O servidor de
// teste não roda as Pages Functions: a rota /api/alertas/inscrever é
// respondida aqui, e o teste confere o que a página manda.
import { expect, fixarRelogio, test, usarDadosDeTeste } from './apoio.mjs';

test.use({ serviceWorkers: 'block' });

const PERFIL = {
  versao: 2,
  programas: [{ programa_id: 'programa-alfa', clube_ativo: true, clube_ativo_desde: '2026-11-01' }],
  cartoes: ['cartao-alfa'],
  valor_milheiro_brl: { 'programa-alfa': 2500 },
};

test.beforeEach(async ({ page }) => {
  await usarDadosDeTeste(page);
  await fixarRelogio(page);
});

async function comPerfil(page) {
  await page.addInitScript((perfil) => localStorage.setItem('comprador-de-milhas:perfil', JSON.stringify(perfil)), PERFIL);
}

test('sem perfil: explica o que falta e não deixa criar o alerta', async ({ page }) => {
  await page.goto('/alertas/');
  await expect(page.locator('#perfil-resumo')).toContainText('ainda não marcou nenhum programa ou cartão');
  await expect(page.getByRole('button', { name: 'Criar alerta' })).toBeDisabled();
});

test('com perfil: mostra o resumo, confere os campos e manda só o necessário', async ({ page }) => {
  await comPerfil(page);
  let corpo = null;
  await page.route('**/api/alertas/inscrever', async (rota) => {
    corpo = rota.request().postDataJSON();
    await rota.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, mensagem: 'Pronto! Se o e-mail estiver certo, chega nele um link para confirmar o alerta.' }) });
  });
  await page.goto('/alertas/?loja=loja-teste');
  await expect(page.locator('#perfil-resumo')).toHaveText('Programas: Programa Alfa (com clube). Cartões: Cartão Alfa Platinum.');
  await expect(page.getByLabel('Loja')).toHaveValue('loja-teste');

  // Erros primeiro: tudo vazio.
  await page.getByRole('button', { name: 'Criar alerta' }).click();
  await expect(page.locator('#alerta-pontos-erro')).toHaveText('Escreva um número, como 10 ou 2,5.');
  await expect(page.locator('#alerta-email-erro')).not.toBeEmpty();
  await expect(page.getByLabel('Me avise a partir de quantos pontos por real?')).toBeFocused();
  expect(corpo).toBeNull();

  await page.getByLabel('Me avise a partir de quantos pontos por real?').fill('12,5');
  await page.getByLabel('Seu e-mail').fill('pessoa@exemplo.com');
  await page.getByRole('checkbox', { name: /Quero receber e-mails de alerta/ }).check();
  await page.clock.runFor(3000);
  await page.getByRole('button', { name: 'Criar alerta' }).click();
  await expect(page.locator('#alerta-status')).toContainText('chega nele um link para confirmar');
  expect(corpo).toMatchObject({
    email: 'pessoa@exemplo.com', loja_id: 'loja-teste', programa_id: null, pontos_por_real: '12,5', consentimento: true, site: '',
    perfil: { programas: PERFIL.programas, cartoes: PERFIL.cartoes },
  });
  expect(corpo.perfil.valor_milheiro_brl).toBeUndefined();
});

test.describe('resposta 422', () => {
  // O navegador registra no console toda resposta 4xx; aqui é de propósito.
  test.use({ erroEsperado: /status of 422/ });
test('erro do servidor aparece no campo certo e no aviso', async ({ page }) => {
  await comPerfil(page);
  await page.route('**/api/alertas/inscrever', (rota) => rota.fulfill({
    status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, mensagem: 'Falta arrumar alguns campos.', erros: { email: 'Escreva um e-mail válido, como nome@exemplo.com.br.' } }),
  }));
  await page.goto('/alertas/');
  await page.getByLabel('Loja').selectOption('loja-teste');
  await page.getByLabel('Me avise a partir de quantos pontos por real?').fill('10');
  await page.getByLabel('Seu e-mail').fill('x@y.zz');
  await page.getByRole('checkbox', { name: /Quero receber e-mails de alerta/ }).check();
  await page.getByRole('button', { name: 'Criar alerta' }).click();
  await expect(page.locator('#alerta-status')).toHaveText('Falta arrumar alguns campos.');
  await expect(page.getByLabel('Seu e-mail')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Criar alerta' })).toBeEnabled();
});
});
