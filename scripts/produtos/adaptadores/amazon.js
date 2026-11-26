// Amazon: Creators API (sucessora da PA-API 5, que responde 403 desde 2026).
//
// Documentação: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/migrating-to-creatorsapi-from-paapi
// - Token OAuth 2.0 (client_credentials). Brasil fica na região NA, versão 3.1:
//   https://api.amazon.com/auth/o2/token. O token vale 1 hora.
// - getItems em https://creatorsapi.amazon/catalog/v1/getItems, até 10 ASINs,
//   com o cabeçalho x-marketplace.
// - Preço vem de offersV2 (offers v1 não existe na Creators API).
// Regras do Associados Amazon (Licença, itens h e i): guardar preço por no
// máximo 24 horas, nunca guardar imagem, data/hora e aviso ao lado do preço.
// Por isso o site não mostra foto do produto.

import { ErroDeApi, pedirJson } from './comum.js';

export const URL_TOKEN = 'https://api.amazon.com/auth/o2/token';
export const URL_GET_ITEMS = 'https://creatorsapi.amazon/catalog/v1/getItems';
export const MARKETPLACE = 'www.amazon.com.br';
const RECURSOS = [
  'itemInfo.title',
  'offersV2.listings.price',
  'offersV2.listings.availability',
  'offersV2.listings.merchantInfo',
  'offersV2.listings.isBuyBoxWinner',
];
const VENDEDOR_AMAZON = /^amazon(\.com)?(\.br)?$/i;

export const amazon = {
  id: 'amazon',
  variaveis: ['AMAZON_CREDENCIAL_ID', 'AMAZON_CREDENCIAL_SEGREDO', 'AMAZON_TAG_DE_ASSOCIADO'],

  async buscar({ itens, env, buscar }) {
    const segredos = [env.AMAZON_CREDENCIAL_SEGREDO, env.AMAZON_CREDENCIAL_ID];
    const token = await pedirJson(buscar, URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: env.AMAZON_CREDENCIAL_ID,
        client_secret: env.AMAZON_CREDENCIAL_SEGREDO,
        scope: 'creatorsapi::default',
      }),
    }, { rotulo: 'Amazon (token)', segredos });
    if (typeof token.access_token !== 'string') throw new ErroDeApi('Amazon (token): resposta sem access_token');

    const resposta = await pedirJson(buscar, URL_GET_ITEMS, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'x-marketplace': MARKETPLACE,
      },
      body: JSON.stringify({
        itemIds: itens.map((i) => i.id_na_loja),
        itemIdType: 'ASIN',
        partnerTag: env.AMAZON_TAG_DE_ASSOCIADO,
        marketplace: MARKETPLACE,
        resources: RECURSOS,
      }),
    }, { rotulo: 'Amazon (getItems)', segredos: [...segredos, token.access_token] });

    const brutos = new Map();
    for (const item of resposta?.itemsResult?.items ?? []) {
      const listagens = item?.offersV2?.listings ?? [];
      const oferta = listagens.find((l) => l?.isBuyBoxWinner) ?? listagens[0];
      const vendedor = oferta?.merchantInfo?.name;
      brutos.set(item.asin, {
        nome: item?.itemInfo?.title?.displayValue,
        preco: oferta?.price?.money?.amount,
        moeda: oferta?.price?.money?.currency,
        link: item.detailPageURL,
        disponivel: oferta ? oferta?.availability?.type !== 'OUT_OF_STOCK' : false,
        vendido_pela_loja: typeof vendedor === 'string' ? VENDEDOR_AMAZON.test(vendedor.trim()) : null,
        afiliado: true,
      });
    }
    return brutos;
  },
};
