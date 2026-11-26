// Vitrine de produtos por API oficial: conferência dos dados, adaptadores
// (Amazon, Mercado Livre, Shopee, Awin) com fetch falso, cache e atualização.
// Nenhum teste usa a rede de verdade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  aindaVale, conferirConfig, linkDaLoja, normalizarProduto, reaisParaCentavos, somarHoras, textoLimpo,
} from '../scripts/produtos/normalizar.js';
import { ErroDeApi, faltando, pedirJson, semSegredos } from '../scripts/produtos/adaptadores/comum.js';
import { ADAPTADORES } from '../scripts/produtos/adaptadores/index.js';
import { URL_GET_ITEMS, URL_TOKEN } from '../scripts/produtos/adaptadores/amazon.js';
import { assinar } from '../scripts/produtos/adaptadores/shopee.js';
import { linhasCsv, urlDoFeed } from '../scripts/produtos/adaptadores/awin.js';
import {
  CACHE_HORAS, atualizarVitrine, cacheEmPasta, chaveDoCache, lerConfig, vitrineVazia,
} from '../scripts/produtos/atualizar.js';
import { validarSchema } from '../scripts/validar-dados.js';

const RAIZ = new URL('../', import.meta.url);
const AGORA = '2026-11-25T15:00:00.000Z';
const LOJA = { id: 'amazon', nome: 'Amazon', dominio: 'amazon.com.br' };
const ITEM = { id_na_loja: 'B0TESTE001', categoria: 'Eletrônicos', vendido_pela_loja: 'A_CONFIRMAR' };
const BRUTO = { nome: 'Fone', preco: 249.9, moeda: 'BRL', link: 'https://www.amazon.com.br/dp/B0TESTE001?tag=x-20', disponivel: true, vendido_pela_loja: true, afiliado: true };
const OPCOES = { loja: LOJA, item: ITEM, api: 'amazon', consultadoEm: AGORA, validadeHoras: 24 };

// ---------------------------------------------------------------------------
// Dinheiro, texto, link

test('reais para centavos: conta no texto, sem float, até 2 casas', () => {
  assert.equal(reaisParaCentavos(249.9), 24990);
  assert.equal(reaisParaCentavos('1299.90'), 129990);
  assert.equal(reaisParaCentavos('1299'), 129900);
  assert.equal(reaisParaCentavos(0.1), 10);
  assert.equal(reaisParaCentavos(' 59.9 '), 5990);
  for (const ruim of ['1.299,90', '12.345', '1e3', -5, Number.NaN, Infinity, null, undefined, {}, '', '10.999', 1234567890.5]) {
    assert.equal(reaisParaCentavos(ruim), null, String(ruim));
  }
});

test('texto limpo: tira controle e invisíveis, junta espaços, corta com reticências', () => {
  assert.equal(textoLimpo('  Fone\n\tsem​fio  '), 'Fone sem fio');
  assert.equal(textoLimpo('a‮b'), 'a b');
  assert.equal(textoLimpo('x'.repeat(130)).length, 120);
  assert.ok(textoLimpo('x'.repeat(130)).endsWith('…'));
  assert.equal(textoLimpo('   '), null);
  assert.equal(textoLimpo(42), null);
});

test('link da loja: só https no domínio (ou subdomínio), sem usuário nem porta', () => {
  assert.ok(linkDaLoja('https://www.amazon.com.br/dp/X', LOJA));
  assert.ok(linkDaLoja('https://amazon.com.br/', LOJA));
  for (const ruim of ['http://www.amazon.com.br/', 'https://amazon.com.br.golpe.com/', 'https://u:s@amazon.com.br/', 'https://amazon.com.br:8443/', 'javascript:alert(1)', 'nada']) {
    assert.equal(linkDaLoja(ruim, LOJA), false, ruim);
  }
  assert.equal(linkDaLoja('https://x.com/', { id: 'x', dominio: 'A_CONFIRMAR' }), false);
  assert.equal(linkDaLoja('https://x.com/', null), false);
});

test('validade: soma horas e confere se ainda vale', () => {
  assert.equal(somarHoras(AGORA, 24), '2026-11-26T15:00:00.000Z');
  assert.ok(aindaVale({ valido_ate: '2026-11-26T15:00:00.000Z' }, AGORA));
  assert.equal(aindaVale({ valido_ate: AGORA }, AGORA), false);
  assert.equal(aindaVale({ valido_ate: 'quebrado' }, AGORA), false);
  assert.equal(aindaVale(null, AGORA), false);
});

