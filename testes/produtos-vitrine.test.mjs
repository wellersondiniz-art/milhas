// Vitrine de produtos: pontos pelo motor, cartões nas páginas (preço com data e
// hora, aviso, validade), script que esconde preço vencido, gerador e demonstração.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { pontosDoProduto, rankearProdutos } from '../site/js/motor/index.js';
import { esconderPrecosVencidos, precoVencido } from '../site/js/produtos-validade.js';
import {
  MAXIMO_NO_RANKING, avisoDoPreco, dataHoraDeBrasilia, produtosQueValem, secaoDaLoja, secaoQueMaisRende, vitrineTemAfiliado,
} from '../scripts/paginas/produtos.js';
import { gerarPaginas } from '../scripts/paginas/montar.js';
import { conferirHtml } from '../scripts/paginas/conferir-html.js';
import { conferirVitrineParaPublicar, lerVitrine } from '../scripts/gerar-paginas.js';
import { montarDemo, ofertasDeDemo, vitrineDeDemo } from '../scripts/produtos/demo.js';

const RAIZ = new URL('../', import.meta.url);
const HOJE = '2026-11-25';
const AGORA = '2026-11-25T15:00:00.000Z';
const DEPOIS = '2026-11-26T15:00:00.000Z';

function dados(ofertas = []) {
  return {
    programas: [
      { id: 'prog-a', nome: 'Programa A', valor_milheiro_brl: 2000 },
      { id: 'prog-b', nome: 'Programa B', valor_milheiro_brl: 'A_CONFIRMAR' },
    ],
    cartoes: [
      { id: 'cartao-a', nome: 'Cartão A', programa_id: 'prog-a', pontos_por_real: 2, status: 'confirmado' },
      { id: 'cartao-x', nome: 'Cartão X', programa_id: 'prog-a', pontos_por_real: 'A_CONFIRMAR', status: 'A_CONFIRMAR' },
    ],
    lojas: [
      { id: 'amazon', nome: 'Amazon', artigo: 'a', dominio: 'amazon.com.br', fonte_url: 'https://www.amazon.com.br', verificado_em: HOJE },
      { id: 'mercado-livre', nome: 'Mercado Livre', artigo: 'o', dominio: 'mercadolivre.com.br', fonte_url: 'https://www.mercadolivre.com.br', verificado_em: HOJE },
    ],
    ofertas,
    cambio: [],
  };
}

function oferta(campos) {
  return {
    id: 'oferta-a', loja_id: 'amazon', programa_id: 'prog-a',
    regras: [{ condicao: { clube_ativo: true }, pontos_por_real: 10 }, { condicao: {}, pontos_por_real: 5 }],
    escopo: 'todos_os_produtos', acumula_com_cartao: false, clube_ativo_ha_horas: 0, exige_cupom: false,
    inicio: '2026-11-20', fim: '2026-11-30', credito_prazo_dias: 30, link_oferta: 'A_CONFIRMAR',
    fonte_url: 'https://www.amazon.com.br/oferta', verificado_em: HOJE, ...campos,
  };
}

function produto(campos) {
  return {
    loja_id: 'amazon', id_na_loja: 'B01', nome: 'Fone', preco_centavos: 20000, a_partir_de: false,
    link: 'https://www.amazon.com.br/dp/B01?tag=x-20', afiliado: true, categoria: null, vendido_pela_loja: true, vendedor_confirmado: true,
    api: 'amazon', consultado_em: AGORA, valido_ate: DEPOIS, demo: false, ...campos,
  };
}

// ---------------------------------------------------------------------------
// Motor

test('pontos do produto: qualquer pessoa, máximo com clube, e pontos por real para ordenar', () => {
  const d = dados([oferta({})]);
  const r = pontosDoProduto(produto({}), d, HOJE);
  assert.equal(r.qualquer.total_pontos, 1000);
  assert.equal(r.qualquer.valor_texto, 'R$ 20,00');
  assert.equal(r.qualquer.programa.nome, 'Programa A');
  assert.equal(r.maximo.total_pontos, 2000);
  assert.equal(r.maximo.pede_clube, true);
  assert.equal(r.maximo.cartao, null, 'cartão que não soma ponto não aparece como exigência');
  assert.equal(r.pontos_por_real, 5);
});

