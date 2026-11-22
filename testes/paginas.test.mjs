// Gerador de páginas estáticas (scripts/gerar-paginas.js e scripts/paginas/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { gerarPaginas, naLoja, normalizarUrlBase } from '../scripts/paginas/montar.js';
import { conferirHtml, lerDescricao, lerTitulo } from '../scripts/paginas/conferir-html.js';
import { escaparHtml, h, jsonLd, linkExterno } from '../scripts/paginas/html.js';
import { conferirPaginas, gerarNoDisco, lerDados } from '../scripts/gerar-paginas.js';

const RAIZ = new URL('../', import.meta.url);
const HOJE = '2026-11-22';
const BASE = 'https://exemplo.com.br';
const FONTE = 'https://exemplo.invalid/fonte';
const MALICIOSO = '<script>alert("x")</script> & \'Loja\'';

/** Dados reais do repositório + ofertas de teste em várias situações. */
async function dadosDeTeste() {
  const dados = await lerDados(new URL('dados/', RAIZ));
  const oferta = (extra) => ({
    regras: [{ condicao: {}, pontos_por_real: 5 }, { condicao: { clube_ativo: true }, pontos_por_real: 8 }],
    escopo: 'todos_os_produtos',
    pontos_fora_do_escopo_por_real: 'A_CONFIRMAR',
    acumula_com_cartao: true,
    clube_ativo_ha_horas: 'A_CONFIRMAR',
    exige_cupom: false,
    inicio: '2026-11-01',
    fim: '2026-11-30',
    credito_prazo_dias: 15,
    link_oferta: 'A_CONFIRMAR',
    fonte_url: FONTE,
    verificado_em: HOJE,
    ...extra,
  });
  // Um cartão com pontos por real conhecido, para testar a soma com o cartão.
  dados.cartoes = dados.cartoes.map((c) => (c.id === 'ourocard-visa-infinite' ? { ...c, pontos_por_real: 2 } : c));
  dados.ofertas.push(
    oferta({ id: 'livelo-amazon-ativa', loja_id: 'amazon', programa_id: 'livelo' }),
    oferta({ id: 'smiles-kabum-conferindo', loja_id: 'kabum', programa_id: 'smiles', status: 'A_CONFIRMAR' }),
    oferta({ id: 'esfera-nike-futura', loja_id: 'nike', programa_id: 'esfera', inicio: '2026-12-01', fim: '2026-12-31' }),
  );
  dados.lojas.push({
    id: 'loja-maliciosa',
    nome: MALICIOSO,
    dominio: 'A_CONFIRMAR',
    categoria: 'A_CONFIRMAR',
    aceita_cupom: 'A_CONFIRMAR',
    observacoes: '',
    fonte_url: 'javascript:alert(1)',
    verificado_em: HOJE,
  });
  return dados;
}

const porCaminho = (arquivos) => Object.fromEntries(arquivos.map((a) => [a.caminho, a.conteudo]));
const textoVisivel = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// Escape