// ---------------------------------------------------------------------------
// normalizarProduto

test('normalizar: produto bom vira registro da vitrine', () => {
  const p = normalizarProduto(BRUTO, OPCOES);
  assert.deepEqual(p, {
    loja_id: 'amazon', id_na_loja: 'B0TESTE001', nome: 'Fone', preco_centavos: 24990, a_partir_de: false,
    link: BRUTO.link, afiliado: true, categoria: 'Eletrônicos', vendido_pela_loja: true, vendedor_confirmado: true,
    api: 'amazon', consultado_em: AGORA, valido_ate: '2026-11-26T15:00:00.000Z', demo: false,
  });
});

test('normalizar: o cadastro vence a API no vendedor; sem nenhum, conta como parceiro', () => {
  assert.equal(normalizarProduto(BRUTO, { ...OPCOES, item: { ...ITEM, vendido_pela_loja: false } }).vendido_pela_loja, false);
  const semNada = normalizarProduto({ ...BRUTO, vendido_pela_loja: null }, OPCOES);
  assert.equal(semNada.vendido_pela_loja, false);
  assert.equal(semNada.vendedor_confirmado, false);
  assert.equal(normalizarProduto(BRUTO, { ...OPCOES, item: { ...ITEM, categoria: 'A_CONFIRMAR' } }).categoria, null);
});

test('normalizar: validade nunca passa de 24 horas; "a partir de" e demonstração passam adiante', () => {
  const p = normalizarProduto({ ...BRUTO, a_partir_de: true }, { ...OPCOES, validadeHoras: 48, demo: true });
  assert.equal(p.valido_ate, '2026-11-26T15:00:00.000Z');
  assert.equal(p.a_partir_de, true);
  assert.equal(p.demo, true);
});

test('normalizar: cada problema tira o produto e diz o motivo', () => {
  const casos = [
    [undefined, /não devolveu/],
    [{ ...BRUTO, disponivel: false }, /indisponível/],
    [{ ...BRUTO, nome: ' ' }, /sem nome/],
    [{ ...BRUTO, moeda: 'USD' }, /moeda/],
    [{ ...BRUTO, preco: 0 }, /preço inválido/],
    [{ ...BRUTO, preco: '2000000' }, /preço inválido/],
    [{ ...BRUTO, preco: 'grátis' }, /preço inválido/],
    [{ ...BRUTO, link: 'https://golpe.com/amazon.com.br' }, /link fora do site/],
  ];
  for (const [bruto, motivo] of casos) assert.match(normalizarProduto(bruto, OPCOES).erro, motivo);
});

// ---------------------------------------------------------------------------
// dados/produtos.json

test('dados/produtos.json passa no schema e nas regras, e começa desligado', async () => {
  const config = JSON.parse(await readFile(new URL('dados/produtos.json', RAIZ), 'utf8'));
  const schema = JSON.parse(await readFile(new URL('dados/schemas/produtos.schema.json', RAIZ), 'utf8'));
  const lojas = JSON.parse(await readFile(new URL('dados/lojas.json', RAIZ), 'utf8'));
  assert.deepEqual(validarSchema(config, schema), []);
  assert.deepEqual(conferirConfig(config, { lojas }, { hoje: '2026-11-25' }), []);
  assert.equal(config.ligado, false);
  for (const loja of config.lojas) assert.ok(ADAPTADORES[loja.api], loja.api);
});

test('conferência de produtos.json: loja, repetição, validade, itens, awin e data', () => {
  const lojas = [LOJA, { id: 'sem-dominio', nome: 'X', dominio: 'A_CONFIRMAR' }];
  const base = { loja_id: 'amazon', api: 'amazon', validade_horas: 24, itens: [], fonte_url: 'https://x.com', verificado_em: '2026-11-25' };
  const itens = Array.from({ length: 11 }, (_, i) => ({ ...ITEM, id_na_loja: `B${i}` }));
  const erros = conferirConfig({
    ligado: true,
    lojas: [
      base,
      { ...base, validade_horas: 25, verificado_em: '2026-12-01' },
      { ...base, loja_id: 'nao-existe' },
      { ...base, loja_id: 'sem-dominio', api: 'awin', itens },
      { ...base, loja_id: 'outra', itens: [ITEM, ITEM] },
    ],
  }, { lojas }, { hoje: '2026-11-25' });
  const texto = erros.join('\n');
  for (const trecho of ['loja repetida', 'passa de 24', 'no futuro', 'não existe em lojas.json', 'domínio confirmado', 'mais de 10 itens', 'awin_anunciante_id', 'item repetido']) {
    assert.ok(texto.includes(trecho), trecho);
  }
});

