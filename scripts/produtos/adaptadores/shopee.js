// Shopee: Open API do Programa de Afiliados Shopee Brasil (GraphQL).
//
// Painel: https://affiliate.shopee.com.br/open_api (só abre com login de afiliado aprovado).
// - Uma consulta productOfferV2 por item (filtro itemId).
// - Assinatura: SHA-256 de AppId + Timestamp + corpo + Segredo, no cabeçalho
//   "Authorization: SHA256 Credential=..., Timestamp=..., Signature=...".
//   ATENÇÃO: este formato veio de fontes de terceiros, porque a documentação
//   oficial pede login. Conferir no painel antes de ligar (o guia explica).
// - O link (offerLink) já é o link de afiliado, no domínio s.shopee.com.br.
// - Produto com variações tem preço mínimo e máximo: mostramos "a partir de".

import { createHash } from 'node:crypto';
import { pedirJson } from './comum.js';

export const URL_GRAPHQL = 'https://open-api.affiliate.shopee.com.br/graphql';
const CAMPOS = 'itemId productName price priceMin priceMax offerLink productLink';

export function assinar({ appId, segredo, timestamp, corpo }) {
  const assinatura = createHash('sha256').update(`${appId}${timestamp}${corpo}${segredo}`).digest('hex');
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${assinatura}`;
}

export const shopee = {
  id: 'shopee',
  variaveis: ['SHOPEE_APP_ID', 'SHOPEE_SEGREDO'],

  async buscar({ itens, env, buscar, agora }) {
    const brutos = new Map();
    for (const item of itens) {
      if (!/^\d+$/.test(item.id_na_loja)) continue; // itemId da Shopee é só número
      const corpo = JSON.stringify({ query: `{ productOfferV2(itemId: ${item.id_na_loja}, limit: 1) { nodes { ${CAMPOS} } } }` });
      const timestamp = Math.floor(Date.parse(agora) / 1000);
      const resposta = await pedirJson(buscar, URL_GRAPHQL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: assinar({ appId: env.SHOPEE_APP_ID, segredo: env.SHOPEE_SEGREDO, timestamp, corpo }),
        },
        body: corpo,
      }, { rotulo: `Shopee (item ${item.id_na_loja})`, segredos: [env.SHOPEE_SEGREDO] });
      const no = resposta?.data?.productOfferV2?.nodes?.[0];
      if (!no || String(no.itemId) !== item.id_na_loja) continue;
      const variaPreco = no.priceMin !== undefined && no.priceMax !== undefined && String(no.priceMin) !== String(no.priceMax);
      brutos.set(item.id_na_loja, {
        nome: no.productName,
        preco: variaPreco ? no.priceMin : (no.price ?? no.priceMin),
        moeda: 'BRL', // a API do Brasil só tem preço em real
        link: no.offerLink ?? no.productLink,
        disponivel: true,
        vendido_pela_loja: null,
        afiliado: Boolean(no.offerLink),
        a_partir_de: variaPreco,
      });
    }
    return brutos;
  },
};
