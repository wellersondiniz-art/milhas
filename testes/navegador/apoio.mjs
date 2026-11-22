// Peças comuns dos testes no navegador.
import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/** 10/11/2026, meio-dia em Brasília: a oferta de teste vale de 01/11 a 30/11. */
export const AGORA_DE_TESTE = new Date('2026-11-10T12:00:00-03:00');

const PASTA_DADOS_DE_TESTE = new URL('./dados-de-teste/', import.meta.url);

/**
 * `test` com uma trava a mais: qualquer erro de JavaScript na página ou
 * mensagem de erro no console (inclusive bloqueio de CSP) reprova o teste.
 * Quem espera um erro de propósito usa test.use({ erroEsperado: /padrão/ }).
 */
export const test = base.extend({
  erroEsperado: [null, { option: true }],
  errosDaPagina: [async ({ page, erroEsperado }, use) => {
    const erros = [];
    const esperado = (texto) => Boolean(erroEsperado && erroEsperado.test(texto));
    page.on('pageerror', (erro) => { if (!esperado(erro.message)) erros.push(`pageerror: ${erro.message}`); });
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !esperado(msg.text())) erros.push(`console: ${msg.text()}`);
    });
    await use(erros);
    expect(erros, 'erros de JavaScript ou de CSP na página').toEqual([]);
  }, { auto: true }],
});

export { expect };

/** Troca dados/*.json pelos dados falsos de testes/navegador/dados-de-teste/. */
export async function usarDadosDeTeste(page) {
  await page.route(/\/dados\/[a-z0-9-]+\.json(\?.*)?$/, async (rota) => {
    const nome = new URL(rota.request().url()).pathname.split('/').pop();
    try {
      const corpo = await readFile(new URL(nome, PASTA_DADOS_DE_TESTE));
      await rota.fulfill({ status: 200, contentType: 'application/json', body: corpo });
    } catch {
      await rota.fulfill({ status: 404, body: 'não encontrado' });
    }
  });
}

/** Relógio parado em AGORA_DE_TESTE (o resto do tempo, como timers, corre normal). */
export async function fixarRelogio(page, agora = AGORA_DE_TESTE) {
  await page.clock.setFixedTime(agora);
}

/** Abre o site e espera as lojas carregarem (o campo de loja só libera depois). */
export async function abrirInicio(page, caminho = '/') {
  await page.goto(caminho);
  await expect(page.locator('#loja')).toBeEnabled();
}

/** Escolhe a loja digitando e usando o teclado (setas + Enter). */
export async function escolherLojaPeloTeclado(page, inicioDoNome, nome) {
  const campo = page.getByRole('combobox', { name: 'Em qual loja você vai comprar?' });
  await campo.click();
  await campo.fill('');
  await campo.pressSequentially(inicioDoNome);
  await expect(page.getByRole('option', { name: nome })).toBeVisible();
  // Desce até a opção certa.
  const opcoes = await page.getByRole('option').allTextContents();
  const posicao = opcoes.indexOf(nome);
  for (let i = 0; i <= posicao; i++) await campo.press('ArrowDown');
  await campo.press('Enter');
  await expect(campo).toHaveValue(nome);
}

/** Loja, valor (só dígitos) e "Ver o resultado". */
export async function calcular(page, { inicioDoNome, loja, digitos }) {
  await escolherLojaPeloTeclado(page, inicioDoNome, loja);
  const valor = page.getByRole('textbox', { name: 'Quanto vai custar?' });
  await expect(valor).toBeFocused();
  await valor.pressSequentially(digitos);
  await page.getByRole('button', { name: 'Ver o resultado' }).click();
}

/** Cartões do resultado, do melhor ao pior. */
export function cartoesDoResultado(page) {
  return page.locator('#resultado .resultado__card');
}