test('html: escapa texto e atributo, inclusive aspas simples', () => {
  assert.equal(escaparHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(h('p', { title: '"><script>' }, '<b>oi</b>').toString(), '<p title="&quot;&gt;&lt;script&gt;">&lt;b&gt;oi&lt;/b&gt;</p>');
});

test('html: nome de tag ou atributo vindo de dado é recusado', () => {
  assert.throws(() => h('p onclick=x'), /tag inválida/);
  assert.throws(() => h('p', { 'onclick="x"': 1 }), /atributo inválido/);
});

test('html: link externo só para http(s)', () => {
  assert.equal(linkExterno('javascript:alert(1)', 'fonte').toString(), 'fonte');
  assert.match(linkExterno('https://a.com', 'fonte').toString(), /^<a href="https:\/\/a.com" rel="noopener noreferrer nofollow">/);
});

test('html: JSON-LD não fecha a tag script mesmo com dado malicioso', () => {
  const bloco = jsonLd({ name: '</script><script>alert(1)</script>' }).toString();
  assert.equal(bloco.match(/<\/script>/g).length, 1);
  assert.equal(JSON.parse(bloco.slice(bloco.indexOf('>') + 1, -'</script>'.length)).name, '</script><script>alert(1)</script>');
});

// ---------------------------------------------------------------------------
// Conferência de HTML

const PAGINA_OK = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>T</title><meta name="description" content="D"></head><body><main><h1>Oi</h1></main></body></html>';

test('conferir: página mínima correta passa', () => {
  assert.deepEqual(conferirHtml(PAGINA_OK), []);
});

test('conferir: acha tag sem fechar, "<" solto, id repetido, JSON-LD quebrado e script que executa', () => {
  const ruim = PAGINA_OK
    .replace('<h1>Oi</h1>', '<h1>Oi</h1><div id="a"><p id="a">1 < 2</p><script type="application/ld+json">{x}</script><script>alert(1)</script>');
  const problemas = conferirHtml(ruim).join('\n');
  assert.match(problemas, /tags sem fechar|fecha/);
  assert.match(problemas, /"<" solto/);
  assert.match(problemas, /id repetido: a/);
  assert.match(problemas, /JSON-LD inválido/);
  assert.match(problemas, /script que executa/);
});

test('conferir: falta de h1, título ou descrição', () => {
  const problemas = conferirHtml(PAGINA_OK.replace('<h1>Oi</h1>', '').replace('<title>T</title>', '')).join('\n');
  assert.match(problemas, /<h1>/);
  assert.match(problemas, /<title>/);
});

// ---------------------------------------------------------------------------
// Páginas

test('gera uma página por loja, a de ofertas e o robots.txt', async () => {
  const dados = await dadosDeTeste();
  const { arquivos } = gerarPaginas(dados, { hoje: HOJE, urlBase: BASE });
  const caminhos = arquivos.map((a) => a.caminho);
  for (const loja of dados.lojas) assert.ok(caminhos.includes(`loja/${loja.id}/index.html`), loja.id);
  assert.ok(caminhos.includes('ofertas/index.html'));
  assert.ok(caminhos.includes('sitemap.xml'));
  assert.ok(caminhos.includes('robots.txt'));
});

test('todas as páginas passam na conferência, com título e descrição únicos', async () => {
  const { arquivos } = gerarPaginas(await dadosDeTeste(), { hoje: HOJE, urlBase: BASE });
  assert.deepEqual(conferirPaginas(arquivos), []);
  const html = arquivos.filter((a) => a.caminho.endsWith('.html')).map((a) => a.conteudo);
  assert.equal(new Set(html.map(lerTitulo)).size, html.length);
  assert.equal(new Set(html.map(lerDescricao)).size, html.length);
});

test('loja com oferta ativa: frase de resposta com os números do motor', async () => {
  const p = porCaminho(gerarPaginas(await dadosDeTeste(), { hoje: HOJE, urlBase: BASE }).arquivos);
  const amazon = p['loja/amazon/index.html'];
  const texto = textoVisivel(amazon);
  // Clube (8) + cartão Ourocard (2, soma com a oferta) = 10 pontos por real.
  assert.match(texto, /Na Amazon, o melhor jeito hoje rende 10 pontos por real\./);
  assert.match(texto, /pague com o cartão Ourocard Visa Infinite/);
  // 1.000 pontos numa compra de R$ 100 × milheiro de R$ 17,00 = R$ 17,00.
  assert.match(texto, /R\$\s17,00/);
  assert.match(texto, /os 1\.000 pontos de uma compra de R\$\s100,00/);
  assert.match(texto, /Estar com o clube Livelo ativo na hora da compra/);
  // Tabela das regras, validade, prazo, data e fonte.
  assert.match(amazon, /<table class="tabela">/);
  assert.match(texto, /Com o clube Livelo ativo 8/);
  assert.match(texto, /De 01\/11\/2026 até 30\/11\/2026/);
  assert.match(texto, /caem em até 15 dias/);
  assert.match(texto, /Conferido em 22\/11\/2026\. Ver a fonte/);
  assert.match(amazon, new RegExp(`href="${FONTE}"`));
  // Link para a calculadora com a loja escolhida.
  assert.match(amazon, /href="\.\.\/\.\.\/\?loja=amazon"/);
  // Explica clube e milheiro.
  assert.match(texto, /O que é clube\?/);
  assert.match(texto, /O que é milheiro\?/);
});

test('em empate, a resposta não pede clube nem cartão que não mudam nada', async () => {
  const dados = await dadosDeTeste();
  const oferta = dados.ofertas.find((o) => o.id === 'livelo-amazon-ativa');
  oferta.regras = [{ condicao: {}, pontos_por_real: 4 }];
  oferta.acumula_com_cartao = false; // cartão (2) perde da oferta (4)
  const texto = textoVisivel(porCaminho(gerarPaginas(dados, { hoje: HOJE, urlBase: null }).arquivos)['loja/amazon/index.html']);
  assert.match(texto, /Na Amazon, o melhor jeito hoje rende 4 pontos por real\. Compre na Amazon pela oferta do Livelo\./);
  assert.doesNotMatch(texto, /Para valer:.*clube/);
});

test('loja sem oferta ativa: página existe e não promete o que acabou', async () => {
  const p = porCaminho(gerarPaginas(await dadosDeTeste(), { hoje: HOJE, urlBase: BASE }).arquivos);
  const magalu = p['loja/magalu/index.html'];
  const texto = textoVisivel(magalu);
  // Sem oferta, o cartão de teste (2 pontos por real) é o que sobra.
  assert.match(texto, /Na Magalu, hoje não há oferta de pontos ativa que a gente conheça\. Só com o cartão, o melhor jeito rende 2 pontos por real\./);
  assert.match(texto, /Oferta Azul Fidelidade: terminou em 12\/11\/2026/);
  assert.doesNotMatch(magalu, /<table/);
  assert.doesNotMatch(texto, /15 pontos|13 pontos/);
  assert.match(magalu, /href="\.\.\/\.\.\/\?loja=magalu"/);
});

test('oferta A_CONFIRMAR e oferta que ainda não começou ficam fora da conta', async () => {
  const p = porCaminho(gerarPaginas(await dadosDeTeste(), { hoje: HOJE, urlBase: BASE }).arquivos);
  assert.match(textoVisivel(p['loja/kabum/index.html']), /Oferta Smiles: ainda em conferência/);
  assert.match(textoVisivel(p['loja/nike/index.html']), /Oferta Esfera: começa em 01\/12\/2026/);
  assert.match(textoVisivel(p['loja/nike/index.html']), /hoje não há oferta de pontos ativa/);
});

test('ofertas de hoje: só as ativas, da que mais rende para a que menos rende', async () => {
  const p = porCaminho(gerarPaginas(await dadosDeTeste(), { hoje: HOJE, urlBase: BASE }).arquivos);
  const pagina = p['ofertas/index.html'];
  const texto = textoVisivel(pagina);
  assert.match(texto, /Hoje, 22\/11\/2026, há 1 oferta de pontos ativa em 1 loja\. A que mais rende é a do Livelo na Amazon: até 10 pontos por real\./);
  const linhas = pagina.match(/<tbody>[\s\S]*<\/tbody>/)[0];
  assert.match(linhas, /Amazon/);
  for (const fora of ['Magalu', 'KaBuM!', 'Nike']) assert.doesNotMatch(linhas, new RegExp(fora));
  // Todas as lojas continuam listadas, com link.
  assert.match(pagina, /href="\.\.\/loja\/magalu\/"/);
  assert.match(texto, /Magalu · sem oferta ativa hoje/);
});

test('ofertas de hoje sem nenhuma ativa: diz isso com clareza', async () => {
  const dados = await lerDados(new URL('dados/', RAIZ));
  const texto = textoVisivel(porCaminho(gerarPaginas(dados, { hoje: HOJE, urlBase: null }).arquivos)['ofertas/index.html']);
  assert.match(texto, /não há nenhuma oferta de pontos ativa que a gente conheça/);
});

test('dado malicioso sai escapado no HTML e no JSON-LD', async () => {
  const p = porCaminho(gerarPaginas(await dadosDeTeste(), { hoje: HOJE, urlBase: BASE }).arquivos);
  for (const pagina of [p['loja/loja-maliciosa/index.html'], p['ofertas/index.html']]) {
    assert.doesNotMatch(pagina, /<script>alert/);
    assert.equal(conferirHtml(pagina).length, 0);
  }
  const loja = p['loja/loja-maliciosa/index.html'];
  assert.match(loja, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39;Loja&#39;/);
  assert.match(loja, /\\u003cscript\\u003e/);
  assert.doesNotMatch(loja, /javascript:/);
});

test('com URL base: canonical, og:url, JSON-LD com url e sitemap', async () => {
  const p = porCaminho(gerarPaginas(await dadosDeTeste(), { hoje: HOJE, urlBase: `${BASE}/` }).arquivos);
  const magalu = p['loja/magalu/index.html'];
  assert.match(magalu, /<link rel="canonical" href="https:\/\/exemplo.com.br\/loja\/magalu\/">/);
  assert.match(magalu, /<meta property="og:url" content="https:\/\/exemplo.com.br\/loja\/magalu\/">/);
  assert.match(magalu, /<meta property="og:title" content="Magalu: pontos e milhas hoje/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([^<]*)<\/script>/.exec(magalu)[1]);
  assert.equal(ld['@type'], 'WebPage');
  assert.equal(ld.url, 'https://exemplo.com.br/loja/magalu/');
  assert.equal(ld.about.url, 'https://magazineluiza.com.br');
  assert.equal(ld.breadcrumb.itemListElement.length, 2);
  assert.match(p['sitemap.xml'], /<loc>https:\/\/exemplo.com.br\/loja\/magalu\/<\/loc><lastmod>2026-11-22<\/lastmod>/);
  assert.match(p['sitemap.xml'], /<loc>https:\/\/exemplo.com.br\/ofertas\/<\/loc>/);
  assert.match(p['robots.txt'], /Sitemap: https:\/\/exemplo.com.br\/sitemap.xml/);
});

test('sem URL base (A_CONFIRMAR): sem canonical, sem og:url, sem sitemap, com aviso', async () => {
  const { arquivos, avisos } = gerarPaginas(await dadosDeTeste(), { hoje: HOJE, urlBase: 'A_CONFIRMAR' });
  const p = porCaminho(arquivos);
  assert.equal(p['sitemap.xml'], undefined);
  assert.doesNotMatch(p['loja/magalu/index.html'], /canonical|og:url/);
  assert.doesNotMatch(p['robots.txt'], /Sitemap/);
  assert.match(avisos.join(), /URL base do site A_CONFIRMAR/);
});

test('URL base do config é válida (canonical, og:url e sitemap ligados)', async () => {
  const { URL_BASE } = await import('../scripts/paginas/config.js');
  assert.equal(normalizarUrlBase(URL_BASE), URL_BASE);
  assert.match(URL_BASE, /^https:\/\//);
});

test('URL base inválida é recusada', () => {
  assert.throws(() => normalizarUrlBase('exemplo.com.br'), /URL base inválida/);
  assert.throws(() => normalizarUrlBase('https://exemplo.com.br/?x=1'), /URL base inválida/);
  assert.equal(normalizarUrlBase('https://exemplo.com.br/sub/'), 'https://exemplo.com.br/sub');
});

test('id de loja que não serve de pasta é recusado', async () => {
  const dados = await dadosDeTeste();
  dados.lojas.push({ ...dados.lojas[0], id: '../fora' });
  assert.throws(() => gerarPaginas(dados, { hoje: HOJE }), /id de loja inválido/);
});

test('preposição da loja: na, no, nas', () => {
  assert.equal(naLoja({ nome: 'Magalu' }), 'na Magalu');
  assert.equal(naLoja({ nome: 'Mercado Livre', artigo: 'o' }), 'no Mercado Livre');
  assert.equal(naLoja({ nome: 'Casas Bahia', artigo: 'as' }), 'nas Casas Bahia');
});

test('gerar no disco: grava os arquivos e todo link interno leva a um arquivo', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'paginas-'));
  const saida = pathToFileURL(`${pasta}/site/`);
  await cp(new URL('site/', RAIZ), saida, { recursive: true });
  const { arquivos } = await gerarNoDisco({ pastaDados: new URL('dados/', RAIZ), saida, hoje: HOJE, urlBase: BASE });
  const lojas = await readdir(new URL('loja/', saida));
  const dados = await lerDados(new URL('dados/', RAIZ));
  assert.deepEqual(lojas.sort(), dados.lojas.map((l) => l.id).sort());
  assert.equal(arquivos.length, dados.lojas.length + 3);
  assert.match(await readFile(new URL('robots.txt', saida), 'utf8'), /Sitemap:/);
});

test('gerar no disco: dados inválidos não gravam nada', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'paginas-'));
  const dadosDir = pathToFileURL(`${pasta}/dados/`);
  await mkdir(dadosDir);
  await cp(new URL('dados/', RAIZ), dadosDir, { recursive: true });
  const lojas = JSON.parse(await readFile(new URL('lojas.json', dadosDir), 'utf8'));
  lojas[0].verificado_em = 'ontem';
  await writeFile(new URL('lojas.json', dadosDir), JSON.stringify(lojas));
  const saida = pathToFileURL(`${pasta}/site/`);
  await assert.rejects(gerarNoDisco({ pastaDados: dadosDir, saida, hoje: HOJE, urlBase: null }), /Dados inválidos/);
  await assert.rejects(readdir(saida));
});
