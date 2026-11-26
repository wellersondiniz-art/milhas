// Links de saída (site/js/saida/links.js): lista de permissão, afiliado,
// aviso de comissão, sem redirecionador e sem efeito nenhum na ordem do resultado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AVISO_COMISSAO, AWIN_CLIQUE, REL_AFILIADO, REL_COMUM, conferirDestino, hostPermitido, montarLinkDeSaida, siteTemLinkDeAfiliado, siteUsaAwin,
} from '../site/js/saida/links.js';
import { calcularJeitosDeComprar } from '../site/js/motor/index.js';
import { conferirHtml } from '../scripts/paginas/conferir-html.js';
import { gerarPaginas } from '../scripts/paginas/montar.js';
import { lerDados } from '../scripts/gerar-paginas.js';
import { validarDados } from '../scripts/validar-dados.js';

const RAIZ = new URL('../', import.meta.url);
const DADOS = new URL('dados/', RAIZ);
const HOJE_DOS_DADOS = '2026-11-26';
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
  assert.deepEqual(montar(), { url: 'https://www.amazon.com.br/', destino: 'https://www.amazon.com.br/', afiliado: false, rede: null, rel: REL_COMUM, aviso: null });
  assert.equal(REL_COMUM, 'noopener noreferrer');
});

test('com parâmetro de afiliado: entra no endereço, rel="sponsored noopener noreferrer" e aviso de comissão', () => {
  const saida = montar({ parametro_afiliado: { nome: 'tag', valor: 'meucodigo-20' } });
  assert.deepEqual(saida, { url: 'https://www.amazon.com.br/?tag=meucodigo-20', destino: 'https://www.amazon.com.br/?tag=meucodigo-20', afiliado: true, rede: null, rel: REL_AFILIADO, aviso: AVISO_COMISSAO });
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
// Awin: única exceção à lista de permissão

const AWIN = { nome: 'awin', anunciante_id: '17629', afiliado_id: '123456' };

test('Awin: link fixo da Awin, destino (ued) no domínio da loja, sponsored e aviso', () => {
  const saida = montar({ programa_afiliado: 'Awin: Amazon BR', rede_afiliado: AWIN, url_base: 'https://www.amazon.com.br/ofertas?x=1&y=2' });
  assert.equal(AWIN_CLIQUE, 'https://www.awin1.com/cread.php');
  const url = new URL(saida.url);
  assert.equal(`${url.origin}${url.pathname}`, AWIN_CLIQUE);
  assert.deepEqual([...url.searchParams.keys()], ['awinmid', 'awinaffid', 'ued']);
  assert.equal(url.searchParams.get('awinmid'), '17629');
  assert.equal(url.searchParams.get('awinaffid'), '123456');
  assert.equal(url.searchParams.get('ued'), 'https://www.amazon.com.br/ofertas?x=1&y=2');
  assert.equal(saida.destino, 'https://www.amazon.com.br/ofertas?x=1&y=2');
  assert.equal(saida.rede, 'Awin');
  assert.equal(saida.rel, REL_AFILIADO);
  assert.equal(saida.aviso, AVISO_COMISSAO);
});

test('Awin: sem programa da Awin, com id estranho ou destino fora da loja, não passa pela Awin', () => {
  // programa_afiliado não diz Awin: link comum direto na loja.
  for (const programa_afiliado of ['A_CONFIRMAR', 'Programa de Associados da Amazon', 'Awinner']) {
    const saida = montar({ programa_afiliado, rede_afiliado: AWIN });
    assert.equal(saida.url, 'https://www.amazon.com.br/', programa_afiliado);
    assert.equal(saida.rede, null);
  }
  for (const rede_afiliado of ['A_CONFIRMAR', { ...AWIN, nome: 'outra' }, { ...AWIN, afiliado_id: '12a' }, { ...AWIN, anunciante_id: '' }, { nome: 'awin' }]) {
    assert.equal(montar({ programa_afiliado: 'Awin', rede_afiliado }).rede, null, JSON.stringify(rede_afiliado));
  }
  // O destino continua passando na lista de permissão: fora da loja, nada de link.
  assert.equal(montar({ programa_afiliado: 'Awin', rede_afiliado: AWIN, url_base: 'https://golpe.com.br/' }), null);
  assert.equal(montar({ programa_afiliado: 'Awin', rede_afiliado: AWIN, url_base: 'https://www.awin1.com/cread.php?ued=https://golpe.com.br' }), null);
});

test('Awin: siteUsaAwin só com link da Awin de verdade', () => {
  const lojas = LOJAS;
  assert.equal(siteUsaAwin({ lojas, links: [link()] }), false);
  assert.equal(siteUsaAwin({ lojas, links: [link({ programa_afiliado: 'Awin', rede_afiliado: AWIN })] }), true);
  assert.equal(siteUsaAwin({}), false);
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
    // Copia a pasta dados/ inteira (outros PRs acrescentam arquivos) e regrava só o que mudou.
    await cp(DADOS, `${pasta}/`, { recursive: true });
    const dados = await lerDados(DADOS);
    alterar(dados.links);
    for (const [nome, registros] of Object.entries(dados)) await writeFile(join(pasta, `${nome}.json`), JSON.stringify(registros));
    // Dados reais: "hoje" precisa ser depois da última verificação de qualquer arquivo.
    return (await validarDados(pathToFileURL(`${pasta}/`), { hoje: HOJE_DOS_DADOS })).erros;
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

test('validador: aceita os links reais e um parâmetro de afiliado bem formado', async () => {
  assert.deepEqual(await validarLinks(() => {}), []);
  assert.deepEqual(await validarLinks((links) => { links[0].parametro_afiliado = { nome: 'tag', valor: 'abc-20' }; }), []);
  assert.deepEqual(await validarLinks((links) => {
    links[3].programa_afiliado = 'Awin: Casas Bahia BR';
    links[3].rede_afiliado = { nome: 'awin', anunciante_id: '17629', afiliado_id: '123456' };
  }), []);
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
    [(l) => { l[0].rede_afiliado = { nome: 'awin', anunciante_id: '1', afiliado_id: '2' }; }, /rede_afiliado "awin" só vale quando programa_afiliado é da Awin/],
    [(l) => { l[0].programa_afiliado = 'Awin'; l[0].rede_afiliado = { nome: 'awin', anunciante_id: '1', afiliado_id: '2' }; l[0].parametro_afiliado = { nome: 'tag', valor: 'x' }; }, /use parametro_afiliado ou rede_afiliado, não os dois/],
    [(l) => { l[0].programa_afiliado = 'Awin'; l[0].rede_afiliado = { nome: 'awin', anunciante_id: '1x', afiliado_id: '2' }; }, /campo rede_afiliado/],
  ];
  for (const [alterar, esperado] of casos) {
    const erros = await validarLinks(alterar);
    assert.ok(erros.some((e) => esperado.test(e)), `${esperado}\n${erros.join('\n')}`);
  }
});
