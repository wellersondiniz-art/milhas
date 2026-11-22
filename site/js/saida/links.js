// Links de saída: o endereço que leva a pessoa do site para a loja.
//
// Regras (não mudar sem pedido do dono do projeto):
//   - O motor de cálculo NÃO conhece este arquivo nem comissão. A ordem do
//     resultado vem só dos pontos. Este módulo só monta o endereço do botão
//     "Ir para a loja", depois que a conta já foi feita.
//   - Só sai link para https:// no domínio da loja cadastrado em
//     dados/lojas.json (ou num subdomínio dele, como www.). É a lista de
//     permissão. Endereço com usuário, senha ou porta é recusado.
//   - Não existe redirecionador: o destino vem só de dados/links.json,
//     nunca do endereço da página, de formulário ou do perfil.
//   - Link com código de afiliado ganha rel="sponsored noopener noreferrer" e
//     o aviso de comissão, visível ao lado. Link sem código é link comum:
//     sem aviso, porque aí o site não ganha nada.
//
// Funções puras: mesma entrada, mesma saída, sem DOM e sem rede.

export const A_CONFIRMAR = 'A_CONFIRMAR';

export const AVISO_COMISSAO = 'Podemos ganhar uma comissão se você comprar por aqui, sem custo extra para você.';
export const REL_AFILIADO = 'sponsored noopener noreferrer';
export const REL_COMUM = 'noopener noreferrer';

/** Nome e valor do parâmetro: letras, números, ponto, hífen e sublinhado. */
const PEDACO_SEGURO = /^[A-Za-z0-9._-]{1,100}$/;
const DOMINIO = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** true se o host é o domínio da loja ou um subdomínio dele. */
export function hostPermitido(host, dominio) {
  if (typeof host !== 'string' || typeof dominio !== 'string' || !DOMINIO.test(dominio)) return false;
  const h = host.toLowerCase();
  return h === dominio || h.endsWith(`.${dominio}`);
}

/**
 * Confere o url_base de um link contra o domínio da loja.
 * Devolve o URL pronto, ou null com o motivo em `motivo`.
 */
export function conferirDestino(urlBase, dominio) {
  if (typeof urlBase !== 'string') return { url: null, motivo: 'url_base não é texto' };
  let url;
  try { url = new URL(urlBase); } catch { return { url: null, motivo: 'url_base não é um endereço válido' }; }
  if (url.protocol !== 'https:') return { url: null, motivo: 'url_base precisa começar com https://' };
  if (url.username || url.password) return { url: null, motivo: 'url_base não pode ter usuário ou senha' };
  if (url.port) return { url: null, motivo: 'url_base não pode ter porta' };
  if (!hostPermitido(url.hostname, dominio)) {
    return { url: null, motivo: `url_base fora do domínio da loja (${dominio === A_CONFIRMAR ? 'domínio A_CONFIRMAR' : dominio})` };
  }
  return { url, motivo: null };
}

/** O parâmetro de afiliado está preenchido de verdade (não falta, não é A_CONFIRMAR)? */
export function temParametroDeAfiliado(link) {
  const p = link?.parametro_afiliado;
  return Boolean(p && typeof p === 'object'
    && PEDACO_SEGURO.test(p.nome ?? '') && PEDACO_SEGURO.test(p.valor ?? '')
    && p.nome !== A_CONFIRMAR && p.valor !== A_CONFIRMAR);
}

/**
 * Monta o link de saída para a loja.
 * @param {string} lojaId
 * @param {{ lojas: object[], links?: object[] }} dados
 * @returns {{ url: string, afiliado: boolean, rel: string, aviso: string|null } | null}
 *   null quando não há link cadastrado ou o destino não passa na lista de permissão.
 */
export function montarLinkDeSaida(lojaId, dados) {
  const loja = (dados?.lojas ?? []).find((l) => l.id === lojaId);
  const link = (dados?.links ?? []).find((l) => l.loja_id === lojaId);
  if (!loja || !link) return null;
  const { url } = conferirDestino(link.url_base, loja.dominio);
  if (!url) return null;
  const afiliado = temParametroDeAfiliado(link);
  if (afiliado) url.searchParams.set(link.parametro_afiliado.nome, link.parametro_afiliado.valor);
  return {
    url: url.href,
    afiliado,
    rel: afiliado ? REL_AFILIADO : REL_COMUM,
    aviso: afiliado ? AVISO_COMISSAO : null,
  };
}

/** Algum link do site é de afiliado hoje? (Os textos de Privacidade e Termos dependem disto.) */
export function siteTemLinkDeAfiliado(dados) {
  return (dados?.links ?? []).some((link) => montarLinkDeSaida(link.loja_id, dados)?.afiliado === true);
}