test('pontos do produto: sem oferta, máximo é o do cartão; vendedor e categoria contam como no motor', () => {
  const semOferta = pontosDoProduto(produto({}), dados([]), HOJE);
  assert.equal(semOferta.qualquer.total_pontos, 0);
  assert.equal(semOferta.maximo.cartao.nome, 'Cartão A');
  assert.equal(semOferta.maximo.pede_clube, false);
  const soDaLoja = dados([oferta({ escopo: 'vendido_e_entregue_pela_loja', pontos_fora_do_escopo_por_real: 1 })]);
  assert.equal(pontosDoProduto(produto({ vendido_pela_loja: false }), soDaLoja, HOJE).pontos_por_real, 1);
  const categoria = dados([oferta({ escopo: 'categorias_selecionadas', categorias_incluidas: ['Casa'], pontos_fora_do_escopo_por_real: 1 })]);
  assert.equal(pontosDoProduto(produto({ categoria: 'Casa' }), categoria, HOJE).pontos_por_real, 5);
  assert.equal(pontosDoProduto(produto({}), categoria, HOJE).pontos_por_real, 1);
});

test('ranking de produtos: mais pontos por real; empate, o mais barato; depois o nome', () => {
  const d = dados([oferta({})]);
  const lista = rankearProdutos([
    produto({ id_na_loja: 'caro', nome: 'Caro', preco_centavos: 90000 }),
    produto({ id_na_loja: 'ml', nome: 'ML', loja_id: 'mercado-livre', link: 'https://www.mercadolivre.com.br/x', preco_centavos: 100 }),
    produto({ id_na_loja: 'b', nome: 'Bola', preco_centavos: 5000 }),
    produto({ id_na_loja: 'a', nome: 'Abacaxi', preco_centavos: 5000 }),
  ], d, HOJE);
  assert.deepEqual(lista.map((r) => r.produto.id_na_loja), ['a', 'b', 'caro', 'ml']);
});

// ---------------------------------------------------------------------------
// Textos e seções

test('data e hora em Brasília e o aviso do preço (texto da Amazon e o geral)', () => {
  assert.equal(dataHoraDeBrasilia('2026-11-25T17:11:00Z'), '25/11/2026 às 14:11');
  assert.equal(dataHoraDeBrasilia('2026-11-26T02:05:00Z'), '25/11/2026 às 23:05');
  assert.match(avisoDoPreco({ id: 'amazon', nome: 'Amazon' }), /^Os preços e a disponibilidade dos produtos estão corretos na data\/horário indicados e poderão sofrer alterações\. Quaisquer informações de preço e disponibilidade exibidas na Amazon\.com\.br/);
  assert.match(avisoDoPreco({ id: 'mercado-livre', nome: 'Mercado Livre' }), /podem mudar.*\(Mercado Livre\)/);
});

test('só entram produtos de loja cadastrada e com preço ainda válido', () => {
  const vitrine = { produtos: [produto({}), produto({ id_na_loja: 'velho', valido_ate: AGORA }), produto({ loja_id: 'sumiu' })] };
  assert.deepEqual(produtosQueValem(vitrine, dados(), AGORA).map((p) => p.id_na_loja), ['B01']);
  assert.deepEqual(produtosQueValem(null, dados(), AGORA), []);
  assert.equal(vitrineTemAfiliado(vitrine, dados(), AGORA), true);
  assert.equal(vitrineTemAfiliado({ produtos: [produto({ afiliado: false })] }, dados(), AGORA), false);
});

