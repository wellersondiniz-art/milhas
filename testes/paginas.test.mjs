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
  // A oferta de exemplo (Azul na Magalu, terminou em 12/11) saiu da base de
  // produção e ficou só em testes/exemplos/.
  dados.ofertas = [
    ...JSON.parse(await readFile(new URL('testes/exemplos/ofertas-exemplo.json', RAIZ), 'utf8')),
    ...dados.ofertas,
  ];
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

test('html: link externo só para https://', () => {
  assert.equal(linkExterno('javascript:alert(1)', 'fonte').toString(), 'fonte');
  assert.equal(linkExterno('http://a.com', 'fonte').toString(), 'fonte');
  assert.equal(linkExterno('data:text/html,oi', 'fonte').toString(), 'fonte');
  assert.equal(linkExterno('//a.com', 'fonte').toString(), 'fonte');
  assert.equal(linkExterno('https://a.com/x y', 'fonte').toString(), 'fonte');
  assert.equal(linkExterno('A_CONFIRMAR', 'fonte').toString(), 'fonte');
  assert.match(linkExterno('https://a.com', 'fonte').toString(), /^<a href="https:\/\/a.com" rel="noopener noreferrer nofollow" class="alvo-toque">/);
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

test('conferir: módulo do próprio site passa; script de fora, inline ou sem tipo não', () => {
  const com = (tag) => conferirHtml(PAGINA_OK.replace('<h1>Oi</h1>', `<h1>Oi</h1>${tag}`)).join('\n');
  assert.equal(com('<script type="module" src="../js/metricas/paginas.js"></script>'), '');
  assert.match(com('<script type="module" src="https://plausible.io/js/script.js"></script>'), /script que executa/);
  assert.match(com('<script type="module" src="//cdn.exemplo/x.js"></script>'), /script que executa/);
  assert.match(com('<script type="module" src="../js/x.js">alert(1)</script>'), /script que executa|não pode ter código dentro/);
  assert.match(com('<script type="module">alert(1)</script>'), /script que executa/);
  assert.match(com('<script src="../js/x.js"></script>'), /script que executa/);
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
  assert.ok(caminhos.includes('onde-rende-mais/index.html'));
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

// ---------------------------------------------------------------------------
// Ciclo de vida nas páginas (as regras estão em site/js/motor/ciclo.js)

async function dadosDoCiclo() {
  const dados = await dadosDeTeste();
  const base = dados.ofertas.find((o) => o.id === 'livelo-amazon-ativa');
  dados.ofertas.push(
    { ...base, id: 'livelo-shopee-vence', loja_id: 'shopee', fim: '2026-11-25' },
    { ...base, id: 'livelo-centauro-antiga', loja_id: 'centauro', verificado_em: '2026-11-01' },
    { ...base, id: 'livelo-netshoes-reconferir', loja_id: 'netshoes', verificado_em: '2026-10-20' },
  );
  return dados;
}

test('ciclo: oferta que vence em até 3 dias ganha selo na loja e na lista de ofertas', async () => {
  const p = porCaminho(gerarPaginas(await dadosDoCiclo(), { hoje: HOJE, urlBase: BASE }).arquivos);
  assert.match(p['loja/shopee/index.html'], /<span class="selo selo--aviso">Vence em 3 dias<\/span>/);
  assert.doesNotMatch(p['loja/amazon/index.html'], /Vence em/);
  const linhas = p['ofertas/index.html'].match(/<tbody>[\s\S]*<\/tbody>/)[0];
  assert.match(linhas, /até 25\/11\/2026 <span class="selo selo--aviso">Vence em 3 dias<\/span>/);
});

test('ciclo: conferida há mais de 14 dias fica na lista, com aviso', async () => {
  const p = porCaminho(gerarPaginas(await dadosDoCiclo(), { hoje: HOJE, urlBase: BASE }).arquivos);
  assert.match(p['loja/centauro/index.html'], /Conferida há 21 dias/);
  assert.match(textoVisivel(p['loja/centauro/index.html']), /Dado verificado há mais de 14 dias \(21 dias\)/);
  const linhas = p['ofertas/index.html'].match(/<tbody>[\s\S]*<\/tbody>/)[0];
  assert.match(linhas, /Centauro/);
  assert.match(linhas, /01\/11\/2026 <span class="selo selo--aviso">dado antigo<\/span>/);
});

test('ciclo: conferida há mais de 30 dias sai do ranking até reconferir', async () => {
  const p = porCaminho(gerarPaginas(await dadosDoCiclo(), { hoje: HOJE, urlBase: BASE }).arquivos);
  const ofertas = p['ofertas/index.html'];
  assert.doesNotMatch(ofertas.match(/<tbody>[\s\S]*<\/tbody>/)[0], /Netshoes/);
  assert.match(textoVisivel(ofertas), /Fora da lista até a gente conferir de novo Netshoes · Livelo: conferida pela última vez em 20\/10\/2026, há 33 dias; fica fora da conta até ser conferida de novo\./);
  const loja = textoVisivel(p['loja/netshoes/index.html']);
  assert.match(loja, /hoje não há oferta de pontos ativa/);
  assert.match(loja, /Ofertas fora da conta hoje Oferta Livelo: conferida pela última vez em 20\/10\/2026, há 33 dias/);
});

test('ciclo: vencida some do ranking e vai para o histórico', async () => {
  const p = porCaminho(gerarPaginas(await dadosDoCiclo(), { hoje: HOJE, urlBase: BASE }).arquivos);
  assert.match(textoVisivel(p['loja/magalu/index.html']), /Histórico: ofertas que já acabaram Oferta Azul Fidelidade: terminou em 12\/11\/2026/);
  assert.doesNotMatch(textoVisivel(p['loja/magalu/index.html']), /Ofertas fora da conta hoje/);
  assert.match(textoVisivel(p['ofertas/index.html']), /Histórico: ofertas que já acabaram Magalu · Azul Fidelidade: terminou em 12\/11\/2026\./);
});

test('ciclo: no dia seguinte ao último, a oferta sai da lista e entra no histórico', async () => {
  const dados = await dadosDoCiclo();
  const ultimoDia = porCaminho(gerarPaginas(dados, { hoje: '2026-11-25', urlBase: BASE }).arquivos);
  assert.match(ultimoDia['loja/shopee/index.html'], /Vence hoje/);
  const depois = porCaminho(gerarPaginas(dados, { hoje: '2026-11-26', urlBase: BASE }).arquivos);
  assert.doesNotMatch(depois['ofertas/index.html'].match(/<tbody>[\s\S]*<\/tbody>/)[0], /Shopee/);
  assert.match(textoVisivel(depois['loja/shopee/index.html']), /Histórico: ofertas que já acabaram Oferta Livelo: terminou em 25\/11\/2026/);
});

test('ofertas de hoje sem nenhuma ativa: diz isso com clareza', async () => {
  const dados = await lerDados(new URL('dados/', RAIZ));
  const texto = textoVisivel(porCaminho(gerarPaginas(dados, { hoje: HOJE, urlBase: null }).arquivos)['ofertas/index.html']);
  assert.match(texto, /não há nenhuma oferta de pontos ativa que a gente conheça/);
});

// ---------------------------------------------------------------------------
// Onde rende mais hoje

/** Dados de teste + duas ofertas por categoria na Casas Bahia, uma com produtos citados. */
async function dadosComCategorias() {
  const dados = await dadosDeTeste();
  const base = dados.ofertas.find((o) => o.id === 'livelo-amazon-ativa');
  dados.ofertas.push(
    {
      ...base,
      id: 'esfera-casas-bahia-eletro',
      loja_id: 'casas-bahia',
      programa_id: 'esfera',
      regras: [{ condicao: {}, pontos_por_real: 10 }, { condicao: { clube_ativo: true }, pontos_por_real: 12 }],
      escopo: 'categorias_selecionadas',
      categorias_incluidas: ['Eletrônicos', 'Celulares'],
      pontos_fora_do_escopo_por_real: 2,
      produtos_em_campanha: [
        { nome: 'Smartphone Exemplo 128 GB', link: 'https://www.casasbahia.com.br/smartphone-exemplo' },
        { nome: MALICIOSO, link: 'https://www.casasbahia.com.br/outro' },
      ],
      fim: '2026-11-23',
    },
    {
      ...base,
      id: 'esfera-casas-bahia-resto',
      loja_id: 'casas-bahia',
      programa_id: 'esfera',
      regras: [{ condicao: {}, pontos_por_real: 3 }],
      escopo: 'todos_os_produtos',
      categorias_excluidas: ['Eletrônicos', 'Celulares'],
    },
  );
  return dados;
}

test('onde rende mais: categoria em campanha no topo, com números do motor, produtos e fonte', async () => {
  const p = porCaminho(gerarPaginas(await dadosComCategorias(), { hoje: HOJE, urlBase: BASE }).arquivos);
  const pagina = p['onde-rende-mais/index.html'];
  const texto = textoVisivel(pagina);
  assert.match(texto, /Hoje, 22\/11\/2026, o que mais rende para qualquer pessoa é Eletrônicos e Celulares nas Casas Bahia pelo Esfera: 10 pontos por real\./);
  // Ordem: Casas Bahia eletro (10), Amazon (5, até 8), Casas Bahia resto (3).
  const titulos = [...pagina.matchAll(/<h2 id="oportunidade-\d+"[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(titulos, ['1. Casas Bahia · Esfera', '2. Amazon · Livelo', '3. Casas Bahia · Esfera']);
  // 1.000 pontos a cada R$ 100 × milheiro R$ 17,00 = R$ 17,00.
  assert.match(texto, /A cada R\$ 100 1\.000 pontos, que valem cerca de R\$\s17,00/);
  assert.match(texto, /Até 12 pontos por real, com o clube Esfera ativo\./);
  assert.match(texto, /Até 8 pontos por real, com o clube Livelo ativo\./);
  assert.match(texto, /O que entra Só estas categorias: Eletrônicos, Celulares\./);
  assert.match(texto, /Vale para qualquer produto, menos Eletrônicos e Celulares\./);
  assert.match(texto, /Fora da oferta 2 pontos por real\./);
  assert.match(texto, /Todos os produtos\. Fora: Eletrônicos, Celulares\. Fora da oferta Não confirmado\./);
  assert.match(texto, /Até 23\/11\/2026 \(vence amanhã\)/);
  assert.match(texto, /Até 30\/11\/2026 \(faltam 8 dias\)/);
  assert.match(pagina, /href="https:\/\/www\.casasbahia\.com\.br\/smartphone-exemplo" rel="noopener noreferrer nofollow"[^>]*>Smartphone Exemplo 128 GB</);
  assert.match(pagina, new RegExp(`href="${FONTE}"`));
  assert.match(pagina, /href="\.\.\/loja\/casas-bahia\/"[^>]*>Ver todas as regras nas Casas Bahia</);
  assert.match(pagina, /href="\.\.\/"[^>]*>Calcular com os meus cartões e clubes</);
  // Sem preço, e explica as palavras.
  assert.doesNotMatch(texto, /preço do produto|R\$\s\d+\.\d{3},\d{2}/);
  assert.match(texto, /O que é milheiro\?/);
  assert.match(texto, /O que é clube\?/);
  // Dado malicioso escapado; página passa na conferência.
  assert.doesNotMatch(pagina, /<script>alert/);
  assert.equal(conferirHtml(pagina).length, 0);
  // Sitemap e link a partir de /ofertas/.
  assert.match(p['sitemap.xml'], /https:\/\/exemplo\.com\.br\/onde-rende-mais\//);
  assert.match(p['ofertas/index.html'], /href="\.\.\/onde-rende-mais\/"/);
});

test('onde rende mais: valor sem milheiro, oferta só com clube, fim não confirmado e vence hoje', async () => {
  const dados = await dadosComCategorias();
  dados.programas = dados.programas.map((pr) => (pr.id === 'esfera' ? { ...pr, valor_milheiro_brl: 'A_CONFIRMAR' } : pr));
  const amazon = dados.ofertas.find((o) => o.id === 'livelo-amazon-ativa');
  amazon.regras = [{ condicao: { clube_ativo: true, cartao_id: 'ourocard-visa-infinite' }, pontos_por_real: 20 }];
  amazon.fim = 'A_CONFIRMAR';
  dados.ofertas.find((o) => o.id === 'esfera-casas-bahia-resto').fim = HOJE;
  const texto = textoVisivel(porCaminho(gerarPaginas(dados, { hoje: HOJE, urlBase: null }).arquivos)['onde-rende-mais/index.html']);
  assert.match(texto, /falta o valor do milheiro do Esfera/);
  assert.match(texto, /Para qualquer pessoa Nenhum ponto extra sem clube ou cartão específico\./);
  assert.match(texto, /Até 20 pontos por real, com o clube Livelo ativo e o cartão Ourocard Visa Infinite\./);
  assert.match(texto, /Fim não confirmado: confira antes de comprar\./);
  assert.match(texto, /\(vence hoje\)/);
});

test('onde rende mais: só ofertas com clube, e nenhuma oferta ativa', async () => {
  const dados = await dadosDeTeste();
  dados.ofertas.find((o) => o.id === 'livelo-amazon-ativa').regras = [{ condicao: { clube_ativo: true }, pontos_por_real: 8 }];
  const soClube = textoVisivel(porCaminho(gerarPaginas(dados, { hoje: HOJE, urlBase: null }).arquivos)['onde-rende-mais/index.html']);
  assert.match(soClube, /as ofertas ativas só rendem pontos extras com clube ou cartão específico/);
  assert.doesNotMatch(soClube, /A cada R\$ 100/);

  const vazio = textoVisivel(porCaminho(gerarPaginas(await lerDados(new URL('dados/', RAIZ)), { hoje: HOJE, urlBase: null }).arquivos)['onde-rende-mais/index.html']);
  assert.match(vazio, /não há nenhuma oferta de pontos ativa que a gente conheça/);
});

test('página da loja: bloco "O que mais rende aqui" e produtos citados na oferta', async () => {
  const p = porCaminho(gerarPaginas(await dadosComCategorias(), { hoje: HOJE, urlBase: BASE }).arquivos);
  const loja = p['loja/casas-bahia/index.html'];
  const texto = textoVisivel(loja);
  assert.match(texto, /O que mais rende aqui/);
  assert.match(texto, /Eletrônicos e Celulares, pelo Esfera: 10 pontos por real \(até 12 pontos por real\)\. Produtos citados na campanha: Smartphone Exemplo 128 GB/);
  assert.match(texto, /Qualquer produto, menos Eletrônicos e Celulares, pelo Esfera: 3 pontos por real\./);
  assert.match(loja, /href="\.\.\/\.\.\/onde-rende-mais\/"/);
  assert.match(texto, /Produtos citados na campanha Smartphone Exemplo 128 GB/);
  assert.doesNotMatch(loja, /<script>alert/);
  assert.equal(conferirHtml(loja).length, 0);
  // Uma oferta só, sem produtos: sem o bloco (as regras já dizem tudo).
  assert.doesNotMatch(textoVisivel(p['loja/amazon/index.html']), /O que mais rende aqui/);
});

test('página da loja: uma oferta só, mas com produtos, mostra o bloco; só clube diz isso', async () => {
  const dados = await dadosDeTeste();
  const amazon = dados.ofertas.find((o) => o.id === 'livelo-amazon-ativa');
  amazon.regras = [{ condicao: { clube_ativo: true }, pontos_por_real: 8 }];
  amazon.escopo = 'vendido_e_entregue_pela_loja';
  amazon.produtos_em_campanha = [{ nome: 'Fone Exemplo', link: 'https://www.amazon.com.br/fone' }];
  const texto = textoVisivel(porCaminho(gerarPaginas(dados, { hoje: HOJE, urlBase: null }).arquivos)['loja/amazon/index.html']);
  assert.match(texto, /Produtos vendidos e entregues pela própria loja, pelo Livelo: nada extra sem clube ou cartão \(até 8 pontos por real\)\./);
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
  const { arquivos } = await gerarNoDisco({ pastaDados: new URL('dados/', RAIZ), saida, hoje: '2026-11-23', urlBase: BASE });
  const lojas = await readdir(new URL('loja/', saida));
  const dados = await lerDados(new URL('dados/', RAIZ));
  assert.deepEqual(lojas.sort(), dados.lojas.map((l) => l.id).sort());
  assert.equal(arquivos.length, dados.lojas.length + 4 + 5);
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
