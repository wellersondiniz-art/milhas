// De onde o app tira a lista de lojas e ofertas.
//
// As ofertas mudam toda semana, mas o app só muda quando sai versão nova na
// loja. Então o app tenta primeiro os arquivos públicos do site
// (ENDERECO_DO_SITE/dados/*.json) e, sem internet ou se o site demorar,
// usa a cópia que veio dentro do app. Não vai nada do perfil nesse pedido:
// é um GET simples de um arquivo público, sem cookie.

/**
 * @param {string} nome         ex.: "lojas"
 * @param {object} opcoes
 * @param {Function} opcoes.buscar   normalmente fetch
 * @param {string}   opcoes.endereco ENDERECO_DO_SITE
 * @param {number}   opcoes.espera   milissegundos até desistir do site
 * @returns {Promise<{ resposta: Response, doSite: boolean }>}
 */
export async function buscarDadosDoApp(nome, { buscar, endereco, espera }) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), espera);
  try {
    const resposta = await buscar(`${endereco}/dados/${nome}.json`, {
      cache: 'no-cache', credentials: 'omit', signal: controle.signal,
    });
    if (resposta.ok) return { resposta, doSite: true };
  } catch {
    // sem internet, site fora do ar ou demorou demais: usa a cópia do app
  } finally {
    clearTimeout(relogio);
  }
  return { resposta: await buscar(`dados/${nome}.json`, { cache: 'no-cache' }), doSite: false };
}
