// Conferência do formulário "Essa informação está errada?" na tela.
// Só ajuda quem digita: o servidor (servidor/reportar/regras.js) confere tudo
// de novo e é quem decide. Função pura, sem DOM.

/** Os mesmos limites do servidor (servidor/reportar/regras.js; um teste confere). */
export const LIMITES_DA_TELA = Object.freeze({ textoMin: 10, textoMax: 1000, linkMax: 500, emailMax: 254 });

/** Erros de quem digita, antes de enviar. Função pura (testada sem navegador). */
export function conferirNaTela({ o_que_esta_errado: texto = '', link_da_prova: link = '', email = '' }) {
  const erros = {};
  const t = texto.trim();
  if (t.length < LIMITES_DA_TELA.textoMin) erros.o_que_esta_errado = `Conte o que está errado (pelo menos ${LIMITES_DA_TELA.textoMin} letras).`;
  else if (t.length > LIMITES_DA_TELA.textoMax) erros.o_que_esta_errado = `Use no máximo ${LIMITES_DA_TELA.textoMax} letras.`;
  const l = link.trim();
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(l) || l.length > LIMITES_DA_TELA.linkMax) {
    erros.link_da_prova = 'Cole o link completo da página que mostra a informação certa, começando com https://.';
  }
  const e = email.trim();
  if (e && (e.length > LIMITES_DA_TELA.emailMax || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) {
    erros.email = 'Esse e-mail não parece certo. Confira ou deixe em branco.';
  }
  return erros;
}

