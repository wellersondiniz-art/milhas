// Texto do selo a partir da lista de jeitos de comprar (saída do motor).
// Função pura: roda no service worker e no Node (testes).

/**
 * @param {object[]} jeitos     saída de calcularJeitosDeComprar, do melhor ao pior
 * @param {object} contexto     { semPerfil: boolean }
 * @returns {{ titulo: string, detalhe: string } | null}  null = não mostrar selo
 */
export function textoDoSelo(jeitos, { semPerfil = false } = {}) {
  const melhor = Array.isArray(jeitos) ? jeitos[0] : null;
  if (!melhor || !(melhor.total_pontos > 0) || typeof melhor.total_pontos_texto !== 'string') return null;

  const pontos = `${melhor.total_pontos_texto} ${melhor.total_pontos === 1 ? 'ponto' : 'pontos'}`;
  const titulo = melhor.cartao
    ? `Melhor jeito: ${pontos} com ${melhor.cartao.nome}`
    : `Melhor jeito: ${pontos}`;

  const partes = [];
  if (melhor.programa) {
    partes.push(melhor.tipo === 'oferta' ? `com a oferta ${melhor.programa.nome}` : `no ${melhor.programa.nome}`);
  }
  if (melhor.valor_estimado_em_reais) partes.push(`vale cerca de ${melhor.valor_estimado_em_reais.texto}`);
  if (semPerfil) partes.push('contando todos os cartões; escolha os seus nas opções da extensão');
  else if (melhor.tem_dado_antigo) partes.push('dado conferido há mais de 14 dias');

  return { titulo, detalhe: partes.join(' · ') };
}