test('cartão do produto: preço com data e hora, aviso, pontos, link patrocinado e aviso de comissão', () => {
  const html = secaoDaLoja(dados([oferta({})]), dados().lojas[0], { produtos: [produto({})] }, { hoje: HOJE, agora: AGORA }).toString();
  assert.match(html, /data-valido-ate="2026-11-26T15:00:00.000Z"/);
  assert.match(html, /Preço na Amazon: <strong>R\$\u00a0200,00<\/strong> \(em 25\/11\/2026 às 12:00, horário de Brasília\)\./);
  assert.match(html, /Detalhes do preço/);
  assert.match(html, /Rende 1\.000 pontos Programa A para qualquer pessoa, que valem cerca de R\$\u00a020,00\. Até 2\.000 pontos Programa A com o clube Programa A/);
  assert.match(html, /rel="sponsored noopener noreferrer"/);
  assert.match(html, /Ver na Amazon/);
  assert.match(html, /Podemos ganhar uma comissão/);
  assert.match(html, /data-aviso-vencido hidden/);
  assert.doesNotMatch(html, /Demonstração/);
  assert.doesNotMatch(html, /<img/);
});

test('cartão do produto: sem afiliado, demonstração, "a partir de" e ressalvas de vendedor e categoria', () => {
  const d = dados([
    oferta({ loja_id: 'mercado-livre', escopo: 'vendido_e_entregue_pela_loja', pontos_fora_do_escopo_por_real: 1 }),
    oferta({ id: 'o2', loja_id: 'mercado-livre', programa_id: 'prog-b', escopo: 'categorias_selecionadas', categorias_incluidas: ['Casa'] }),
    oferta({ id: 'o3', loja_id: 'mercado-livre', status: 'A_CONFIRMAR' }),
    oferta({ id: 'o4', loja_id: 'mercado-livre', inicio: 'A_CONFIRMAR', fim: 'A_CONFIRMAR' }),
  ]);
  const ml = produto({
    loja_id: 'mercado-livre', link: 'https://produto.mercadolivre.com.br/x', afiliado: false, demo: true, a_partir_de: true,
    vendido_pela_loja: false, vendedor_confirmado: false,
  });
  const html = secaoDaLoja(d, d.lojas[1], { produtos: [ml] }, { hoje: HOJE, agora: AGORA }).toString();
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, /Ver no Mercado Livre/);
  assert.match(html, /Preço no Mercado Livre: <strong>a partir de R\$/);
  assert.match(html, /Página de demonstração/);
  assert.match(html, /Demonstração: produto e preço inventados/);
  assert.match(html, /tratado como de vendedor parceiro/);
  assert.match(html, /categoria deste produto não está confirmada/);
  assert.doesNotMatch(html, /comissão/);
});

test('cartão do produto: sem pontos de oferta diz isso; sem milheiro não diz reais', () => {
  const semPontos = secaoDaLoja(dados([]), dados().lojas[0], { produtos: [produto({})] }, { hoje: HOJE, agora: AGORA }).toString();
  assert.match(semPontos, /não há pontos extras de oferta hoje\. Até 400 pontos Programa A com o cartão Cartão A \(cerca de R\$\u00a08,00\)/);
  const semMilheiro = secaoDaLoja(dados([oferta({ programa_id: 'prog-b', regras: [{ condicao: {}, pontos_por_real: 3 }] })]), dados().lojas[0], { produtos: [produto({})] }, { hoje: HOJE, agora: AGORA }).toString();
  assert.match(semMilheiro, /Rende 600 pontos Programa B para qualquer pessoa\.</);
});

test('seções: nada a mostrar vira null; ranking corta em 10 e mostra a loja', () => {
  const d = dados([oferta({})]);
  assert.equal(secaoDaLoja(d, d.lojas[1], { produtos: [produto({})] }, { hoje: HOJE, agora: AGORA }), null);
  assert.equal(secaoQueMaisRende(d, { produtos: [] }, { hoje: HOJE, agora: AGORA }), null);
  const muitos = Array.from({ length: 12 }, (_, i) => produto({ id_na_loja: `B${i}`, nome: `Produto ${i}` }));
  const html = secaoQueMaisRende(d, { produtos: muitos }, { hoje: HOJE, agora: AGORA }).toString();
  assert.equal(html.match(/class="produto"/g).length, MAXIMO_NO_RANKING);
  assert.match(html, /Produtos que mais rendem pontos agora/);
  assert.match(html, /<p class="texto-suave texto-pequeno">Amazon<\/p>/);
});

// ---------------------------------------------------------------------------
// Páginas inteiras

