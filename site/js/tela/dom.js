// Criação de elementos sem HTML em texto (CLAUDE.md, seção 6).
// Texto sempre entra como nó de texto, nunca como HTML.

/**
 * el('p', { class: 'x', id: 'y' }, 'texto', outroElemento)
 * Atributos com valor null/false são ignorados; true vira atributo vazio.
 */
export function el(tag, atributos = {}, ...filhos) {
  const no = document.createElement(tag);
  for (const [nome, valor] of Object.entries(atributos ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    no.setAttribute(nome, valor === true ? '' : String(valor));
  }
  for (const filho of filhos.flat()) {
    if (filho === null || filho === undefined || filho === false) continue;
    // "R$" nunca fica sozinho no fim da linha: espaço sem quebra antes do número.
    no.append(filho instanceof Node ? filho : document.createTextNode(String(filho).replace(/R\$ /g, 'R$\u00a0')));
  }
  return no;
}
