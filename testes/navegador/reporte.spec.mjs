// Fluxo: "Essa informação está errada?" em cada resultado.
//
// O botão vem desligado (site/js/reporte/config.js). Aqui ele é ligado
// trocando só esse módulo, e o POST /api/reportar é atendido pelo código de
// verdade do servidor (servidor/reportar/pedido.js), com GitHub e KV de
// mentira em memória. Assim o teste cobre a página e o servidor juntos.
import { readFile } from 'node:fs/promises';
import { tratarReporte } from '../../servidor/reportar/pedido.js';
import {
  AGORA_DE_TESTE, abrirInicio, calcular, cartoesDoResultado, expect, test, usarDadosDeTeste,
} from './apoio.mjs';

const PASTA = new URL('./dados-de-teste/', import.meta.url);
const ler = async (n) => JSON.parse(await readFile(new URL(`${n}.json`, PASTA), 'utf8'));

async function ligarReporte(page, { responder } = {}) {
  await page.route('**/js/reporte/config.js', (rota) => rota.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: "export const REPORTE_LIGADO = true;\nexport const ENDERECO_DO_REPORTE = '/api/reportar';\n",
  }));
  const dados = { lojas: await ler('lojas'), ofertas: await ler('ofertas'), programas: await ler('programas'), cartoes: await ler('cartoes') };
  const servidor = { pedidos: [], issues: [], comentarios: [] };
  const kv = new Map();
  await page.route('**/api/reportar', async (rota) => {
    const r = rota.request();
    servidor.pedidos.push(JSON.parse(r.postData() ?? 'null'));
    if (responder) { await rota.fulfill(responder); return; }
    const pedido = new Request(r.url(), { method: r.method(), headers: await r.allHeaders(), body: r.postData() });
    const resposta = await tratarReporte(pedido, {
      kv: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } },
      chaveDoResumo: 'chave-de-teste',
      github: {
        criarIssue: async (issue) => { servidor.issues.push(issue); return { number: servidor.issues.length }; },
        comentar: async (numero, body) => { servidor.comentarios.push({ numero, body }); },
      },
      buscarDados: async () => dados,
      agora: () => AGORA_DE_TESTE,
    });
    await rota.fulfill({ status: resposta.status, headers: Object.fromEntries(resposta.headers), body: await resposta.text() });
  });
  return servidor;
}

