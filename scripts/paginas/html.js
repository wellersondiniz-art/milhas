// Montagem de HTML em texto, com escape em tudo por padrão.
//
// h('p', { class: 'x' }, 'texto', outroH) devolve um pedaço de HTML pronto.
// Texto e atributos SEMPRE passam por escaparHtml. Só o que já saiu de h()
// (ou de confiavel()) entra sem escape. Assim, nada que vem dos dados vira
// tag ou atributo por engano (CLAUDE.md, seção 6).

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Troca & < > " ' pelas entidades. Serve para texto e para valor de atributo. */
export function escaparHtml(valor) {
  return String(valor).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Pedaço de HTML já pronto (não é escapado de novo). */
class Html {
  constructor(texto) { this.texto = texto; }
  toString() { return this.texto; }
}

/** Marca um texto FIXO do código como HTML confiável. Nunca use com dado. */
export function confiavel(texto) {
  return new Html(texto);
}

const VAZIOS = new Set(['meta', 'link', 'br', 'hr', 'img', 'input']);
const NOME = /^[a-z][a-z0-9-]*$/;

function filhosParaTexto(filhos) {
  let saida = '';
  for (const filho of filhos.flat(Infinity)) {
    if (filho === null || filho === undefined || filho === false) continue;
    // "R$" nunca fica sozinho no fim da linha (igual ao el() da tela).
    saida += filho instanceof Html ? filho.texto : escaparHtml(String(filho).replace(/R\$ /g, 'R$ '));
  }
  return saida;
}

/** Junta pedaços sem tag em volta. */
export function juntar(...filhos) {
  return new Html(filhosParaTexto(filhos));
}

/**
 * Elemento HTML. Atributo null/undefined/false some; true vira atributo vazio.
 * Nome de tag e de atributo precisam ser fixos do código (letras minúsculas).
 */
export function h(tag, atributos = {}, ...filhos) {
  if (!NOME.test(tag)) throw new Error(`tag inválida: ${tag}`);
  let attrs = '';
  for (const [nome, valor] of Object.entries(atributos ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (!NOME.test(nome)) throw new Error(`atributo inválido: ${nome}`);
    attrs += valor === true ? ` ${nome}` : ` ${nome}="${escaparHtml(valor)}"`;
  }
  if (VAZIOS.has(tag)) return new Html(`<${tag}${attrs}>`);
  return new Html(`<${tag}${attrs}>${filhosParaTexto(filhos)}</${tag}>`);
}

/**
 * Link só para endereço https://. Qualquer outro esquema (http:, javascript:,
 * data:...) vira texto sem link. O schema dos dados já exige https://; esta é
 * a segunda trava, para o caso de um dado escapar da validação.
 * Esses links ficam soltos (fora de frase), então ganham alvo de toque de 44px.
 */
export function linkExterno(url, ...filhos) {
  if (typeof url !== 'string' || !/^https:\/\/[^\s]+$/i.test(url)) return juntar(...filhos);
  return h('a', { href: url, rel: 'noopener noreferrer nofollow', class: 'alvo-toque' }, ...filhos);
}

/**
 * Bloco <script type="application/ld+json">. O JSON é escapado para não
 * fechar a tag (</script>) nem abrir comentário, mesmo com dado malicioso.
 */
export function jsonLd(objeto) {
  const texto = JSON.stringify(objeto)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  return new Html(`<script type="application/ld+json">${texto}</script>`);
}

/** Texto para XML (sitemap): mesmo escape do HTML. */
export const escaparXml = escaparHtml;