async function dadosReais() {
  const ler = async (n) => JSON.parse(await readFile(new URL(`dados/${n}.json`, RAIZ), 'utf8'));
  return { programas: await ler('programas'), cartoes: await ler('cartoes'), lojas: await ler('lojas'), ofertas: [oferta({ programa_id: 'livelo' })], cambio: await ler('cambio') };
}

test('gerarPaginas com vitrine: produtos na loja e em onde rende mais, script de validade, HTML válido', async () => {
  const d = await dadosReais();
  const { arquivos, resumo, avisos } = gerarPaginas(d, { hoje: HOJE, vitrine: { demo: true, produtos: [produto({})] }, agora: AGORA });
  const pagina = (c) => arquivos.find((a) => a.caminho === c).conteudo;
  for (const caminho of ['loja/amazon/index.html', 'onde-rende-mais/index.html']) {
    assert.match(pagina(caminho), /<script type="module" src="(\.\.\/)+js\/produtos-validade\.js"><\/script>/, caminho);
    assert.match(pagina(caminho), /Fone/);
    assert.deepEqual(conferirHtml(pagina(caminho)), [], caminho);
  }
  assert.doesNotMatch(pagina('loja/magalu/index.html'), /produtos-validade/);
  assert.match(pagina('onde-rende-mais/index.html'), /Mais abaixo, alguns produtos com preço/);
  assert.match(pagina('termos/index.html'), /Alguns links de produto são links de afiliado/);
  assert.match(pagina('privacidade/index.html'), /levam um código do site/);
  assert.match(pagina('sobre-os-dados/index.html'), /Preços de produtos/);
  assert.equal(resumo.produtos, true);
  assert.ok(avisos.some((a) => /DEMONSTRAÇÃO/.test(a)));
});

test('gerarPaginas sem vitrine (ou com tudo vencido) fica como antes', async () => {
  const d = await dadosReais();
  for (const opcoes of [{}, { vitrine: { produtos: [produto({ valido_ate: AGORA })] }, agora: AGORA }]) {
    const { arquivos, resumo } = gerarPaginas(d, { hoje: HOJE, ...opcoes });
    const tudo = arquivos.map((a) => a.conteudo).join('\n');
    assert.doesNotMatch(tudo, /produtos-validade|Preços de produtos|links de afiliado\./);
    assert.match(arquivos.find((a) => a.caminho === 'termos/index.html').conteudo, /não usamos link de afiliado/);
    assert.equal(resumo.produtos, false);
  }
  assert.throws(() => gerarPaginas(d, { hoje: HOJE, vitrine: { produtos: [] }, agora: 'ontem' }), /agora precisa ser/);
});

test('conferir HTML: só aceita módulo do próprio site em js/, sem código dentro', () => {
  const pagina = (script) => `<!doctype html><html lang="pt-BR"><head><title>t</title><meta name="description" content="d">${script}</head><body><main><h1>x</h1></main></body></html>`;
  assert.deepEqual(conferirHtml(pagina('<script type="module" src="../../js/produtos-validade.js"></script>')), []);
  assert.ok(conferirHtml(pagina('<script type="module" src="../../js/a.js">alert(1)</script>')).some((p) => /não pode ter código/.test(p)));
  assert.ok(conferirHtml(pagina('<script type="module" src="https://golpe.com/a.js"></script>')).some((p) => /executa código/.test(p)));
  assert.ok(conferirHtml(pagina('<script src="../js/a.js"></script>')).some((p) => /executa código/.test(p)));
});

// ---------------------------------------------------------------------------
// Script de validade (com um DOM falso, só o que o script usa)

function elemento(atributos = {}) {
  return { hidden: Object.hasOwn(atributos, 'hidden'), getAttribute: (n) => atributos[n] ?? null };
}
function produtoNaTela(validoAte, { semAviso = false } = {}) {
  const partes = [elemento(), elemento()];
  const aviso = semAviso ? null : elemento({ hidden: '' });
  return {
    partes, aviso,
    getAttribute: (n) => (n === 'data-valido-ate' ? validoAte : null),
    querySelectorAll: () => partes,
    querySelector: () => aviso,
  };
}

