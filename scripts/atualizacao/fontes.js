// Confere dados/fontes.json: formato (schema) e a regra "só página oficial".
// Função pura: recebe as fontes e o cadastro, devolve a lista de erros.

import { validarSchema } from '../validar-dados.js';

// Sites de notícia e blogs de milhas. Mesmo que alguém cadastre um deles,
// a fonte é recusada: o fluxo só lê páginas oficiais.
export const BLOGS_RECUSADOS = [
  'passageirodeprimeira.com', 'melhoresdestinos.com.br', 'pontospravoar.com',
  'mestredasmilhas.com', 'aeroin.net', 'mundodasmilhas.com', 'falandodeviagem.com.br',
  'blog.maxmilhas.com.br', 'estevampelomundo.com.br', 'viajenaviagem.com',
];

/** Domínio sem "www." (minúsculas). */
export function dominioDe(url) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

/** true se o host é o domínio ou um subdomínio dele. */
export function pertenceAoDominio(host, dominio) {
  const h = host.toLowerCase().replace(/^www\./, '');
  const d = dominio.toLowerCase().replace(/^www\./, '');
  return h === d || h.endsWith(`.${d}`);
}

/** Domínios oficiais aceitos para uma fonte: o do programa e o da loja. */
export function dominiosOficiais(fonte, dados) {
  const programa = dados.programas.find((p) => p.id === fonte.programa_id);
  const loja = dados.lojas.find((l) => l.id === fonte.loja_id);
  const dominios = [];
  if (programa?.url) dominios.push(dominioDe(programa.url));
  if (loja?.dominio) dominios.push(loja.dominio.toLowerCase().replace(/^www\./, ''));
  return dominios;
}

/**
 * Valida as fontes. Devolve uma lista de mensagens em português (vazia = ok).
 * dados = { programas, lojas } do cadastro.
 */
export function validarFontes(fontes, schema, dados) {
  const erros = validarSchema(fontes, schema).map(({ caminho, mensagem }) =>
    `fontes.json${caminho.length ? ` › ${caminho.join('.')}` : ''}: ${mensagem}`);
  if (erros.length > 0 || !Array.isArray(fontes)) return erros;

  const ids = new Set();
  fontes.forEach((f, i) => {
    const onde = `fontes.json › registro ${i} (id "${f.id}")`;
    if (ids.has(f.id)) erros.push(`${onde}: id repetido`);
    ids.add(f.id);
    if (!dados.programas.some((p) => p.id === f.programa_id)) erros.push(`${onde}: programa_id "${f.programa_id}" não existe em programas.json`);
    if (!dados.lojas.some((l) => l.id === f.loja_id)) erros.push(`${onde}: loja_id "${f.loja_id}" não existe em lojas.json`);

    const host = new URL(f.url).hostname;
    if (BLOGS_RECUSADOS.some((b) => pertenceAoDominio(host, b))) {
      erros.push(`${onde}: ${host} é blog ou site de notícia; use a página oficial do programa ou da loja`);
      return;
    }
    const oficiais = dominiosOficiais(f, dados);
    if (oficiais.length > 0 && !oficiais.some((d) => pertenceAoDominio(host, d))) {
      erros.push(`${onde}: ${host} não é domínio oficial do programa nem da loja (aceitos: ${oficiais.join(', ')})`);
    }
  });
  return erros;
}