test.describe('reporte de erro', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await usarDadosDeTeste(page);
    // install (e não setFixedTime): o relógio de performance.now também
    // fica nas mãos do teste, para passar da trava de "envio rápido demais".
    await page.clock.install({ time: AGORA_DE_TESTE });
  });

  test('desligado (padrão): nenhum botão nos resultados', async ({ page }) => {
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    await expect(cartoesDoResultado(page)).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Essa informação está errada?' })).toHaveCount(0);
  });

  test('só com o teclado: abre, preenche, envia e vira issue com prioridade', async ({ page }) => {
    const servidor = await ligarReporte(page);
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    const cartoes = cartoesDoResultado(page);
    await expect(cartoes).toHaveCount(4);
    // Os três primeiros jeitos aparecem; o quarto fica em "Ver mais 1 jeito".
    await expect(page.getByRole('button', { name: 'Essa informação está errada?' })).toHaveCount(3);
    await page.getByText('Ver mais 1 jeito').click();
    await expect(page.getByRole('button', { name: 'Essa informação está errada?' })).toHaveCount(4);

    const primeiro = cartoes.nth(0);
    const botao = primeiro.getByRole('button', { name: 'Essa informação está errada?' });
    await botao.focus();
    await page.keyboard.press('Enter');
    await expect(botao).toHaveAttribute('aria-expanded', 'true');
    const texto = primeiro.getByRole('textbox', { name: 'O que está errado?' });
    await expect(texto).toBeFocused();
    await expect(primeiro).toContainText('Loja: Loja Teste');

    await page.keyboard.type('A oferta caiu para 8 pontos por real. <b>urgente</b>');
    await page.keyboard.press('Tab');
    await expect(primeiro.getByRole('textbox', { name: 'Link da prova' })).toBeFocused();
    await page.keyboard.type('https://exemplo.com.br/regulamento');
    await page.keyboard.press('Tab');
    await expect(primeiro.getByRole('textbox', { name: 'Seu e-mail (opcional)' })).toBeFocused();
    await page.keyboard.type('ana@exemplo.com.br');
    // A isca do robô não entra na ordem do Tab: o próximo é o link de Privacidade.
    await page.keyboard.press('Tab');
    await expect(primeiro.getByRole('link', { name: 'Privacidade' })).toBeFocused();
    await page.clock.fastForward(5000);
    await page.keyboard.press('Tab');
    await expect(primeiro.getByRole('button', { name: 'Enviar aviso' })).toBeFocused();
    await page.keyboard.press('Enter');

    const feito = primeiro.getByText('Recebemos o seu aviso. Obrigado!');
    await expect(feito).toBeVisible();
    await expect(feito).toBeFocused();
    await expect(primeiro.getByRole('button', { name: 'Essa informação está errada?' })).toHaveCount(0);
    await expect(page.locator('#resultado b')).toHaveCount(0);

    expect(servidor.issues).toHaveLength(1);
    expect(servidor.issues[0].labels).toEqual(['reporte', 'prioridade: oferta ativa']);
    expect(servidor.issues[0].body).toContain('<b>urgente</b>');
    expect(servidor.issues[0].body).not.toContain('ana@exemplo.com.br');
    expect(servidor.comentarios).toHaveLength(1);
    expect(servidor.pedidos[0]).toMatchObject({
      loja_id: 'loja-teste', oferta_id: 'programa-alfa-loja-teste', programa_id: 'programa-alfa', cartao_id: 'cartao-alfa', site: '',
    });
  });

  test('resultado sem oferta: reporte sem prioridade', async ({ page }) => {
    const servidor = await ligarReporte(page);
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    const ultimo = cartoesDoResultado(page).filter({ hasText: 'Sem oferta' }).first();
    await ultimo.getByRole('button', { name: 'Essa informação está errada?' }).click();
    await ultimo.getByRole('textbox', { name: 'O que está errado?' }).fill('O cartão agora dá 3 pontos por real.');
    await ultimo.getByRole('textbox', { name: 'Link da prova' }).fill('https://banco.exemplo.com.br/cartao');
    await page.clock.fastForward(5000);
    await ultimo.getByRole('button', { name: 'Enviar aviso' }).click();
    await expect(ultimo.getByText('Recebemos o seu aviso.')).toBeVisible();
    expect(servidor.issues[0].labels).toEqual(['reporte']);
    expect(servidor.pedidos[0].oferta_id).toBeNull();
  });

  test('campos errados: avisa na hora, sem enviar nada', async ({ page }) => {
    const servidor = await ligarReporte(page);
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    const card = cartoesDoResultado(page).nth(0);
    await card.getByRole('button', { name: 'Essa informação está errada?' }).click();
    await card.getByRole('textbox', { name: 'Link da prova' }).fill('http://sem-https.com');
    await card.getByRole('textbox', { name: 'Seu e-mail (opcional)' }).fill('ana');
    await card.getByRole('button', { name: 'Enviar aviso' }).click();

    const texto = card.getByRole('textbox', { name: 'O que está errado?' });
    await expect(texto).toBeFocused();
    await expect(texto).toHaveAttribute('aria-invalid', 'true');
    await expect(texto).toHaveAccessibleDescription(/pelo menos 10 letras/);
    await expect(card.getByRole('textbox', { name: 'Link da prova' })).toHaveAccessibleDescription(/começando com https/);
    await expect(card.getByRole('textbox', { name: 'Seu e-mail (opcional)' })).toHaveAttribute('aria-invalid', 'true');
    expect(servidor.pedidos).toHaveLength(0);
  });

  test.describe('com erro do servidor', () => {
    // O navegador registra o 429 no console; aqui ele é de propósito.
    test.use({ erroEsperado: /status of 429/ });

    test('resposta do servidor aparece como texto, nunca como HTML', async ({ page }) => {
      await ligarReporte(page, {
        responder: { status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, mensagem: '<img src=x>Muitos avisos' }) },
      });
      await abrirInicio(page);
      await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
      const card = cartoesDoResultado(page).nth(0);
      await card.getByRole('button', { name: 'Essa informação está errada?' }).click();
      await card.getByRole('textbox', { name: 'O que está errado?' }).fill('A oferta já acabou ontem.');
      await card.getByRole('textbox', { name: 'Link da prova' }).fill('https://exemplo.com.br/x');
      await card.getByRole('button', { name: 'Enviar aviso' }).click();
      await expect(card.getByRole('status')).toHaveText('<img src=x>Muitos avisos');
      await expect(page.locator('#resultado img')).toHaveCount(0);
    });
  });

  test('Cancelar e Esc fecham e devolvem o foco ao botão', async ({ page }) => {
    await ligarReporte(page);
    await abrirInicio(page);
    await calcular(page, { inicioDoNome: 'loj', loja: 'Loja Teste', digitos: '10000' });
    const card = cartoesDoResultado(page).nth(1);
    const botao = card.getByRole('button', { name: 'Essa informação está errada?' });
    await botao.click();
    await card.getByRole('button', { name: 'Cancelar' }).click();
    await expect(botao).toBeFocused();
    await expect(botao).toHaveAttribute('aria-expanded', 'false');
    await expect(card.getByRole('textbox', { name: 'O que está errado?' })).toBeHidden();
    await botao.click();
    await page.keyboard.press('Escape');
    await expect(botao).toBeFocused();
    await expect(card.getByRole('textbox', { name: 'O que está errado?' })).toBeHidden();
  });
});

