// Extensão de navegador, de ponta a ponta, num Chromium de verdade.
// As lojas são páginas de exemplo locais (paginas/), servidas por interceptação.
// Dados falsos: testes/navegador/dados-de-teste/ (Cartão Alfa: 2 pontos por real,
// Programa Alfa com milheiro de R$ 20,00; Cartão Beta: 3 pontos por real).
import { test as base, expect, chromium } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACOTE_DE_TESTE } from './montar-para-teste.mjs';

const PAGINAS = {
  'https://www.outra-loja.invalid/p/geladeira': 'outra-loja-produto.html',
  'https://www.outra-loja.invalid/carrinho': 'outra-loja-produto.html',
  'https://www.outra-loja.invalid/p/invalido': 'outra-loja-preco-invalido.html',
  'https://www.outra-loja.invalid/p/sem-preco': 'outra-loja-sem-preco.html',
  'https://www.outra-loja.invalid/p/login': 'outra-loja-login.html',
  'https://www.outra-loja.invalid/p/atrasado': 'outra-loja-preco-atrasado.html',
  'https://www.outra-loja.invalid/p/parcelado': 'outra-loja-parcelado.html',
  'https://www.loja-teste.invalid/produto/fone': 'loja-teste-produto.html',
};
/** Tempo para o script de conteúdo passar pela página algumas vezes (ele confere a cada 1,5 s). */
const ESPERA_SEM_SELO_MS = 4000;

const test = base.extend({
  // Um navegador novo por teste: perfil e armazenamento limpos.
  contexto: async ({}, use) => {
    const pasta = await mkdtemp(path.join(tmpdir(), 'extensao-'));
    const pacote = fileURLToPath(PACOTE_DE_TESTE);
    const contexto = await chromium.launchPersistentContext(pasta, {
      channel: 'chromium', // o headless novo, que carrega extensões
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      args: [`--disable-extensions-except=${pacote}`, `--load-extension=${pacote}`],
    });
    await use(contexto);
    await contexto.close();
    await rm(pasta, { recursive: true, force: true });
  },
  // Toda a rede passa por aqui: só as páginas de exemplo respondem; o resto é bloqueado e anotado.
  pedidosBloqueados: async ({ contexto }, use) => {
    const bloqueados = [];
    await contexto.route('**/*', async (rota) => {
      const url = rota.request().url().split('?')[0];
      if (url.startsWith('chrome-extension://')) {
        await rota.continue(); // arquivos da própria extensão (página de opções)
      } else if (PAGINAS[url]) {
        const corpo = await readFile(new URL(`./paginas/${PAGINAS[url]}`, import.meta.url));
        await rota.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: corpo });
      } else {
        bloqueados.push(rota.request().url());
        await rota.abort();
      }
    });
    await use(bloqueados);
    expect(bloqueados, 'pedidos de rede fora das páginas de exemplo').toEqual([]);
  },
  idDaExtensao: async ({ contexto }, use) => {
    const [sw] = contexto.serviceWorkers();
    const servico = sw ?? await contexto.waitForEvent('serviceworker');
    await use(new URL(servico.url()).host);
  },
  pagina: async ({ contexto, pedidosBloqueados }, use) => {
    void pedidosBloqueados;
    const pagina = await contexto.newPage();
    const erros = [];
    pagina.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
    pagina.on('console', (m) => { if (m.type() === 'error') erros.push(`console: ${m.text()}`); });
    await use(pagina);
    expect(erros, 'erros de JavaScript na página da loja').toEqual([]);
  },
});

/**
 * Lê o selo pelo protocolo do DevTools, que enxerga dentro do Shadow DOM
 * fechado (a página da loja não enxerga). null se não houver selo.
 */
async function lerSelo(pagina) {
  const cdp = await pagina.context().newCDPSession(pagina);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const filhos = (n) => [...(n.children ?? []), ...(n.shadowRoots ?? [])];
    const achar = (n, f) => (f(n) ? n : filhos(n).map((c) => achar(c, f)).find(Boolean) ?? null);
    const selo = achar(root, (n) => n.localName === 'milhas-da-vez-selo');
    if (!selo) return null;
    const textos = [];
    const juntar = (n) => { if (n.nodeType === 3 && n.nodeValue.trim()) textos.push(n.nodeValue); filhos(n).forEach(juntar); };
    juntar(selo);
    const botao = achar(selo, (n) => n.localName === 'button');
    return { modo: selo.shadowRoots?.[0]?.shadowRootType, titulo: textos[0], detalhe: textos[1], botao: botao?.backendNodeId };
  } finally {
    await cdp.detach();
  }
}