test('lerConfig: arquivo bom passa; schema ou regra quebrada vira erro com a lista', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'produtos-config-'));
  try {
    const raiz = pathToFileURL(`${pasta}/`);
    await mkdir(join(pasta, 'dados', 'schemas'), { recursive: true });
    await writeFile(join(pasta, 'dados', 'schemas', 'produtos.schema.json'), await readFile(new URL('dados/schemas/produtos.schema.json', RAIZ)));
    const lojas = JSON.parse(await readFile(new URL('dados/lojas.json', RAIZ), 'utf8'));
    await writeFile(join(pasta, 'dados', 'produtos.json'), await readFile(new URL('dados/produtos.json', RAIZ)));
    assert.equal((await lerConfig(raiz, { lojas }, '2026-11-25')).ligado, false);
    await writeFile(join(pasta, 'dados', 'produtos.json'), JSON.stringify({ ligado: 'sim', lojas: [] }));
    await assert.rejects(lerConfig(raiz, { lojas }, '2026-11-25'), /ligado/);
    await writeFile(join(pasta, 'dados', 'produtos.json'), JSON.stringify({ ligado: true, lojas: [{ loja_id: 'nao-existe', api: 'amazon', validade_horas: 1, itens: [], fonte_url: 'https://x.com', verificado_em: '2026-11-25' }] }));
    await assert.rejects(lerConfig(raiz, { lojas }, '2026-11-25'), /não existe em lojas\.json/);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Peças comuns

function resposta(corpo, status = 200) {
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  return { ok: status >= 200 && status < 300, status, text: async () => texto };
}

test('pedirJson: erro HTTP, sem resposta e não-JSON viram ErroDeApi sem o segredo', async () => {
  await assert.rejects(pedirJson(async () => resposta('chave SEGREDO123 errada', 401), 'u', {}, { rotulo: 'X', segredos: ['SEGREDO123'] }),
    (e) => e instanceof ErroDeApi && /X: HTTP 401/.test(e.message) && !e.message.includes('SEGREDO123'));
  await assert.rejects(pedirJson(async () => { throw new Error('caiu em SEGREDO123'); }, 'u', {}, { rotulo: 'X', segredos: ['SEGREDO123'] }),
    (e) => /sem resposta/.test(e.message) && !e.message.includes('SEGREDO123'));
  await assert.rejects(pedirJson(async () => resposta('<html>'), 'u', {}, { rotulo: 'X' }), /não é JSON/);
  assert.equal(semSegredos('abc', [undefined, 'ab']), 'abc');
  assert.deepEqual(faltando({ A: 'x', B: ' ' }, ['A', 'B', 'C']), ['B', 'C']);
});

// ---------------------------------------------------------------------------
// Amazon

const ENV_AMAZON = { AMAZON_CREDENCIAL_ID: 'id-1', AMAZON_CREDENCIAL_SEGREDO: 'segredo-amazon', AMAZON_TAG_DE_ASSOCIADO: 'milhas-20' };

test('Amazon: token, getItems com ASINs e marketplace do Brasil, lê offersV2', async () => {
  const chamadas = [];
  const buscar = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    if (url === URL_TOKEN) return resposta({ access_token: 'tok-1', expires_in: 3600 });
    return resposta({
      itemsResult: {
        items: [
          {
            asin: 'B01', detailPageURL: 'https://www.amazon.com.br/dp/B01?tag=milhas-20', itemInfo: { title: { displayValue: 'Fone' } },
            offersV2: { listings: [
              { price: { money: { amount: 300, currency: 'BRL' } }, merchantInfo: { name: 'Loja X' } },
              { isBuyBoxWinner: true, price: { money: { amount: 249.9, currency: 'BRL' } }, availability: { type: 'IN_STOCK' }, merchantInfo: { name: 'Amazon.com.br' } },
            ] },
          },
          { asin: 'B02', detailPageURL: 'https://www.amazon.com.br/dp/B02', itemInfo: { title: { displayValue: 'Sem estoque' } },
            offersV2: { listings: [{ price: { money: { amount: 10, currency: 'BRL' } }, availability: { type: 'OUT_OF_STOCK' } }] } },
          { asin: 'B03', detailPageURL: 'https://www.amazon.com.br/dp/B03', itemInfo: { title: { displayValue: 'Sem oferta' } } },
        ],
      },
    });
  };
  const brutos = await ADAPTADORES.amazon.buscar({ itens: [{ id_na_loja: 'B01' }, { id_na_loja: 'B02' }], env: ENV_AMAZON, buscar });
  assert.equal(chamadas[0].url, URL_TOKEN);
  assert.deepEqual(JSON.parse(chamadas[0].opcoes.body), { grant_type: 'client_credentials', client_id: 'id-1', client_secret: 'segredo-amazon', scope: 'creatorsapi::default' });
  assert.equal(chamadas[1].url, URL_GET_ITEMS);
  assert.equal(chamadas[1].opcoes.headers.Authorization, 'Bearer tok-1');
  assert.equal(chamadas[1].opcoes.headers['x-marketplace'], 'www.amazon.com.br');
  const corpo = JSON.parse(chamadas[1].opcoes.body);
  assert.deepEqual(corpo.itemIds, ['B01', 'B02']);
  assert.equal(corpo.partnerTag, 'milhas-20');
  assert.deepEqual(brutos.get('B01'), {
    nome: 'Fone', preco: 249.9, moeda: 'BRL', link: 'https://www.amazon.com.br/dp/B01?tag=milhas-20', disponivel: true, vendido_pela_loja: true, afiliado: true,
  });
  assert.equal(brutos.get('B02').disponivel, false);
  assert.equal(brutos.get('B02').vendido_pela_loja, null);
  assert.equal(brutos.get('B03').disponivel, false);
});

