// Regras do "Essa informação está errada?": validação do reporte e texto da
// issue no GitHub. Funções puras: nada de rede, de relógio ou de ambiente.
//
// Quem chama (servidor/reportar/pedido.js) passa os dados do site
// (lojas, ofertas, programas e cartões) e a data de hoje em São Paulo.
//
// O que guardamos é o mínimo para corrigir a informação:
//   - a loja, a oferta, o programa e o cartão do resultado (ids dos nossos dados);
//   - o que está errado (texto da pessoa) e o link da prova;
//   - o e-mail, só se a pessoa quiser resposta. Ele NÃO vai no corpo da issue:
//     vira um comentário separado, apagado quando o reporte é fechado ou em
//     até 90 dias (ver servidor/reportar/repo-de-reportes/limpar-emails.yml).
// O IP nunca vai para a issue.

export const A_CONFIRMAR = 'A_CONFIRMAR';

export const LIMITES = Object.freeze({
  /** Tamanho máximo do pedido inteiro, em bytes. */
  corpoBytes: 8 * 1024,
  textoMin: 10,
  textoMax: 1000,
  linkMax: 500,
  emailMax: 254,
  /** Menos que isso entre abrir o formulário e enviar: é robô. */
  tempoMinimoMs: 3000,
});

export const ETIQUETAS = Object.freeze({
  reporte: 'reporte',
  ofertaAtiva: 'prioridade: oferta ativa',
  pedidoDeCartao: 'pedido de cartão',
});

/** "Pedir esse cartão": nome do cartão e do banco, curtos e numa linha só. */
export const LIMITES_DO_PEDIDO = Object.freeze({
  nomeMin: 2,
  nomeMax: 80,
  bancoMin: 2,
  bancoMax: 60,
  /** Nome de cartão não tem tanto número; número de cartão ou CPF tem. */
  digitosMax: 5,
});

/** Marca o comentário com e-mail, para o robô de limpeza achar. */
export const MARCA_EMAIL = '<!-- reporte:email -->';

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// Controles (menos \n e \t), marcas de direção do texto e caracteres invisíveis.
// eslint-disable-next-line no-control-regex
const INVISIVEIS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g;

