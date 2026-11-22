// Busca de loja pelo nome. Função pura: ignora maiúsculas e acentos.

export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lojas cujo nome (ou endereço do site) contém o termo.
 * Quem começa com o termo vem primeiro; depois, ordem alfabética.
 * Termo vazio → todas, em ordem alfabética.
 */
export function filtrarLojas(lojas, termo, limite = 8) {
  const t = normalizar(termo);
  const comNome = lojas.map((loja) => ({ loja, nome: normalizar(loja.nome), dominio: normalizar(loja.dominio) }));
  const achadas = t
    ? comNome.filter((l) => l.nome.includes(t) || (l.dominio !== 'a_confirmar' && l.dominio.includes(t)))
    : comNome;
  return achadas
    .sort((a, b) => Number(b.nome.startsWith(t)) - Number(a.nome.startsWith(t)) || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, limite)
    .map((l) => l.loja);
}

/** A loja cujo nome é exatamente o termo (sem ligar para acento e maiúscula), ou null. */
export function lojaPeloNome(lojas, termo) {
  const t = normalizar(termo);
  return lojas.find((l) => normalizar(l.nome) === t) ?? null;
}
