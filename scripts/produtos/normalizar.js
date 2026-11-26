// Peças puras da vitrine de produtos: dinheiro, texto, link e a conferência de
// cada produto que volta de uma API. Nada aqui lê disco, rede ou relógio.
//
// Regras do projeto (CLAUDE.md): dinheiro em centavos inteiros, nunca float;
// link só https no domínio da loja; nunca inventar dado (o que não veio fica de fora).

import { linkNoDominio } from '../validar-dados.js';

export const A_CONFIRMAR = 'A_CONFIRMAR';
/** Nenhuma loja passa disto: a regra da Amazon (24 horas) vale para todas. */
export const VALIDADE_MAXIMA_HORAS = 24;
/** Itens por loja: a Amazon aceita até 10 códigos por chamada. */
export const MAXIMO_DE_ITENS = 10;
/** Nome do produto: cortado para caber no cartão do celular. */
export const NOME_MAXIMO = 120;
/** Maior preço aceito (R$ 1 milhão). Acima disso, é erro da API. */
export const PRECO_MAXIMO_CENTAVOS = 100_000_000;

const HORA_MS = 3_600_000;

/**
 * Valor em reais vindo da API ("1299.9", 1299.9, "1.299,90"?) → centavos inteiros.
 * Só aceita ponto como separador decimal e no máximo 2 casas. Conta feita no
 * texto, sem multiplicar float (1299.9 × 100 não entra em lugar nenhum).
 * Devolve null para qualquer coisa fora disso.
 */
export function reaisParaCentavos(valor) {
  let texto;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 0) return null;
    texto = String(valor);
  } else if (typeof valor === 'string') {
    texto = valor.trim();
  } else {
    return null;
  }
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(texto);
  if (!m) return null;
  const centavos = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** Texto de uma linha: sem caracteres de controle, espaços juntados, cortado em `maximo`. */
export function textoLimpo(valor, maximo = NOME_MAXIMO) {
  if (typeof valor !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const limpo = valor.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpo) return null;
  return limpo.length > maximo ? `${limpo.slice(0, maximo - 1).trimEnd()}…` : limpo;
}

/** O link pode ir para o site? https, sem usuário/porta, no domínio da loja (ou subdomínio). */
export function linkDaLoja(link, loja) {
  if (!loja || typeof loja.dominio !== 'string' || loja.dominio === A_CONFIRMAR) return false;
  return linkNoDominio(link, [loja.dominio.toLowerCase()]);
}

/** Data e hora ISO (com fuso) + horas → ISO em UTC. */
export function somarHoras(iso, horas) {
  return new Date(Date.parse(iso) + horas * HORA_MS).toISOString();
}

/** O preço consultado em `consultadoEm` ainda vale em `agora`? */
export function aindaVale(produto, agora) {
  const ate = Date.parse(produto?.valido_ate);
  return Number.isFinite(ate) && Date.parse(agora) < ate;
}

/** Quem vende: o que está em produtos.json vence o que a API diz; sem nada, parceiro. */
function decidirVendedor(doCadastro, daApi) {
  if (doCadastro === true || doCadastro === false) return { vendido_pela_loja: doCadastro, vendedor_confirmado: true };
  if (daApi === true || daApi === false) return { vendido_pela_loja: daApi, vendedor_confirmado: true };
  return { vendido_pela_loja: false, vendedor_confirmado: false };
}

/**
 * Confere um produto que voltou de um adaptador e devolve o registro da vitrine,
 * ou { erro } dizendo por que ele ficou de fora.
 *
 * bruto: { id_na_loja, nome, preco (reais, texto ou número), moeda, link,
 *          disponivel, vendido_pela_loja (true/false/null), afiliado, a_partir_de }
 */
export function normalizarProduto(bruto, { loja, item, api, consultadoEm, validadeHoras, demo = false }) {
  const id = item.id_na_loja;
  const fora = (motivo) => ({ erro: `${loja.id} ${id}: ${motivo}` });
  if (!bruto) return fora('a API não devolveu este produto');
  if (bruto.disponivel === false) return fora('indisponível na loja');
  const nome = textoLimpo(bruto.nome);
  if (!nome) return fora('sem nome');
  if (bruto.moeda !== 'BRL') return fora(`moeda ${JSON.stringify(bruto.moeda)} (só aceitamos BRL)`);
  const preco = reaisParaCentavos(bruto.preco);
  if (preco === null || preco <= 0 || preco > PRECO_MAXIMO_CENTAVOS) return fora(`preço inválido: ${JSON.stringify(bruto.preco)}`);
  if (!linkDaLoja(bruto.link, loja)) return fora(`link fora do site da loja (${loja.dominio}): ${JSON.stringify(bruto.link)}`);
  const horas = Math.min(validadeHoras, VALIDADE_MAXIMA_HORAS);
  return {
    loja_id: loja.id,
    id_na_loja: id,
    nome,
    preco_centavos: preco,
    a_partir_de: bruto.a_partir_de === true,
    link: bruto.link,
    afiliado: bruto.afiliado === true,
    categoria: item.categoria === A_CONFIRMAR ? null : item.categoria,
    ...decidirVendedor(item.vendido_pela_loja, bruto.vendido_pela_loja),
    api,
    consultado_em: consultadoEm,
    valido_ate: somarHoras(consultadoEm, horas),
    demo: demo === true,
  };
}

/**
 * Regras de dados/produtos.json que o schema não cobre.
 * Devolve a lista de erros (texto).
 */
export function conferirConfig(config, dados, { hoje } = {}) {
  const erros = [];
  const lojas = new Map(dados.lojas.map((l) => [l.id, l]));
  const vistas = new Set();
  config.lojas.forEach((c, i) => {
    const onde = `produtos.json › lojas[${i}] (${c.loja_id})`;
    const loja = lojas.get(c.loja_id);
    if (!loja) erros.push(`${onde}: loja não existe em lojas.json`);
    else if (loja.dominio === A_CONFIRMAR) erros.push(`${onde}: a loja não tem domínio confirmado, então não dá para conferir os links`);
    if (vistas.has(c.loja_id)) erros.push(`${onde}: loja repetida`);
    vistas.add(c.loja_id);
    if (c.validade_horas > VALIDADE_MAXIMA_HORAS) erros.push(`${onde}: validade_horas passa de ${VALIDADE_MAXIMA_HORAS}`);
    if (c.itens.length > MAXIMO_DE_ITENS) erros.push(`${onde}: mais de ${MAXIMO_DE_ITENS} itens`);
    const ids = new Set();
    c.itens.forEach((item) => {
      if (ids.has(item.id_na_loja)) erros.push(`${onde}: item repetido ${item.id_na_loja}`);
      ids.add(item.id_na_loja);
    });
    if (c.api === 'awin' && (!c.awin_anunciante_id || !c.awin_feed_id)) erros.push(`${onde}: api awin precisa de awin_anunciante_id e awin_feed_id`);
    if (hoje && c.verificado_em > hoje) erros.push(`${onde}: verificado_em no futuro (${c.verificado_em})`);
  });
  return erros;
}
