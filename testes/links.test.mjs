// Links de saída (site/js/saida/links.js): lista de permissão, afiliado,
// aviso de comissão, sem redirecionador e sem efeito nenhum na ordem do resultado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AVISO_COMISSAO, REL_AFILIADO, REL_COMUM, conferirDestino, hostPermitido, montarLinkDeSaida, siteTemLinkDeAfiliado,
} from '../site/js/saida/links.js';
import { calcularJeitosDeComprar } from '../site/js/motor/index.js';
import { conferirHtml } from '../scripts/paginas/conferir-html.js';
import { gerarPaginas } from '../scripts/paginas/montar.js';
import { lerDados } from '../scripts/gerar-paginas.js';
import { validarDados } from '../scripts/validar-dados.js';

const RAIZ = new URL('../', import.meta.url);
const DADOS = new URL('dados/', RAIZ);
const HOJE = '2026-11-22';

const LOJAS = [
  { id: 'amazon', nome: 'Amazon', dominio: 'amazon.com.br' },
  { id: 'sem-dominio', nome: 'Sem domínio', dominio: 'A_CONFIRMAR' },
];
const link = (extra = {}) => ({ loja_id: 'amazon', url_base: 'https://www.amazon.com.br/', programa_afiliado: 'A_CONFIRMAR', ...extra });
const montar = (extra) => montarLinkDeSaida('amazon', { lojas: LOJAS, links: [link(extra)] });
const comAfiliado = (dados) => ({
  ...dados,
  links: dados.links.map((l) => ({ ...l, programa_afiliado: 'Programa X', parametro_afiliado: { nome: 'tag', valor: `codigo-${l.loja_id}` } })),
});

// ---------------------------------------------------------------------------
// Montar o link

test('sem parâmetro de afiliado: link comum, sem "sponsored" e sem aviso', () => {
  assert.deepEqual(montar(), { url: 'https://www.amazon.com.br/', afiliado: false, rel: REL_COMUM, aviso: null });
  assert.equal(REL_COMUM, 'noopener noreferrer');
});

test('com parâmetro de afiliado: entra no endereço, rel="sponsored noopener noreferrer" e aviso de comissão', () => {
  const saida = montar({ parametro_afiliado: { nome: 'tag', valor: 'meucodigo-20' } });
  assert.deepEqual(saida, { url: 'https://www.amazon.com.br/?tag=meucodigo-20', afiliado: true, rel: REL_AFILIADO, aviso: AVISO_COMISSAO });
  assert.equal(REL_AFILIADO, 'sponsored noopener noreferrer');
  assert.equal(AVISO_COMISSAO, 'Podemos ganhar uma comissão se você comprar por aqui, sem custo extra para você.');
});

test('o parâmetro troca um de mesmo nome que já esteja no endereço e mantém os outros', () => {
  const saida = montar({ url_base: 'https://www.amazon.com.br/promo?ref=x&tag=velho#topo', parametro_afiliado: { nome: 'tag', valor: 'novo' } });
  assert.equal(saida.url, 'https://www.amazon.com.br/promo?ref=x&tag=novo#topo');
});

test('parâmetro A_CONFIRMAR, incompleto ou com caractere estranho: link comum', () => {
  for (const parametro_afiliado of [
    'A_CONFIRMAR',
    { nome: 'tag', valor: 'A_CONFIRMAR' },
    { nome: 'A_CONFIRMAR', valor: 'x' },
    { nome: 'tag' },
    { nome: 'tag', valor: 'a&b=c' },
    { nome: 'tag', valor: '' },
    null,
  ]) {
    const saida = montar({ parametro_afiliado });
    assert.equal(saida.afiliado, false, JSON.stringify(parametro_afiliado));
    assert.equal(saida.url, 'https://www.amazon.com.br/');
    assert.equal(saida.aviso, null);
  }
});

test('lista de permissão: só https no domínio da loja ou em subdomínio dele', () => {
  for (const url of ['https://amazon.com.br/', 'https://www.amazon.com.br/x', 'https://m.amazon.com.br/', 'https://WWW.AMAZON.COM.BR/']) {
    assert.ok(montar({ url_base: url }), url);
  }
  for (const url of [
    'http://www.amazon.com.br/', // sem https
    'https://www.amazon.com.br.golpe.com/', // parece, mas é outro domínio
    'https://golpeamazon.com.br/', // termina igual, sem o ponto
    'https://amazon.com/', // outro domínio da mesma empresa: não cadastrado
    'https://usuario:senha@www.amazon.com.br/',
    'https://www.amazon.com.br:8443/',
    'javascript:alert(1)',
    'data:text/html,oi',
    '//www.amazon.com.br/',
    'https://awin1.com/cread.php?ued=https%3A%2F%2Fwww.amazon.com.br',
    'não é endereço',
    42,
  ]) {
    assert.equal(montar({ url_base: url }), null, String(url));
  }
});

