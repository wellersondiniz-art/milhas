// Adaptadores por API oficial. Cada um recebe os itens escolhidos em
// dados/produtos.json e devolve, por código do produto, o que a API disse:
//   { nome, preco (reais, texto ou número), moeda, link, disponivel,
//     vendido_pela_loja (true/false/null), afiliado, a_partir_de? }
// Quem confere e transforma em registro da vitrine é normalizarProduto().
import { amazon } from './amazon.js';
import { awin } from './awin.js';
import { mercadoLivre } from './mercado-livre.js';
import { shopee } from './shopee.js';

export const ADAPTADORES = Object.fromEntries([amazon, mercadoLivre, shopee, awin].map((a) => [a.id, a]));