test('preço vencido: data passou ou é inválida', () => {
  assert.equal(precoVencido(DEPOIS, Date.parse(AGORA)), false);
  assert.equal(precoVencido(AGORA, Date.parse(AGORA)), true);
  assert.equal(precoVencido('quebrado', Date.parse(AGORA)), true);
  assert.equal(precoVencido(null, Date.parse(AGORA)), true);
});

test('esconder preços vencidos: some preço e pontos, aparece o aviso; o que vale fica', () => {
  const vale = produtoNaTela(DEPOIS);
  const venceu = produtoNaTela(AGORA);
  const semAviso = produtoNaTela(AGORA, { semAviso: true });
  const raiz = { querySelectorAll: () => [vale, venceu, semAviso] };
  assert.equal(esconderPrecosVencidos(raiz, Date.parse(AGORA)), 2);
  assert.ok(venceu.partes.every((p) => p.hidden));
  assert.equal(venceu.aviso.hidden, false);
  assert.ok(vale.partes.every((p) => !p.hidden));
  assert.equal(vale.aviso.hidden, true);
});

// ---------------------------------------------------------------------------
// Gerador e demonstração

test('lerVitrine: sem arquivo é null; arquivo sem lista é erro; demonstração não vai para o ar', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'vitrine-'));
  try {
    assert.equal(await lerVitrine(pathToFileURL(join(pasta, 'nao-existe.json'))), null);
    await writeFile(join(pasta, 'v.json'), '{"produtos": {}}');
    await assert.rejects(lerVitrine(pathToFileURL(join(pasta, 'v.json'))), /sem lista de produtos/);
    await writeFile(join(pasta, 'v.json'), '{"produtos": []}');
    assert.deepEqual(await lerVitrine(pathToFileURL(join(pasta, 'v.json'))), { produtos: [] });
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
  assert.throws(() => conferirVitrineParaPublicar({ demo: true }, { CF_PAGES: '1' }), /demonstração/);
  assert.throws(() => conferirVitrineParaPublicar({ demo: true }, { CI: 'true' }), /demonstração/);
  conferirVitrineParaPublicar({ demo: true }, {});
  conferirVitrineParaPublicar({ demo: false }, { CF_PAGES: '1' });
  conferirVitrineParaPublicar(null, { CF_PAGES: '1' });
});

test('demonstração: ofertas em volta de hoje e produtos conferidos como os de verdade', async () => {
  const modelo = JSON.parse(await readFile(new URL('testes/produtos/demo/ofertas.json', RAIZ), 'utf8'));
  const ofertas = ofertasDeDemo(modelo, HOJE);
  assert.ok(ofertas.every((o) => o.inicio === '2026-11-22' && o.fim === '2026-12-05' && o.verificado_em === HOJE));
  const lojas = JSON.parse(await readFile(new URL('dados/lojas.json', RAIZ), 'utf8'));
  const produtos = JSON.parse(await readFile(new URL('testes/produtos/demo/produtos.json', RAIZ), 'utf8'));
  const vitrine = vitrineDeDemo(produtos, lojas, AGORA);
  assert.equal(vitrine.demo, true);
  assert.ok(vitrine.produtos.length >= 5);
  assert.ok(vitrine.produtos.every((p) => p.demo && p.nome.includes('(exemplo)')));
  assert.throws(() => vitrineDeDemo({ produtos: [{ ...produtos.produtos[0], link: 'https://golpe.com/' }] }, lojas, AGORA), /inválido/);
});

test('demonstração: monta uma cópia do site com produtos, sem mexer em site/ nem em dados/', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'demo-produtos-'));
  try {
    const antes = await readFile(new URL('dados/ofertas.json', RAIZ), 'utf8');
    const { vitrine, resultado } = await montarDemo({ pasta: pathToFileURL(`${pasta}/`), agora: new Date().toISOString() });
    assert.equal(resultado.resumo.produtos, true);
    const onde = await readFile(join(pasta, 'site', 'onde-rende-mais', 'index.html'), 'utf8');
    assert.match(onde, /Página de demonstração/);
    assert.ok(vitrine.produtos.every((p) => onde.includes(p.nome.replace('(', '(').split(' (')[0])));
    assert.equal(await readFile(new URL('dados/ofertas.json', RAIZ), 'utf8'), antes);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
