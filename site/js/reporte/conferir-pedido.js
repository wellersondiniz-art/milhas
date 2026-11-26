// Conferência do "Pedir esse cartão" na tela e corpo do POST. Funções puras.
// Só ajudam quem digita: o servidor (servidor/reportar/regras.js,
// validarPedidoDeCartao) confere tudo de novo e é quem decide.

/** Os mesmos limites do servidor (LIMITES_DO_PEDIDO em servidor/reportar/regras.js; um teste confere). */
export const LIMITES_DO_PEDIDO_NA_TELA = Object.freeze({
  nomeMin: 2, nomeMax: 80, bancoMin: 2, bancoMax: 60, digitosMax: 5, linkMax: 500,
});

function umaLinha(texto) {
  return String(texto ?? '').replace(/\s+/g, ' ').trim();
}

/** Erros de quem digita, antes de enviar. Função pura (testada sem navegador). */
export function conferirPedidoNaTela({ nome_do_cartao: nome = '', banco = '', link_da_fonte: link = '' }) {
  const L = LIMITES_DO_PEDIDO_NA_TELA;
  const erros = {};
  const digitos = (t) => (t.match(/\d/g) ?? []).length;
  const n = umaLinha(nome);
  if (n.length < L.nomeMin || n.length > L.nomeMax) erros.nome_do_cartao = `Escreva o nome do cartão (de ${L.nomeMin} a ${L.nomeMax} letras).`;
  else if (digitos(n) > L.digitosMax) erros.nome_do_cartao = 'Escreva só o nome do cartão. Nunca o número do cartão nem o CPF.';
  const b = umaLinha(banco);
  if (b.length < L.bancoMin || b.length > L.bancoMax) erros.banco = `Escreva o nome do banco (de ${L.bancoMin} a ${L.bancoMax} letras).`;
  else if (digitos(b) > L.digitosMax) erros.banco = 'Escreva só o nome do banco.';
  const l = String(link ?? '').trim();
  if (l && (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(l) || l.length > L.linkMax)) {
    erros.link_da_fonte = 'Cole o link completo da página do banco, começando com https://, ou deixe em branco.';
  }
  return erros;
}

/** Corpo do POST. Função pura. */
export function corpoDoPedidoDeCartao(valores, { isca = '', tempoMs = 0 } = {}) {
  return {
    tipo: 'pedido_de_cartao',
    nome_do_cartao: umaLinha(valores.nome_do_cartao),
    banco: umaLinha(valores.banco),
    programa_id: valores.programa_id || null,
    link_da_fonte: String(valores.link_da_fonte ?? '').trim(),
    site: isca,
    tempo_no_formulario_ms: Math.max(0, Math.round(tempoMs)),
  };
}