test('Amazon: token sem access_token e getItems com erro param a loja', async () => {
  await assert.rejects(ADAPTADORES.amazon.buscar({ itens: [], env: ENV_AMAZON, buscar: async () => resposta({}) }), /sem access_token/);
  const buscar = async (url) => (url === URL_TOKEN ? resposta({ access_token: 'tok-secreto' }) : resposta('tok-secreto inválido', 403));
  await assert.rejects(ADAPTADORES.amazon.buscar({ itens: [], env: ENV_AMAZON, buscar }), (e) => /HTTP 403/.test(e.message) && !e.message.includes('tok-secreto'));
  const vazio = await ADAPTADORES.amazon.buscar({ itens: [], env: ENV_AMAZON, buscar: async (url) => resposta(url === URL_TOKEN ? { access_token: 't' } : {}) });
  assert.equal(vazio.size, 0);
});

// ---------------------------------------------------------------------------
// Mercado Livre

test('Mercado Livre: /items/bulk com token; só status 200 entra; vendedor fica em aberto', async () => {
  let pedido;
  const buscar = async (url, opcoes) => {
    pedido = { url, opcoes };
    return resposta([
      { status_code: 200, id: 'MLB1', body: { id: 'MLB1', title: 'Liquidificador', price: 189.9, currency_id: 'BRL', permalink: 'https://produto.mercadolivre.com.br/MLB-1', status: 'active' } },
      { status_code: 200, id: 'MLB2', body: { id: 'MLB2', title: 'Pausado', price: 10, currency_id: 'BRL', permalink: 'https://produto.mercadolivre.com.br/MLB-2', status: 'paused' } },
      { status_code: 404, id: 'MLB3', body: { message: 'not found' } },
    ]);
  };
  const brutos = await ADAPTADORES['mercado-livre'].buscar({ itens: [{ id_na_loja: 'MLB1' }, { id_na_loja: 'MLB2' }, { id_na_loja: 'MLB3' }], env: { ML_ACCESS_TOKEN: 'APP_USR-1' }, buscar });
  assert.match(pedido.url, /^https:\/\/api\.mercadolibre\.com\/items\/bulk\?ids=MLB1,MLB2,MLB3&attributes=body\.id,/);
  assert.equal(pedido.opcoes.headers.Authorization, 'Bearer APP_USR-1');
  assert.equal(brutos.get('MLB1').preco, 189.9);
  assert.equal(brutos.get('MLB1').vendido_pela_loja, null);
  assert.equal(brutos.get('MLB2').disponivel, false);
  assert.equal(brutos.has('MLB3'), false);
  const estranho = await ADAPTADORES['mercado-livre'].buscar({ itens: [{ id_na_loja: 'MLB1' }], env: { ML_ACCESS_TOKEN: 't' }, buscar: async () => resposta({ erro: 1 }) });
  assert.equal(estranho.size, 0);
});

