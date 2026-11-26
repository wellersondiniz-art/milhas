// Testes da extensão de navegador (Playwright). Ferramenta de teste: nada daqui vai para a extensão.
//
// A extensão é montada com os dados falsos de testes/navegador/dados-de-teste/
// e os seletores de testes/extensao/seletores-de-teste.json, e carregada num
// Chromium de verdade. As "lojas" são páginas locais (testes/extensao/paginas/)
// servidas por interceptação: nenhum teste abre o site de uma loja real, e
// qualquer pedido fora das páginas de exemplo é bloqueado.
//
// Só no computador: o Chrome do celular não tem extensões.
import { defineConfig } from '@playwright/test';

const NO_CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'testes/extensao',
  testMatch: '**/*.spec.mjs',
  outputDir: 'testes/extensao/resultados',
  globalSetup: './testes/extensao/montar-para-teste.mjs',
  fullyParallel: false,
  forbidOnly: NO_CI,
  retries: NO_CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  reporter: NO_CI
    ? [['list'], ['github'], ['html', { outputFolder: 'testes/extensao/relatorio', open: 'never' }]]
    : [['list']],
  use: {
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
  },
});
