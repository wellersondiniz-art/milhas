// Awin: feed de produtos do anunciante (Toolbox > Create-a-Feed).
//
// Documentação: https://help.awin.com/developers/docs/downloading-feeds-using-create-a-feed
// - O link de download leva a chave de feed (AWIN_CHAVE_FEED, diferente da
//   chave da API de afiliado) e o número do feed da loja (awin_feed_id).
// - O feed é o catálogo inteiro da loja (pode ter centenas de MB). Por isso o
//   arquivo é lido aos pedaços, comprimido, e a leitura para assim que todos
//   os produtos escolhidos aparecem. Nada do catálogo fica guardado.
// - Usamos merchant_deep_link (link no site da loja), que passa pela lista de
//   permissão de links. O link de rastreio da Awin (awin1.com) entra quando a
//   montagem de link de afiliado (PR 22) estiver na main.

import { ErroDeApi, PRAZO_MS, semSegredos } from './comum.js';

export const COLUNAS = ['aw_product_id', 'product_name', 'search_price', 'currency', 'merchant_deep_link', 'in_stock'];
/** Até onde lemos o feed antes de desistir (bytes já descomprimidos). */
export const LIMITE_BYTES = 500 * 1024 * 1024;

export function urlDoFeed(chave, feedId) {
  return 'https://productdata.awin.com/datafeed/download/apikey/' +
    `${encodeURIComponent(chave)}/language/pt/fid/${encodeURIComponent(feedId)}/columns/${COLUNAS.join(',')}` +
    '/format/csv/delimiter/%2C/compression/gzip/';
}

/**
 * Lê CSV (RFC 4180: aspas, aspas dobradas, quebra de linha dentro de aspas)
 * a partir de pedaços de texto. Gera uma lista de campos por linha.
 */
export async function* linhasCsv(pedacos) {
  let campo = '';
  let linha = [];
  let entreAspas = false;
  let aspaPendente = false; // viu " dentro de aspas; pode ser "" ou o fim
  for await (const pedaco of pedacos) {
    for (const c of pedaco) {
      if (aspaPendente) {
        aspaPendente = false;
        if (c === '"') { campo += '"'; continue; }
        entreAspas = false;
      }
      if (entreAspas) {
        if (c === '"') aspaPendente = true;
        else campo += c;
      } else if (c === '"') {
        entreAspas = true;
      } else if (c === ',') {
        linha.push(campo); campo = '';
      } else if (c === '\n') {
        linha.push(campo.replace(/\r$/, '')); campo = '';
        yield linha;
        linha = [];
      } else {
        campo += c;
      }
    }
  }
  if (campo !== '' || linha.length) { linha.push(campo.replace(/\r$/, '')); yield linha; }
}

async function* textoDe(corpo, limite) {
  const decodificador = new TextDecoder();
  let lidos = 0;
  for await (const bytes of corpo) {
    lidos += bytes.byteLength;
    if (lidos > limite) throw new ErroDeApi(`Awin (feed): passou de ${Math.round(limite / 1048576)} MB sem achar todos os produtos`);
    yield decodificador.decode(bytes, { stream: true });
  }
  yield decodificador.decode();
}

export const awin = {
  id: 'awin',
  variaveis: ['AWIN_CHAVE_FEED'],

  async buscar({ config, itens, env, buscar, limiteBytes = LIMITE_BYTES }) {
    const chave = env.AWIN_CHAVE_FEED;
    let resposta;
    try {
      resposta = await buscar(urlDoFeed(chave, config.awin_feed_id), { signal: AbortSignal.timeout(PRAZO_MS * 6) });
    } catch (falha) {
      throw new ErroDeApi(`Awin (feed): sem resposta (${semSegredos(falha.message, [chave])})`);
    }
    if (!resposta.ok || !resposta.body) throw new ErroDeApi(`Awin (feed): HTTP ${resposta.status}`);

    const procurados = new Set(itens.map((i) => i.id_na_loja));
    const brutos = new Map();
    const corpo = resposta.body.pipeThrough(new DecompressionStream('gzip'));
    let cabecalho = null;
    for await (const campos of linhasCsv(textoDe(corpo, limiteBytes))) {
      if (!cabecalho) { cabecalho = campos; continue; }
      const linha = Object.fromEntries(cabecalho.map((nome, i) => [nome, campos[i]]));
      if (!procurados.has(linha.aw_product_id)) continue;
      brutos.set(linha.aw_product_id, {
        nome: linha.product_name,
        preco: linha.search_price,
        moeda: linha.currency,
        link: linha.merchant_deep_link,
        disponivel: linha.in_stock !== '0',
        vendido_pela_loja: null,
        afiliado: false,
      });
      if (brutos.size === procurados.size) break;
    }
    return brutos;
  },
};