// ---------------------------------------------------------------------------
// Shopee

test('Shopee: assinatura SHA-256 de AppId + Timestamp + corpo + Segredo', () => {
  // Conferido fora do Node: printf '%s' '1231700000000{}abc' | sha256sum
  assert.equal(
    assinar({ appId: '123', segredo: 'abc', timestamp: 1700000000, corpo: '{}' }),
    'SHA256 Credential=123, Timestamp=1700000000, Signature=1a49ed3b9b2d40933c0eba9e68d3722fe7fa4e60a039c05ce57845ba58736684',
  );
});

test('Shopee: uma consulta por item; preço que varia vira "a partir de"; link de afiliado', async () => {
  const pedidos = [];
  const buscar = async (url, opcoes) => {
    pedidos.push(opcoes);
    const id = /itemId: (\d+)/.exec(JSON.parse(opcoes.body).query)[1];
    if (id === '3') return resposta({ data: { productOfferV2: { nodes: [{ itemId: 999 }] } } });
    const no = id === '1'
      ? { itemId: 1, productName: 'Garrafa', price: '59.9', priceMin: '59.9', priceMax: '89.9', offerLink: 'https://s.shopee.com.br/abc' }
      : { itemId: 2, productName: 'Copo', price: '19.9', priceMin: '19.9', priceMax: '19.9', productLink: 'https://shopee.com.br/copo' };
    return resposta({ data: { productOfferV2: { nodes: [no] } } });
  };
  const brutos = await ADAPTADORES.shopee.buscar({
    itens: [{ id_na_loja: '1' }, { id_na_loja: '2' }, { id_na_loja: '3' }, { id_na_loja: 'abc' }],
    env: { SHOPEE_APP_ID: '123', SHOPEE_SEGREDO: 'abc' }, buscar, agora: AGORA,
  });
  assert.equal(pedidos.length, 3, 'código que não é número nem chega a ser consultado');
  assert.match(pedidos[0].headers.Authorization, /^SHA256 Credential=123, Timestamp=1795618800, Signature=[0-9a-f]{64}$/);
  assert.deepEqual(brutos.get('1'), { nome: 'Garrafa', preco: '59.9', moeda: 'BRL', link: 'https://s.shopee.com.br/abc', disponivel: true, vendido_pela_loja: null, afiliado: true, a_partir_de: true });
  assert.equal(brutos.get('2').afiliado, false);
  assert.equal(brutos.get('2').a_partir_de, false);
  assert.equal(brutos.has('3'), false, 'itemId diferente do pedido fica de fora');
});

// ---------------------------------------------------------------------------
// Awin

async function* pedacos(...lista) { for (const p of lista) yield p; }
async function todas(gerador) { const l = []; for await (const x of gerador) l.push(x); return l; }

test('CSV: aspas, aspas dobradas, vírgula e quebra de linha dentro de aspas, pedaço partido', async () => {
  const linhas = await todas(linhasCsv(pedacos('a,"b, c",d\r\n"x ""y""', '",2\n"quebra\nde linha",3')));
  assert.deepEqual(linhas, [['a', 'b, c', 'd'], ['x "y"', '2'], ['quebra\nde linha', '3']]);
  assert.deepEqual(await todas(linhasCsv(pedacos(''))), []);
});

test('Awin: link do feed com a chave, colunas e gzip', () => {
  assert.equal(urlDoFeed('chave/1', '42'),
    'https://productdata.awin.com/datafeed/download/apikey/chave%2F1/language/pt/fid/42/columns/aw_product_id,product_name,search_price,currency,merchant_deep_link,in_stock/format/csv/delimiter/%2C/compression/gzip/');
});

