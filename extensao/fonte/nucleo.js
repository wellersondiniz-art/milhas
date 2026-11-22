// Núcleo do service worker: tudo o que não depende das APIs do Chrome.
// Recebe o endereço (só o nome do host), o texto do preço e o perfil, e
// devolve o texto do selo. Nada aqui acessa rede, DOM ou relógio.
//
// O motor (motor/) e o formato do perfil (perfil/formato.js) são os mesmos
// arquivos do site: o build (scripts/extensao/montar.js) copia de site/js/
// para o pacote, sem nenhuma alteração.

import { calcularJeitosDeComprar } from './motor/index.js';
import { ehVazio, limparPerfil, perfilDeTodos, perfilParaConta } from './perfil/formato.js';
import { lerPreco } from './preco.js';
import { textoDoSelo } from './selo-texto.js';

/** A loja (do arquivo de seletores) que atende este host, ou null. Comparação exata. */
export function lojaDoHost(host, seletores) {
  if (typeof host !== 'string') return null;
  return seletores.find((s) => s.hosts.includes(host.toLowerCase())) ?? null;
}

/** O que a página de conteúdo precisa saber para achar o preço. */
export function configuracaoPara(host, seletores) {
  const loja = lojaDoHost(host, seletores);
  if (!loja) return null;
  return { caminho_produto: loja.caminho_produto, seletores: loja.seletores_preco.map(({ css, atributo }) => ({ css, atributo: atributo ?? null })) };
}

/**
 * @param {object} pedido        { texto, indice } vindos da página (não confiáveis)
 * @param {string} host          host da aba que mandou (vem do Chrome, não da página)
 * @param {unknown} perfilBruto  o que estava em chrome.storage.local
 * @param {object} dados         { programas, cartoes, lojas, ofertas, cambio }
 * @param {object[]} seletores   lojas ativas do arquivo de seletores
 * @param {string} hoje          "AAAA-MM-DDTHH:MM" em São Paulo
 * @returns {{ titulo: string, detalhe: string } | null}
 */
export function calcularSelo(pedido, host, perfilBruto, dados, seletores, hoje) {
  const loja = lojaDoHost(host, seletores);
  if (!loja || !pedido || typeof pedido !== 'object') return null;
  const regra = Number.isSafeInteger(pedido.indice) ? loja.seletores_preco[pedido.indice] : undefined;
  if (!regra) return null;
  const centavos = lerPreco(pedido.texto, regra.formato ?? 'texto');
  if (centavos === null) return null;

  const perfil = limparPerfil(perfilBruto, dados);
  const semPerfil = ehVazio(perfil);
  const paraConta = semPerfil ? perfilDeTodos(dados, perfil?.cotacao_dolar) : perfilParaConta(perfil);
  const jeitos = calcularJeitosDeComprar(
    paraConta,
    // A extensão não sabe quem vende o produto: conta como vendido pela loja, igual ao site.
    { loja_id: loja.loja_id, valor_centavos: centavos, tipo_vendedor: 'loja' },
    dados,
    hoje,
  );
  return textoDoSelo(jeitos, { semPerfil });
}
