// "Pedir esse cartão": quem tem um cartão que não está no cadastro pede para
// a gente incluir. Vai pela mesma função /api/reportar, com tipo
// "pedido_de_cartao". Só aparece com REPORTE_LIGADO (ver config.js).
//
// - Vai só o nome do cartão, o banco, o programa (se a pessoa souber) e um link
//   opcional da página do banco. Sem e-mail, sem nada da pessoa, e nunca os
//   números que ela digitou em "Adicionar meu cartão" (esses ficam no aparelho).
// - Tudo é montado com el(): o que a pessoa digita e o que o servidor responde
//   nunca vira HTML.
// - A conferência daqui só ajuda quem digita. Quem decide é o servidor
//   (servidor/reportar/regras.js, validarPedidoDeCartao).

import { el } from '../tela/dom.js';
import { ENDERECO_DO_REPORTE } from './config.js';
import { LIMITES_DO_PEDIDO_NA_TELA, conferirPedidoNaTela, corpoDoPedidoDeCartao } from './conferir-pedido.js';

const CAMPOS = ['nome_do_cartao', 'banco', 'programa_id', 'link_da_fonte'];

function campo({ id, rotulo, ajuda, entrada }) {
  entrada.setAttribute('id', id);
  entrada.setAttribute('aria-describedby', [ajuda ? `${id}-ajuda` : null, `${id}-erro`].filter(Boolean).join(' '));
  return el('div', { class: 'campo' },
    el('label', { class: 'campo__rotulo', for: id }, rotulo),
    ajuda ? el('span', { class: 'campo__ajuda', id: `${id}-ajuda` }, ajuda) : null,
    entrada,
    el('span', { class: 'campo__erro', id: `${id}-erro` }));
}

/**
 * @param {object} contexto
 * @param {{id: string, nome: string}[]} contexto.programas  programas do cadastro
 * @param {() => string} [contexto.sugerirNome]  nome do último cartão adicionado, para já vir preenchido
 * @param {object} [opcoes]
 * @param {typeof fetch} [opcoes.enviar]
 * @param {() => number} [opcoes.relogio]  milissegundos (performance.now)
 */
export function montarPedidoDeCartao({ programas, sugerirNome = () => '' }, { enviar = (...a) => fetch(...a), relogio = () => performance.now() } = {}) {
  const base = 'pedido-cartao';
  const L = LIMITES_DO_PEDIDO_NA_TELA;
  const nome = el('input', { class: 'campo__entrada', name: 'nome_do_cartao', type: 'text', maxlength: String(L.nomeMax), autocomplete: 'off', required: true });
  const banco = el('input', { class: 'campo__entrada', name: 'banco', type: 'text', maxlength: String(L.bancoMax), autocomplete: 'off', required: true });
  const programa = el('select', { class: 'campo__entrada', name: 'programa_id' },
    el('option', { value: '' }, 'Não sei ou não está na lista'),
    programas.map((p) => el('option', { value: p.id }, p.nome)));
  const link = el('input', { class: 'campo__entrada', name: 'link_da_fonte', type: 'url', inputmode: 'url', maxlength: String(L.linkMax), placeholder: 'https://', autocapitalize: 'off', spellcheck: 'false' });
  // Isca para robô: escondida de quem vê e de quem usa leitor de tela.
  const isca = el('input', { name: 'site', type: 'text', tabindex: '-1', autocomplete: 'off', id: `${base}-site` });
  const entradas = { nome_do_cartao: nome, banco, programa_id: programa, link_da_fonte: link };

  const status = el('p', { class: 'reporte__status', role: 'status' });
  const enviarBotao = el('button', { type: 'submit', class: 'botao' }, 'Enviar pedido');
  const formulario = el('form', { class: 'pilha--sm', novalidate: true, 'aria-labelledby': `${base}-titulo` },
    el('p', { class: 'texto-pequeno texto-suave' },
      'A gente confere o cartão no site do banco e, se estiver tudo certo, ele entra na lista para todo mundo. Não pedimos e-mail nem nada seu.'),
    campo({ id: `${base}-nome`, rotulo: 'Nome do cartão', ajuda: 'Como aparece no site do banco. Por exemplo: "Cartão X Platinum".', entrada: nome }),
    campo({ id: `${base}-banco`, rotulo: 'Banco', entrada: banco }),
    campo({ id: `${base}-programa`, rotulo: 'Programa em que os pontos caem', entrada: programa }),
    campo({ id: `${base}-link`, rotulo: 'Link da página do cartão (opcional)', ajuda: 'A página do banco que fala dos pontos. Ajuda a gente a conferir mais rápido.', entrada: link }),
    el('div', { class: 'reporte__isca', 'aria-hidden': 'true' },
      el('label', { for: `${base}-site` }, 'Deixe em branco'), isca),
    el('p', { class: 'texto-pequeno texto-suave' }, 'Não escreva número de cartão, CPF nem senha.'),
    status,
    el('div', { class: 'linha' }, enviarBotao));

  const caixa = el('details', { class: 'perfil__adicionar', id: base },
    el('summary', { id: `${base}-titulo` }, 'Pedir para incluirmos esse cartão'),
    formulario);
  let abertoEm = 0;
  let enviando = false;

  caixa.addEventListener('toggle', () => {
    if (!caixa.open) return;
    abertoEm = relogio();
    if (!nome.value) nome.value = sugerirNome() ?? '';
  });

  function marcar(erros) {
    for (const n of CAMPOS) {
      const entrada = entradas[n];
      formulario.querySelector(`#${entrada.id}-erro`).textContent = erros[n] ?? '';
      if (erros[n]) entrada.setAttribute('aria-invalid', 'true');
      else entrada.removeAttribute('aria-invalid');
    }
    const primeiro = CAMPOS.find((n) => erros[n]);
    if (primeiro) entradas[primeiro].focus();
    return Boolean(primeiro);
  }

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (enviando) return;
    status.textContent = '';
    const valores = Object.fromEntries(CAMPOS.map((n) => [n, entradas[n].value]));
    if (marcar(conferirPedidoNaTela(valores))) return;

    enviando = true;
    enviarBotao.disabled = true;
    status.textContent = 'Enviando…';
    let resposta = null;
    let dados = {};
    try {
      resposta = await enviar(ENDERECO_DO_REPORTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpoDoPedidoDeCartao(valores, { isca: isca.value, tempoMs: relogio() - abertoEm })),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      dados = await resposta.json().catch(() => ({}));
    } catch {
      resposta = null;
    }
    enviando = false;
    enviarBotao.disabled = false;

    if (resposta && resposta.ok && dados.ok) {
      const feito = el('p', { class: 'reporte__feito', role: 'status', tabindex: '-1' },
        el('span', { 'aria-hidden': 'true' }, '✓ '),
        'Recebemos o seu pedido. Obrigado! Quando a gente conferir o cartão no site do banco, ele entra na lista.');
      formulario.replaceChildren(feito);
      feito.focus();
      return;
    }
    if (resposta && resposta.status === 422 && dados.erros) {
      status.textContent = 'Falta arrumar alguns campos.';
      if (!marcar(dados.erros)) status.textContent = 'Os dados desta página mudaram. Recarregue a página e tente de novo.';
      return;
    }
    status.textContent = resposta === null
      ? 'Não deu para enviar. Confira a sua internet e tente de novo.'
      : (typeof dados.mensagem === 'string' && dados.mensagem.length < 300
        ? dados.mensagem
        : 'Não deu para enviar agora. Tente de novo em alguns minutos.');
  });

  return caixa;
}