function feed(texto, status = 200) {
  const bytes = gzipSync(Buffer.from(texto));
  return { ok: status === 200, status, body: new Blob([bytes]).stream() };
}
const CSV = 'aw_product_id,product_name,search_price,currency,merchant_deep_link,in_stock\n' +
  '1,"Geladeira, 375 L",3299.00,BRL,https://www.casasbahia.com.br/geladeira,1\n' +
  '2,Outro,10.00,BRL,https://www.casasbahia.com.br/outro,1\n' +
  '3,TV,2199.90,BRL,https://www.casasbahia.com.br/tv,0\n';

test('Awin: lê o feed comprimido e para quando acha todos os escolhidos', async () => {
  let url;
  const brutos = await ADAPTADORES.awin.buscar({
    config: { awin_feed_id: '42' }, itens: [{ id_na_loja: '1' }, { id_na_loja: '3' }], env: { AWIN_CHAVE_FEED: 'k' },
    buscar: async (u) => { url = u; return feed(CSV); },
  });
  assert.match(url, /apikey\/k\/.*\/fid\/42\//);
  assert.deepEqual(brutos.get('1'), { nome: 'Geladeira, 375 L', preco: '3299.00', moeda: 'BRL', link: 'https://www.casasbahia.com.br/geladeira', disponivel: true, vendido_pela_loja: null, afiliado: false });
  assert.equal(brutos.get('3').disponivel, false);
  assert.equal(brutos.has('2'), false);
});

test('Awin: erro HTTP, falha de rede e feed grande demais param sem mostrar a chave', async () => {
  const base = { config: { awin_feed_id: '42' }, itens: [{ id_na_loja: '9' }], env: { AWIN_CHAVE_FEED: 'chave-secreta' } };
  await assert.rejects(ADAPTADORES.awin.buscar({ ...base, buscar: async () => feed('', 403) }), /HTTP 403/);
  await assert.rejects(ADAPTADORES.awin.buscar({ ...base, buscar: async () => { throw new Error('falhou chave-secreta'); } }),
    (e) => /sem resposta/.test(e.message) && !e.message.includes('chave-secreta'));
  await assert.rejects(ADAPTADORES.awin.buscar({ ...base, limiteBytes: 10, buscar: async () => feed(CSV) }), /passou de/);
  const nada = await ADAPTADORES.awin.buscar({ ...base, buscar: async () => feed(CSV) });
  assert.equal(nada.size, 0);
});

// ---------------------------------------------------------------------------
// atualizarVitrine

const LOJAS = [LOJA, { id: 'casas-bahia', nome: 'Casas Bahia', dominio: 'casasbahia.com.br' }];
function configCom(...lojas) { return { ligado: true, lojas }; }
const CFG_AMAZON = { loja_id: 'amazon', api: 'amazon', validade_horas: 24, itens: [ITEM], fonte_url: 'https://x.com', verificado_em: '2026-11-25' };

function cacheNaMemoria(inicial = {}) {
  const mapa = new Map(Object.entries(inicial));
  return { mapa, ler: async (id) => mapa.get(id) ?? null, gravar: async (id, c) => { mapa.set(id, c); } };
}
function adaptadorFalso(resultado) {
  const a = { id: 'amazon', variaveis: ['CHAVE'], chamadas: 0, async buscar() { a.chamadas += 1; if (resultado instanceof Error) throw resultado; return resultado; } };
  return a;
}

test('vitrine desligada: nenhuma chamada, vitrine vazia', async () => {
  const falso = adaptadorFalso(new Map());
  const { vitrine, avisos } = await atualizarVitrine({ config: { ligado: false, lojas: [CFG_AMAZON] }, dados: { lojas: LOJAS }, env: { CHAVE: 'x' }, agora: AGORA, cache: cacheNaMemoria(), adaptadores: { amazon: falso } });
  assert.deepEqual(vitrine, vitrineVazia(AGORA));
  assert.equal(falso.chamadas, 0);
  assert.match(avisos[0], /desligada/);
});

test('vitrine: sem credencial, sem itens ou Awin sem número, a loja é pulada com aviso', async () => {
  const falso = adaptadorFalso(new Map());
  const awin = { loja_id: 'casas-bahia', api: 'awin', validade_horas: 24, awin_anunciante_id: 'A_CONFIRMAR', awin_feed_id: '1', itens: [ITEM] };
  const { vitrine, avisos } = await atualizarVitrine({
    config: configCom(CFG_AMAZON, { ...CFG_AMAZON, itens: [] }, awin), dados: { lojas: LOJAS }, env: {}, agora: AGORA, cache: cacheNaMemoria(),
    adaptadores: { amazon: falso, awin: { variaveis: [] } },
  });
  assert.equal(vitrine.produtos.length, 0);
  assert.equal(falso.chamadas, 0);
  assert.match(avisos.join('\n'), /faltam as variáveis CHAVE/);
  assert.match(avisos.join('\n'), /nenhum produto escolhido/);
  assert.match(avisos.join('\n'), /A_CONFIRMAR/);
});

test('vitrine: consulta, confere, guarda no cache e avisa o que ficou de fora', async () => {
  const outro = { ...ITEM, id_na_loja: 'B0SEMPRECO' };
  const falso = adaptadorFalso(new Map([['B0TESTE001', BRUTO], ['B0SEMPRECO', { ...BRUTO, preco: null }]]));
  const cache = cacheNaMemoria();
  const cfg = { ...CFG_AMAZON, itens: [ITEM, outro] };
  const { vitrine, avisos } = await atualizarVitrine({ config: configCom(cfg), dados: { lojas: LOJAS }, env: { CHAVE: 'x' }, agora: AGORA, cache, adaptadores: { amazon: falso } });
  assert.equal(vitrine.produtos.length, 1);
  assert.equal(vitrine.demo, false);
  assert.match(avisos[0], /B0SEMPRECO: preço inválido/);
  assert.equal(cache.mapa.get('amazon').chave, chaveDoCache(cfg));

  // Até 1 hora depois, usa o cache sem chamar a API.
  const meiaHora = new Date(Date.parse(AGORA) + (CACHE_HORAS * 3_600_000) / 2).toISOString();
  const deNovo = await atualizarVitrine({ config: configCom(cfg), dados: { lojas: LOJAS }, env: { CHAVE: 'x' }, agora: meiaHora, cache, adaptadores: { amazon: falso } });
  assert.equal(falso.chamadas, 1);
  assert.equal(deNovo.vitrine.produtos.length, 1);

  // Itens mudaram: o cache não serve.
  await atualizarVitrine({ config: configCom({ ...cfg, itens: [ITEM] }), dados: { lojas: LOJAS }, env: { CHAVE: 'x' }, agora: meiaHora, cache, adaptadores: { amazon: falso } });
  assert.equal(falso.chamadas, 2);
});

test('vitrine: API falhou, ficam os preços guardados que ainda valem; sem cache, nada', async () => {
  const produto = normalizarProduto(BRUTO, OPCOES);
  const cache = cacheNaMemoria({ amazon: { chave: chaveDoCache(CFG_AMAZON), consultado_em: AGORA, produtos: [produto] } });
  const falhou = adaptadorFalso(new ErroDeApi('Amazon: HTTP 500'));
  const duasHoras = new Date(Date.parse(AGORA) + 2 * 3_600_000).toISOString();
  const r = await atualizarVitrine({ config: configCom(CFG_AMAZON), dados: { lojas: LOJAS }, env: { CHAVE: 'x' }, agora: duasHoras, cache, adaptadores: { amazon: falhou } });
  assert.equal(r.vitrine.produtos.length, 1);
  assert.match(r.avisos[0], /HTTP 500\. Ficam os 1 preço/);

  const umDia = new Date(Date.parse(AGORA) + 25 * 3_600_000).toISOString();
  const vencido = await atualizarVitrine({ config: configCom(CFG_AMAZON), dados: { lojas: LOJAS }, env: { CHAVE: 'x' }, agora: umDia, cache, adaptadores: { amazon: falhou } });
  assert.equal(vencido.vitrine.produtos.length, 0);
  assert.match(vencido.avisos[0], /Nenhum produto desta loja aparece/);

  const semCache = await atualizarVitrine({ config: configCom(CFG_AMAZON), dados: { lojas: LOJAS }, env: { CHAVE: 'x' }, agora: AGORA, cache: cacheNaMemoria(), adaptadores: { amazon: falhou } });
  assert.equal(semCache.vitrine.produtos.length, 0);
});

test('cache em pasta: grava e lê; arquivo que não existe é null', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'produtos-cache-'));
  try {
    const cache = cacheEmPasta(pathToFileURL(`${pasta}/sub/`));
    assert.equal(await cache.ler('amazon'), null);
    await cache.gravar('amazon', { a: 1 });
    assert.deepEqual(await cache.ler('amazon'), { a: 1 });
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
