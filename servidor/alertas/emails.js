// Textos dos e-mails (confirmação e alerta). Funções puras: recebem os
// links prontos e devolvem assunto, texto puro e HTML simples.
//
// Regras:
//   - cada e-mail vai para UMA pessoa (o envio nunca junta destinatários);
//   - todo e-mail tem o link de cancelar, no corpo e no cabeçalho
//     List-Unsubscribe (com cancelamento em um clique, RFC 8058);
//   - tudo o que vem de dado passa por escaparHtml no HTML.

import { formatarMinimo } from './regras.js';

export const NOME_DO_SITE = 'Milhas da Vez';

export function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cabecalhosDeCancelar(urlCancelar) {
  return {
    'List-Unsubscribe': `<${urlCancelar}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

const ESTILO = 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1d2a20;max-width:560px';

function html(paragrafos) {
  return `<!doctype html><html lang="pt-BR"><body><div style="${ESTILO}">${paragrafos.join('')}</div></body></html>`;
}
const p = (conteudo) => `<p>${conteudo}</p>`;
const a = (href, texto) => `<a href="${escaparHtml(href)}">${escaparHtml(texto)}</a>`;
const pequeno = (conteudo) => `<p style="font-size:13px;color:#4b5a50">${conteudo}</p>`;

/** Descreve o alerta em uma frase: "Magalu, 10 pontos por real ou mais (programa Azul Fidelidade)". */
export function descreverAlerta({ loja, programa, minimo_centesimos }) {
  const doPrograma = programa ? `, no programa ${programa}` : '';
  return `${loja}: ${formatarMinimo(minimo_centesimos)} pontos por real ou mais${doPrograma}`;
}

/**
 * @param {object} o
 * @param {string} o.urlConfirmar
 * @param {string} o.urlCancelar
 * @param {{loja: string, programa: string|null, minimo_centesimos: number}} o.alerta
 * @param {number} o.horas  validade do link
 */
export function emailDeConfirmacao({ urlConfirmar, urlCancelar, alerta, horas }) {
  const descricao = descreverAlerta(alerta);
  const assunto = `Confirme o seu alerta do ${NOME_DO_SITE}`;
  const texto = [
    'Olá!',
    `Alguém (esperamos que você) pediu para receber um alerta do ${NOME_DO_SITE}:`,
    descricao,
    `Para confirmar, abra este link em até ${horas} horas:`,
    urlConfirmar,
    'Se não foi você, é só ignorar este e-mail: sem a confirmação, não mandamos nada e apagamos o pedido.',
    `Para apagar o pedido agora: ${urlCancelar}`,
    '"Pontos por real" é quanto você ganha de pontos ou milhas para cada R$ 1 gasto na compra.',
  ].join('\n\n');
  const corpo = html([
    p('Olá!'),
    p(`Alguém (esperamos que você) pediu para receber um alerta do ${NOME_DO_SITE}:`),
    p(`<strong>${escaparHtml(descricao)}</strong>`),
    p(`${a(urlConfirmar, 'Confirmar o alerta')} (o link vale por ${horas} horas).`),
    p('Se não foi você, é só ignorar este e-mail: sem a confirmação, não mandamos nada e apagamos o pedido.'),
    pequeno(`"Pontos por real" é quanto você ganha de pontos ou milhas para cada R$ 1 gasto na compra. ${a(urlCancelar, 'Apagar este pedido agora')}.`),
  ]);
  return { assunto, texto, html: corpo, cabecalhos: cabecalhosDeCancelar(urlCancelar) };
}

/**
 * @param {object} o
 * @param {Array<{alerta: object, melhor: object, urlLoja: string}>} o.disparos
 * @param {string} o.urlCancelar
 */
export function emailDeAlerta({ disparos, urlCancelar }) {
  const lojas = [...new Set(disparos.map((d) => d.alerta.loja))];
  const assunto = lojas.length === 1
    ? `${lojas[0]} chegou no seu alvo de pontos`
    : `${lojas.length} lojas chegaram no seu alvo de pontos`;

  const blocosTexto = [];
  const blocosHtml = [];
  for (const { alerta, melhor, urlLoja } of disparos) {
    const como = [melhor.programa?.nome, melhor.cartao ? `cartão ${melhor.cartao.nome}` : null].filter(Boolean).join(' + ');
    const titulo = `${alerta.loja}: ${melhor.pontos_por_real_texto} pontos por real (seu alvo: ${formatarMinimo(alerta.minimo_centesimos)})`;
    const linhas = [
      como ? `Com ${como}.` : null,
      melhor.validade,
      ...melhor.condicoes.map((c) => `Condição: ${c}`),
      ...melhor.avisos.map((c) => `Atenção: ${c}`),
    ].filter(Boolean);
    blocosTexto.push([titulo, ...linhas, `Conferir no site: ${urlLoja}`].join('\n'));
    blocosHtml.push(
      `<h2 style="font-size:18px;margin:24px 0 8px">${escaparHtml(titulo)}</h2>`
      + `<ul>${linhas.map((l) => `<li>${escaparHtml(l)}</li>`).join('')}</ul>`
      + p(a(urlLoja, `Conferir ${alerta.loja} no site`)),
    );
  }

  const aviso = 'A conta é uma estimativa feita com o seu perfil e as regras publicadas pela loja e pelo programa. Confira na loja antes de comprar.';
  const porQue = 'Você recebe este e-mail porque confirmou um alerta no site. Mandamos no máximo 2 e-mails de alerta por semana.';
  const texto = [
    'Olá! Uma oferta chegou no alvo que você pediu:',
    ...blocosTexto,
    aviso,
    porQue,
    `Para não receber mais e apagar o seu e-mail: ${urlCancelar}`,
  ].join('\n\n');
  const corpo = html([
    p('Olá! Uma oferta chegou no alvo que você pediu:'),
    ...blocosHtml,
    p(escaparHtml(aviso)),
    pequeno(`${escaparHtml(porQue)} ${a(urlCancelar, 'Cancelar os alertas e apagar o meu e-mail')}.`),
  ]);
  return { assunto, texto, html: corpo, cabecalhos: cabecalhosDeCancelar(urlCancelar) };
}