test('sem loja, sem link ou loja sem domínio confirmado: não há link de saída', () => {
  assert.equal(montarLinkDeSaida('nao-existe', { lojas: LOJAS, links: [link()] }), null);
  assert.equal(montarLinkDeSaida('amazon', { lojas: LOJAS, links: [] }), null);
  assert.equal(montarLinkDeSaida('amazon', { lojas: LOJAS }), null);
  assert.equal(montarLinkDeSaida('sem-dominio', { lojas: LOJAS, links: [link({ loja_id: 'sem-dominio' })] }), null);
  assert.equal(montarLinkDeSaida('amazon', undefined), null);
  assert.equal(hostPermitido('amazon.com.br', 'A_CONFIRMAR'), false);
  assert.equal(hostPermitido(undefined, 'amazon.com.br'), false);
  assert.match(conferirDestino('https://x.com/', 'A_CONFIRMAR').motivo, /domínio A_CONFIRMAR/);
  assert.match(conferirDestino(1, 'x.com').motivo, /não é texto/);
});

// ---------------------------------------------------------------------------
// Sem redirecionador aberto

test('sem redirecionador: o destino só vem de dados/links.json, nunca do endereço da página', async () => {
  const pasta = new URL('site/js/', RAIZ);
  const arquivos = (await readdir(pasta, { recursive: true })).filter((a) => a.endsWith('.js'));
  for (const arquivo of arquivos) {
    const codigo = await readFile(new URL(arquivo, pasta), 'utf8');
    assert.doesNotMatch(codigo, /location\.(assign|replace)\s*\(|location\.href\s*=[^=]|window\.open\s*\(|document\.location\s*=/, arquivo);
    // O único parâmetro lido do endereço é ?loja=, e ele só escolhe a loja na lista.
    for (const m of codigo.matchAll(/searchParams\.get\(|URLSearchParams\(location\.search\)\.get\('([^']*)'\)/g)) {
      if (m[1] !== undefined) assert.equal(m[1], 'loja', arquivo);
    }
  }
  const site = await readdir(new URL('site/', RAIZ));
  assert.ok(!site.includes('_redirects'), 'site/_redirects criaria redirecionamento na Cloudflare');
  assert.equal(montarLinkDeSaida.length, 2, 'montarLinkDeSaida recebe só a loja e os dados');
});

// ---------------------------------------------------------------------------
// A ordem do resultado nunca muda por causa de comissão

test('o motor não conhece link de saída nem comissão', async () => {
  const pasta = new URL('site/js/motor/', RAIZ);
  for (const arquivo of await readdir(pasta)) {
    const codigo = await readFile(new URL(arquivo, pasta), 'utf8');
    assert.doesNotMatch(codigo, /saida\/|links\.js|\.links\b|afiliad|comiss|sponsored/i, arquivo);
  }
});

test('o resultado do motor é idêntico com e sem link de afiliado, em todas as lojas', async () => {
  const dados = await lerDados(DADOS);
  const afiliado = comAfiliado(dados);
  const { links, ...semLinks } = dados;
  assert.ok(links.length);
  const perfil = {
    programas: dados.programas.map((p) => ({ programa_id: p.id, clube_ativo: true, clube_ativo_desde: '2000-01-01' })),
    cartoes: dados.cartoes.map((c) => c.id),
    valor_milheiro_brl: {},
    cotacao_dolar: 55000,
  };
  for (const loja of dados.lojas) {
    const compra = { loja_id: loja.id, valor_centavos: 129_900, tipo_vendedor: 'loja' };
    const base = calcularJeitosDeComprar(perfil, compra, semLinks, `${HOJE}T12:00`);
    assert.deepEqual(calcularJeitosDeComprar(perfil, compra, afiliado, `${HOJE}T12:00`), base, loja.id);
    assert.deepEqual(calcularJeitosDeComprar(perfil, compra, dados, `${HOJE}T12:00`), base, loja.id);
  }
});

test('páginas: com afiliado, a lista de ofertas e as respostas das lojas ficam iguais; só o link e o aviso mudam', async () => {
  const dados = await lerDados(DADOS);
  const comum = gerarPaginas(dados, { hoje: HOJE, urlBase: null });
  const pago = gerarPaginas(comAfiliado(dados), { hoje: HOJE, urlBase: null });
  assert.deepEqual(pago.resumo, comum.resumo);
  const ofertas = (r) => r.arquivos.find((a) => a.caminho === 'ofertas/index.html').conteudo;
  assert.equal(ofertas(pago), ofertas(comum));
  const tirarSaida = (html) => html
    .replace(/<a class="botao botao--secundario botao--bloco" href="[^"]*" rel="[^"]*"( aria-describedby="aviso-comissao")?>[^<]*<\/a>/, '')
    .replace(/<p id="aviso-comissao" class="texto-suave texto-pequeno">[^<]*<\/p>/, '');
  for (const loja of dados.lojas) {
    const pagina = (r) => r.arquivos.find((a) => a.caminho === `loja/${loja.id}/index.html`).conteudo;
    assert.equal(tirarSaida(pagina(pago)), tirarSaida(pagina(comum)), loja.id);
  }
});

// ---------------------------------------------------------------------------
// Páginas das lojas

test('página da loja: link comum sem aviso; link de afiliado com sponsored e aviso visível ligado ao link', async () => {
  const dados = await lerDados(DADOS);
  const pagina = (d) => gerarPaginas(d, { hoje: HOJE, urlBase: null }).arquivos.find((a) => a.caminho === 'loja/amazon/index.html').conteudo;

  const comum = pagina(dados);
  assert.match(comum, /<a class="botao botao--secundario botao--bloco" href="https:\/\/www\.amazon\.com\.br\/" rel="noopener noreferrer">Ir para a loja Amazon<\/a>/);
  assert.doesNotMatch(comum, /sponsored|comissão se você comprar/);

  const pago = pagina(comAfiliado(dados));
  assert.match(pago, /<a class="botao botao--secundario botao--bloco" href="https:\/\/www\.amazon\.com\.br\/\?tag=codigo-amazon" rel="sponsored noopener noreferrer" aria-describedby="aviso-comissao">Ir para a loja Amazon<\/a><p id="aviso-comissao" class="texto-suave texto-pequeno">Podemos ganhar uma comissão se você comprar por aqui, sem custo extra para você\.<\/p>/);
  assert.deepEqual(conferirHtml(pago), []);
});

test('dados reais de hoje: nenhum link é de afiliado (o texto "não recebemos nada" continua verdadeiro)', async () => {
  const dados = await lerDados(DADOS);
  assert.equal(siteTemLinkDeAfiliado(dados), false);
  assert.equal(siteTemLinkDeAfiliado(comAfiliado(dados)), true);
  assert.equal(siteTemLinkDeAfiliado({}), false);
  // Toda loja tem link de saída, e todos passam na lista de permissão.
  for (const loja of dados.lojas) assert.ok(montarLinkDeSaida(loja.id, dados), loja.id);
});

// ---------------------------------------------------------------------------
// Validador

async function validarLinks(alterar) {
  const pasta = await mkdtemp(join(tmpdir(), 'links-'));
  try {
    await cp(new URL('schemas/', DADOS), join(pasta, 'schemas'), { recursive: true });
    const dados = await lerDados(DADOS);
    alterar(dados.links);
    for (const [nome, registros] of Object.entries(dados)) await writeFile(join(pasta, `${nome}.json`), JSON.stringify(registros));
    return (await validarDados(pathToFileURL(`${pasta}/`), { hoje: HOJE })).erros;
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

test('validador: aceita os links reais e um parâmetro de afiliado bem formado', async () => {
  assert.deepEqual(await validarLinks(() => {}), []);
  assert.deepEqual(await validarLinks((links) => { links[0].parametro_afiliado = { nome: 'tag', valor: 'abc-20' }; }), []);
});

test('validador: recusa domínio fora da lista, http, loja inexistente, loja repetida e parâmetro estranho', async () => {
  const casos = [
    [(l) => { l[0].url_base = 'https://www.golpe.com.br/'; }, /links\.json › registro 0 \(id "magalu"\) › campo url_base: url_base fora do domínio da loja \(magazineluiza\.com\.br\)/],
    [(l) => { l[0].url_base = 'http://www.magazineluiza.com.br/'; }, /campo url_base/],
    [(l) => { l[0].url_base = 'https://www.magazineluiza.com.br:444/'; }, /url_base não pode ter porta/],
    [(l) => { l[0].loja_id = 'nao-existe'; }, /id "nao-existe" não existe em lojas\.json/],
    [(l) => { l[1].loja_id = l[0].loja_id; }, /loja_id repetido: "magalu"/],
    [(l) => { l[0].parametro_afiliado = { nome: 'tag', valor: 'a b' }; }, /campo parametro_afiliado/],
    [(l) => { delete l[0].fonte_url; }, /campo fonte_url/],
  ];
  for (const [alterar, esperado] of casos) {
    const erros = await validarLinks(alterar);
    assert.ok(erros.some((e) => esperado.test(e)), `${esperado}\n${erros.join('\n')}`);
  }
});
