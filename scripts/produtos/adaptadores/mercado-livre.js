// Mercado Livre: API de itens (DevCenter), /items/bulk.
//
// Documentação: https://developers.mercadolivre.com.br/pt-br/itens-e-buscas
// - Toda chamada leva o token de acesso (Authorization: Bearer).
// - O token dura 6 horas; o refresh_token só pode ser usado uma vez e volta
//   um novo a cada renovação. Como o build da Cloudflare não guarda nada de
//   uma vez para outra, este adaptador usa só ML_ACCESS_TOKEN. Renovar sozinho
//   precisa de um lugar para guardar o refresh_token novo (pendente).
// - O Mercado Livre é marketplace: quem vende é sempre um vendedor parceiro,
//   a não ser que dados/produtos.json diga outra coisa.

import { pedirJson } from './comum.js';

export const URL_ITENS = 'https://api.mercadolibre.com/items/bulk';
const CAMPOS = ['id', 'title', 'price', 'currency_id', 'permalink', 'status'].map((c) => `body.${c}`).join(',');

export const mercadoLivre = {
  id: 'mercado-livre',
  variaveis: ['ML_ACCESS_TOKEN'],

  async buscar({ itens, env, buscar }) {
    const url = `${URL_ITENS}?ids=${itens.map((i) => encodeURIComponent(i.id_na_loja)).join(',')}&attributes=${CAMPOS}`;
    const resposta = await pedirJson(buscar, url, {
      headers: { Authorization: `Bearer ${env.ML_ACCESS_TOKEN}` },
    }, { rotulo: 'Mercado Livre (items/bulk)', segredos: [env.ML_ACCESS_TOKEN] });

    const brutos = new Map();
    for (const linha of Array.isArray(resposta) ? resposta : []) {
      const corpo = linha?.body;
      if (linha?.status_code !== 200 || !corpo?.id) continue;
      brutos.set(corpo.id, {
        nome: corpo.title,
        preco: corpo.price,
        moeda: corpo.currency_id,
        link: corpo.permalink,
        disponivel: corpo.status === 'active',
        vendido_pela_loja: null,
        afiliado: false,
      });
    }
    return brutos;
  },
};