async function clicarNoFechar(pagina, backendNodeId) {
  const cdp = await pagina.context().newCDPSession(pagina);
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
  await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { this.click(); }' });
  await cdp.detach();
}

async function semSelo(pagina) {
  await pagina.waitForTimeout(ESPERA_SEM_SELO_MS);
  expect(await lerSelo(pagina)).toBeNull();
  await expect(pagina.locator('milhas-da-vez-selo')).toHaveCount(0);
  await expect(pagina.locator('body')).toHaveAttribute('data-pagina-ok', 'sim');
}

/**
 * Página de opções. Ao ser instalada, a extensão abre uma sozinha, às vezes
 * na própria aba vazia do teste. Espera isso acontecer antes de abrir a nossa:
 * as duas ao mesmo tempo faziam o Chrome interromper a nossa navegação.
 */
async function paginaDeOpcoes(contexto, id) {
  const url = `chrome-extension://${id}/opcoes.html`;
  const limite = Date.now() + 5000;
  while (!contexto.pages().some((p) => p.url() === url) && Date.now() < limite) {
    await new Promise((r) => { setTimeout(r, 100); });
  }
  const opcoes = await contexto.newPage();
  await opcoes.goto(url);
  return opcoes;
}

async function escolherNoPerfil(contexto, id, nomes) {
  const opcoes = await paginaDeOpcoes(contexto, id);
  for (const nome of nomes) await opcoes.getByLabel(nome, { exact: true }).check();
  await opcoes.getByRole('button', { name: 'Salvar' }).click();
  await expect(opcoes.getByRole('status')).toHaveText('Pronto, salvo neste navegador.');
  await opcoes.close();
}

test('com perfil: mostra o melhor jeito com o cartão da pessoa, num Shadow DOM fechado', async ({ contexto, idDaExtensao, pagina }) => {
  await escolherNoPerfil(contexto, idDaExtensao, ['Programa Alfa', 'Cartão Alfa Platinum']);
  await pagina.goto('https://www.outra-loja.invalid/p/geladeira');

  await expect.poll(() => lerSelo(pagina)).toEqual(expect.objectContaining({
    modo: 'closed',
    // R$ 1.299,00 × 2 pontos por real; milheiro do Programa Alfa: R$ 20,00
    titulo: 'Melhor jeito: 2.598 pontos com Cartão Alfa Platinum',
    // Os cartões de teste foram conferidos em 05/11/2026: daqui para a frente, sempre "antigos".
    detalhe: 'no Programa Alfa · vale cerca de R$ 51,96 · dado conferido há mais de 14 dias',
  }));
  // A página da loja não consegue ler o selo.
  expect(await pagina.evaluate(() => document.querySelector('milhas-da-vez-selo').shadowRoot)).toBeNull();
  // E a página continua funcionando: campo de CEP intacto.
  await expect(pagina.locator('input[name="cep"]')).toHaveValue('01001-000');
});

test('sem perfil: conta com todos os cartões e avisa', async ({ pagina }) => {
  await pagina.goto('https://www.outra-loja.invalid/p/geladeira');
  await expect.poll(() => lerSelo(pagina)).toEqual(expect.objectContaining({
    titulo: 'Melhor jeito: 2.598 pontos com Cartão Alfa Platinum',
    detalhe: 'no Programa Alfa · vale cerca de R$ 51,96 · contando todos os cartões; escolha os seus nas opções da extensão',
  }));
});

test('o botão fechar tira o selo daquela página', async ({ pagina }) => {
  await pagina.goto('https://www.outra-loja.invalid/p/geladeira');
  await expect.poll(() => lerSelo(pagina)).not.toBeNull();
  await clicarNoFechar(pagina, (await lerSelo(pagina)).botao);
  await semSelo(pagina);
});

test('preço lido de atributo com ponto decimal (seletor quebrado no arquivo é pulado)', async ({ pagina }) => {
  await pagina.goto('https://www.loja-teste.invalid/produto/fone');
  await expect.poll(async () => (await lerSelo(pagina))?.titulo ?? '').toMatch(/^Melhor jeito: [\d.]+ pontos com Cartão (Alfa Platinum|Beta Gold)$/);
});