/** Data "AAAA-MM-DD" no horário de São Paulo (a mesma régua das ofertas). */
export function dataEmSaoPaulo(instante) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instante);
  const v = (t) => partes.find((p) => p.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/**
 * A oferta vale hoje? Mesma regra da calculadora: status conhecido, já
 * começou (ou início a confirmar) e ainda não acabou (ou fim a confirmar).
 */
export function ofertaAtiva(oferta, hoje) {
  if (!oferta || oferta.status === A_CONFIRMAR) return false;
  if (typeof oferta.inicio === 'string' && oferta.inicio !== A_CONFIRMAR && oferta.inicio > hoje) return false;
  if (typeof oferta.fim === 'string' && oferta.fim !== A_CONFIRMAR && oferta.fim < hoje) return false;
  return true;
}

/** Texto livre: sem invisíveis, quebras de linha normalizadas, sem espaço sobrando. */
export function limparTexto(valor) {
  return String(valor)
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIVEIS, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Link da prova: https, com nome de domínio de verdade (não IP, não
 * localhost), sem usuário/senha e sem porta. Devolve a URL normalizada ou null.
 */
export function validarLink(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  if (!texto || texto.length > LIMITES.linkMax || /\s/.test(texto)) return null;
  let url;
  try { url = new URL(texto); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.') || host === 'localhost' || host.endsWith('.localhost')) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null; // nomes com acento chegam em punycode (xn--)
  return url.href;
}

export function validarEmail(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  if (texto.length > LIMITES.emailMax || !EMAIL.test(texto)) return null;
  return texto;
}

function idOpcional(valor) {
  if (valor === undefined || valor === null || valor === '') return { ok: true, id: null };
  return typeof valor === 'string' && ID.test(valor) ? { ok: true, id: valor } : { ok: false };
}

/**
 * Confere o que chegou do formulário contra os dados do site.
 *
 * @param {unknown} entrada  o JSON enviado pela página
 * @param {object} dados     { lojas, ofertas, programas, cartoes } (listas)
 * @returns {{ ok: true, reporte: object } | { ok: false, erros: Record<string,string> }}
 */
export function validarReporte(entrada, dados) {
  const erros = {};
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { ok: false, erros: { geral: 'O formulário chegou vazio. Tente de novo.' } };
  }
  const porId = (lista, id) => (Array.isArray(lista) ? lista.find((x) => x && x.id === id) : undefined);

  const loja = typeof entrada.loja_id === 'string' ? porId(dados.lojas, entrada.loja_id) : undefined;
  if (!loja) erros.loja_id = 'Não achamos essa loja. Recarregue a página e tente de novo.';

  const oferta = idOpcional(entrada.oferta_id);
  const programa = idOpcional(entrada.programa_id);
  const cartao = idOpcional(entrada.cartao_id);
  const registroOferta = oferta.id ? porId(dados.ofertas, oferta.id) : null;
  if (!oferta.ok || (oferta.id && (!registroOferta || (loja && registroOferta.loja_id !== loja.id)))) {
    erros.oferta_id = 'Essa oferta não está mais nos nossos dados. Recarregue a página.';
  }
  if (!programa.ok || (programa.id && !porId(dados.programas, programa.id))) {
    erros.programa_id = 'Esse programa não está nos nossos dados. Recarregue a página.';
  }
  if (!cartao.ok || (cartao.id && !porId(dados.cartoes, cartao.id))) {
    erros.cartao_id = 'Esse cartão não está nos nossos dados. Recarregue a página.';
  }

  const texto = typeof entrada.o_que_esta_errado === 'string' ? limparTexto(entrada.o_que_esta_errado) : '';
  if (texto.length < LIMITES.textoMin) {
    erros.o_que_esta_errado = `Conte o que está errado (pelo menos ${LIMITES.textoMin} letras).`;
  } else if (texto.length > LIMITES.textoMax) {
    erros.o_que_esta_errado = `Use no máximo ${LIMITES.textoMax} letras.`;
  }

  const link = validarLink(entrada.link_da_prova);
  if (!link) erros.link_da_prova = 'Cole o link completo da página que mostra a informação certa, começando com https://.';

  let email = null;
  if (typeof entrada.email === 'string' && entrada.email.trim() !== '') {
    email = validarEmail(entrada.email);
    if (!email) erros.email = 'Esse e-mail não parece certo. Confira ou deixe em branco.';
  } else if (entrada.email !== undefined && entrada.email !== null && typeof entrada.email !== 'string') {
    erros.email = 'Esse e-mail não parece certo. Confira ou deixe em branco.';
  }

  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    reporte: {
      loja: { id: loja.id, nome: loja.nome },
      oferta: registroOferta ?? null,
      programa: programa.id ? porId(dados.programas, programa.id) : null,
      cartao: cartao.id ? porId(dados.cartoes, cartao.id) : null,
      texto,
      link,
      email,
    },
  };
}

/**
 * Bloco de código do Markdown que aguenta qualquer texto: a cerca tem mais
 * crases que a maior sequência dentro do texto. Dentro dele o GitHub não
 * monta link, imagem nem menção (@alguém), e HTML aparece como texto.
 */
export function blocoDeCodigo(texto) {
  const maior = Math.max(0, ...[...String(texto).matchAll(/`+/g)].map((m) => m[0].length));
  const cerca = '`'.repeat(Math.max(3, maior + 1));
  return `${cerca}text\n${texto}\n${cerca}`;
}

/** Nome dos nossos dados no Markdown: sem caractere que o GitHub interprete. */
function nomeSeguro(texto) {
  return String(texto).replace(/[^\p{L}\p{N} .,()'+/-]/gu, '').slice(0, 120);
}

/**
 * Título, corpo e etiquetas da issue. Nada do texto da pessoa entra no
 * título nem fora de um bloco de código.
 *
 * @param {object} reporte  saída de validarReporte
 * @param {string} hoje     "AAAA-MM-DD" em São Paulo
 */
export function montarIssue(reporte, hoje) {
  const ativa = ofertaAtiva(reporte.oferta, hoje);
  const sobre = reporte.oferta ? (ativa ? 'oferta ativa' : 'oferta fora do prazo') : 'compra sem oferta';
  const linhas = [
    '## Reporte de erro',
    '',
    `- **Loja:** ${nomeSeguro(reporte.loja.nome)} (\`${reporte.loja.id}\`)`,
    `- **Oferta:** ${reporte.oferta ? `\`${reporte.oferta.id}\` (${ativa ? 'ativa hoje' : 'fora do prazo hoje'})` : 'nenhuma (resultado sem oferta)'}`,
    `- **Programa:** ${reporte.programa ? `${nomeSeguro(reporte.programa.nome)} (\`${reporte.programa.id}\`)` : 'não informado'}`,
    `- **Cartão:** ${reporte.cartao ? `${nomeSeguro(reporte.cartao.nome)} (\`${reporte.cartao.id}\`)` : 'não informado'}`,
    `- **Recebido em:** ${hoje} (horário de São Paulo)`,
    `- **Pediu resposta por e-mail:** ${reporte.email ? 'sim (e-mail num comentário à parte, apagado ao fechar ou em até 90 dias)' : 'não'}`,
    '',
    '### O que está errado (texto da pessoa, sem formatação)',
    '',
    blocoDeCodigo(reporte.texto),
    '',
    '### Link da prova (copie e confira antes de abrir)',
    '',
    blocoDeCodigo(reporte.link),
    '',
    '### Para triar',
    '',
    '- [ ] Abrir o link da prova e conferir na loja ou no programa',
    '- [ ] Corrigir em `dados/` (com `fonte_url` e `verificado_em`) ou fechar como "não procede"',
    reporte.email ? '- [ ] Responder, se fizer sentido, e fechar (o e-mail é apagado ao fechar)' : null,
  ].filter((l) => l !== null);
  return {
    title: `[${ativa ? 'Oferta ativa' : 'Reporte'}] ${nomeSeguro(reporte.loja.nome)}: ${sobre}`,
    body: linhas.join('\n'),
    labels: ativa ? [ETIQUETAS.reporte, ETIQUETAS.ofertaAtiva] : [ETIQUETAS.reporte],
  };
}

/** Comentário separado com o e-mail (só quando a pessoa deu um). */
export function comentarioDoEmail(email) {
  return [
    MARCA_EMAIL,
    'E-mail para resposta. Este comentário é apagado sozinho quando o reporte é fechado ou depois de 90 dias. Não copie o e-mail para outro lugar.',
    '',
    blocoDeCodigo(email),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// "Pedir esse cartão": quem tem um cartão que não está no cadastro pede para
// a gente incluir. Vai só o nome do cartão, o banco, o programa (se a pessoa
// souber) e o link da fonte (opcional). Sem e-mail e sem nada da pessoa.

/** Texto de uma linha: sem invisíveis e sem quebra de linha. */
function linhaUnica(valor) {
  return limparTexto(String(valor)).replace(/\s+/g, ' ');
}

function conferirNome(valor, min, max) {
  const t = typeof valor === 'string' ? linhaUnica(valor) : '';
  if (t.length < min || t.length > max) return { ok: false, texto: t };
  if ((t.match(/\d/g) ?? []).length > LIMITES_DO_PEDIDO.digitosMax) return { ok: false, texto: t, numero: true };
  return { ok: true, texto: t };
}

/**
 * @param {unknown} entrada  { tipo: "pedido_de_cartao", nome_do_cartao, banco, programa_id?, link_da_fonte? }
 * @param {object} dados     { programas } (lista)
 * @returns {{ ok: true, pedido: object } | { ok: false, erros: Record<string,string> }}
 */
export function validarPedidoDeCartao(entrada, dados) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { ok: false, erros: { geral: 'O formulário chegou vazio. Tente de novo.' } };
  }
  const erros = {};
  const L = LIMITES_DO_PEDIDO;
  const nome = conferirNome(entrada.nome_do_cartao, L.nomeMin, L.nomeMax);
  if (!nome.ok) {
    erros.nome_do_cartao = nome.numero
      ? 'Escreva só o nome do cartão. Nunca o número do cartão nem o CPF.'
      : `Escreva o nome do cartão (de ${L.nomeMin} a ${L.nomeMax} letras).`;
  }
  const banco = conferirNome(entrada.banco, L.bancoMin, L.bancoMax);
  if (!banco.ok) {
    erros.banco = banco.numero
      ? 'Escreva só o nome do banco.'
      : `Escreva o nome do banco (de ${L.bancoMin} a ${L.bancoMax} letras).`;
  }
  const programaId = idOpcional(entrada.programa_id);
  const programa = programaId.id && Array.isArray(dados.programas) ? dados.programas.find((p) => p && p.id === programaId.id) : null;
  if (!programaId.ok || (programaId.id && !programa)) {
    erros.programa_id = 'Esse programa não está nos nossos dados. Recarregue a página.';
  }
  let link = null;
  if (typeof entrada.link_da_fonte === 'string' && entrada.link_da_fonte.trim() !== '') {
    link = validarLink(entrada.link_da_fonte);
    if (!link) erros.link_da_fonte = 'Cole o link completo da página do banco, começando com https://, ou deixe em branco.';
  } else if (entrada.link_da_fonte !== undefined && entrada.link_da_fonte !== null && typeof entrada.link_da_fonte !== 'string') {
    erros.link_da_fonte = 'Cole o link completo da página do banco, começando com https://, ou deixe em branco.';
  }
  if (Object.keys(erros).length) return { ok: false, erros };
  return { ok: true, pedido: { nome: nome.texto, banco: banco.texto, programa: programa ?? null, link } };
}

/**
 * Issue do pedido de cartão. O que a pessoa digitou só entra em bloco de
 * código; o título usa só dados nossos.
 */
export function montarIssueDoPedido(pedido, hoje) {
  const linhas = [
    '## Pedido de cartão',
    '',
    `- **Programa:** ${pedido.programa ? `${nomeSeguro(pedido.programa.nome)} (\`${pedido.programa.id}\`)` : 'a pessoa não sabe ou não está na lista'}`,
    `- **Recebido em:** ${hoje} (horário de São Paulo)`,
    '',
    '### Nome do cartão (texto da pessoa)',
    '',
    blocoDeCodigo(pedido.nome),
    '',
    '### Banco (texto da pessoa)',
    '',
    blocoDeCodigo(pedido.banco),
    '',
    '### Link da fonte (copie e confira antes de abrir)',
    '',
    pedido.link ? blocoDeCodigo(pedido.link) : 'Não informado.',
    '',
    '### Para triar',
    '',
    '- [ ] Achar a página oficial do cartão no site do banco',
    '- [ ] Cadastrar em `dados/cartoes.json` (com `fonte_url` e `verificado_em`; o que não estiver lá fica `A_CONFIRMAR`) ou fechar como "não procede"',
  ];
  return {
    title: `[Pedido de cartão] ${pedido.programa ? nomeSeguro(pedido.programa.nome) : 'programa não informado'}`,
    body: linhas.join('\n'),
    labels: [ETIQUETAS.pedidoDeCartao],
  };
}
