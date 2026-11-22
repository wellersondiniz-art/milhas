// Testes no navegador (Playwright). Ferramenta de teste: nada daqui vai para o site.
//
// - Fluxos de ponta a ponta: testes/navegador/*.spec.mjs
// - Regressão visual (fotos de referência): testes/navegador/fotos.spec.mjs
//
// Cada teste roda duas vezes: no "celular" (tela de 412 px, toque) e no
// "computador" (1280 × 800). O site é montado (npm run build) e a pasta dist/,
// a mesma que vai para o ar, é servida por testes/navegador/servidor.mjs, com
// os cabeçalhos de _headers.
import { defineConfig, devices } from '@playwright/test';

const PORTA = Number(process.env.PORTA || 4173);
const NO_CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'testes/navegador',
  testMatch: '**/*.spec.mjs',
  outputDir: 'testes/navegador/resultados',
  snapshotPathTemplate: '{testDir}/fotos/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: NO_CI,
  retries: NO_CI ? 1 : 0,
  workers: NO_CI ? 2 : undefined,
  timeout: 30_000,
  reporter: NO_CI
    ? [['list'], ['github'], ['html', { outputFolder: 'testes/navegador/relatorio', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'testes/navegador/relatorio', open: 'never' }]],
  expect: {
    toHaveScreenshot: {
      // As fotos saem da mesma imagem Docker do CI, então quase nada pode mudar:
      // no máximo 20 pixels diferentes (um canto de botão já passa disso).
      maxDiffPixels: 20,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORTA}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'celular',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'computador',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run build && node testes/navegador/servidor.mjs',
    url: `http://127.0.0.1:${PORTA}/index.html`,
    reuseExistingServer: !NO_CI,
    timeout: 60_000,
    env: { PORTA: String(PORTA) },
  },
});