test('preço que chega depois e troca de produto sem recarregar a página', async ({ pagina }) => {
  await pagina.goto('https://www.outra-loja.invalid/p/atrasado');
  // Ordem pelo valor em reais: o Alfa (com milheiro) vem antes do Beta (sem).
  await expect.poll(async () => (await lerSelo(pagina))?.titulo).toBe('Melhor jeito: 500 pontos com Cartão Alfa Platinum');
  await pagina.getByRole('button', { name: 'Ver outro produto' }).click();
  await expect.poll(async () => (await lerSelo(pagina))?.titulo).toBe('Melhor jeito: 100 pontos com Cartão Alfa Platinum');
});

test('loja que destaca o preço no Pix: usa o preço no cartão, da linha das parcelas', async ({ pagina }) => {
  await pagina.goto('https://www.outra-loja.invalid/p/parcelado');
  // R$ 3.699,00 no cartão × 2 pontos por real (no Pix, R$ 3.329,10, daria 6.658,2).
  await expect.poll(async () => (await lerSelo(pagina))?.titulo).toBe('Melhor jeito: 7.398 pontos com Cartão Alfa Platinum');
});

test('falha em silêncio: preço fora do formato', async ({ pagina }) => {
  await pagina.goto('https://www.outra-loja.invalid/p/invalido');
  await semSelo(pagina);
});

test('falha em silêncio: a loja mudou o layout e o seletor não acha o preço', async ({ pagina }) => {
  await pagina.goto('https://www.outra-loja.invalid/p/sem-preco');
  await semSelo(pagina);
});

test('não lê nada de formulário com senha', async ({ pagina }) => {
  await pagina.goto('https://www.outra-loja.invalid/p/login');
  await semSelo(pagina);
});

test('fora da página de produto não faz nada', async ({ pagina }) => {
  await pagina.goto('https://www.outra-loja.invalid/carrinho');
  await semSelo(pagina);
});

test('opções: traz o perfil exportado pelo site e recusa arquivo fora do formato', async ({ contexto, idDaExtensao, pagina }) => {
  const opcoes = await paginaDeOpcoes(contexto, idDaExtensao);
  const arquivo = (nome, conteudo) => ({ name: nome, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(conteudo)) });

  await opcoes.getByLabel('Escolher arquivo do perfil (.json)').setInputFiles(arquivo('ruim.json', { app: 'outro', versao: 2, programas: [], cartoes: [], extra: '<b>x</b>' }));
  await expect(opcoes.locator('#erros li').first()).toBeVisible();
  await expect(opcoes.locator('#erros')).toContainText('Campo que não conhecemos: "extra".');

  await opcoes.getByLabel('Escolher arquivo do perfil (.json)').setInputFiles(arquivo('meu-perfil-milhas.json', {
    app: 'comprador-de-milhas',
    versao: 2,
    exportado_em: '2026-11-05T10:00:00',
    programas: [{ programa_id: 'programa-alfa', clube_ativo: false }],
    cartoes: ['cartao-alfa'],
    valor_milheiro_brl: { 'programa-alfa': 3000 },
  }));
  await expect(opcoes.getByRole('status')).toHaveText('Perfil do site trazido e salvo neste navegador.');
  await expect(opcoes.getByLabel('Cartão Alfa Platinum', { exact: true })).toBeChecked();
  await expect(opcoes.getByLabel('Cartão Beta Gold', { exact: true })).not.toBeChecked();

  // O milheiro do arquivo (R$ 30,00) vence o do cadastro: 2.598 pontos valem R$ 77,94.
  await pagina.goto('https://www.outra-loja.invalid/p/geladeira');
  await expect.poll(async () => (await lerSelo(pagina))?.detalhe).toBe('no Programa Alfa · vale cerca de R$ 77,94 · dado conferido há mais de 14 dias');

  await opcoes.getByRole('button', { name: 'Apagar tudo' }).click();
  await expect(opcoes.getByRole('status')).toHaveText('Perfil apagado deste navegador.');
  await expect(opcoes.getByLabel('Cartão Alfa Platinum', { exact: true })).not.toBeChecked();
});

test('a CSP da extensão bloqueia qualquer conexão de rede, até no service worker', async ({ contexto, idDaExtensao, pedidosBloqueados }) => {
  void idDaExtensao;
  void pedidosBloqueados; // com a interceptação ligada, esse endereço responderia (sem a CSP, o fetch dá certo)
  const [servico] = contexto.serviceWorkers();
  const resultado = await servico.evaluate(() => fetch('https://www.outra-loja.invalid/p/geladeira').then(() => 'conectou', () => 'bloqueado'));
  expect(resultado).toBe('bloqueado');
});