test.describe('pedir esse cartão', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await usarDadosDeTeste(page);
    await page.clock.install({ time: AGORA_DE_TESTE });
  });

  test('em Meu perfil: vem com o nome do cartão adicionado, vai sem os números dele e vira issue', async ({ page }) => {
    const servidor = await ligarReporte(page);
    await abrirInicio(page, '/#/perfil');
    await page.locator('#meu-cartao > summary').click();
    const adicionar = page.locator('#meu-cartao');
    await adicionar.getByLabel('Nome do cartão').fill('Cartão Zeta Gold');
    await adicionar.getByLabel('Programa em que os pontos caem').selectOption({ label: 'Programa Alfa' });
    await adicionar.getByLabel('Pontos por real').fill('3');
    await page.getByRole('button', { name: 'Adicionar meu cartão' }).click();
    await expect(page.locator('.perfil__proprio')).toHaveCount(1);

    await page.locator('#pedido-cartao > summary').click();
    const pedido = page.locator('#pedido-cartao');
    await expect(pedido.getByLabel('Nome do cartão')).toHaveValue('Cartão Zeta Gold');
    await pedido.getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(pedido.getByLabel('Banco')).toBeFocused();
    await expect(pedido.locator('#pedido-cartao-banco-erro')).toContainText('Escreva o nome do banco');
    expect(servidor.pedidos).toHaveLength(0);

    await pedido.getByLabel('Banco').fill('Banco Zeta');
    await pedido.getByLabel('Programa em que os pontos caem').selectOption({ label: 'Programa Alfa' });
    await page.clock.fastForward(5000);
    await pedido.getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(pedido.getByText('Recebemos o seu pedido. Obrigado!')).toBeFocused();
    expect(servidor.pedidos).toHaveLength(1);
    expect(Object.keys(servidor.pedidos[0]).sort()).toEqual(['banco', 'link_da_fonte', 'nome_do_cartao', 'programa_id', 'site', 'tempo_no_formulario_ms', 'tipo']);
    expect(JSON.stringify(servidor.pedidos[0])).not.toMatch(/meu-1|pontos_por_real/);
    expect(servidor.issues).toHaveLength(1);
    expect(servidor.issues[0].title).toBe('[Pedido de cartão] Programa Alfa');
    expect(servidor.issues[0].labels).toEqual(['pedido de cartão']);
  });
});
