// Botão "Essa informação está errada?" e o formulário curtinho de cada resultado.
//
// - Tudo é montado com el() (createElement + textContent): o que a pessoa
//   digita e o que o servidor responde nunca vira HTML.
// - A conferência daqui só ajuda quem digita. Quem decide é o servidor
//   (servidor/reportar/), que confere tudo de novo.
// - Nada fica guardado no aparelho: o formulário vive só na tela.

import { el } from '../tela/dom.js';
import { ENDERECO_DO_REPORTE } from './config.js';
import { conferirNaTela, LIMITES_DA_TELA } from './conferir.js';

const CAMPOS = ['o_que_esta_errado', 'link_da_prova', 'email'];

function campo({ id, rotulo, ajuda, entrada }) {
  const idErro = `${id}-erro`;
  const idAjuda = ajuda ? `${id}-ajuda` : null;
  entrada.setAttribute('id', id);
  entrada.setAttribute('aria-describedby', [idAjuda, idErro].filter(Boolean).join(' '));
  return el('div', { class: 'campo' },
    el('label', { class: 'campo__rotulo', for: id }, rotulo),
    ajuda ? el('span', { class: 'campo__ajuda', id: idAjuda }, ajuda) : null,
    entrada,
    el('span', { class: 'campo__erro', id: idErro }));
}

/**
 * @param {object} contexto
 * @param {string} contexto.id          prefixo único dos ids (ex.: "jeito-0")
 * @param {{id: string, nome: string}} contexto.loja
 * @param {object} contexto.jeito       um item da saída do motor
 * @param {object} [opcoes]
 * @param {typeof fetch} [opcoes.enviar]
 * @param {() => number} [opcoes.relogio]  milissegundos (performance.now)
 */
export function montarReporte({ id, loja, jeito }, { enviar = (...a) => fetch(...a), relogio = () => performance.now() } = {}) {
  const base = `${id}-reporte`;
  const botao = el('button', {
    type: 'button', class: 'botao botao--fantasma reporte__abrir', 'aria-expanded': 'false', 'aria-controls': base,
  }, 'Essa informação está errada?');

  const texto = el('textarea', { class: 'campo__entrada reporte__texto', name: 'o_que_esta_errado', rows: '4', maxlength: String(LIMITES_DA_TELA.textoMax), required: true });
  const link = el('input', { class: 'campo__entrada', name: 'link_da_prova', type: 'url', inputmode: 'url', maxlength: String(LIMITES_DA_TELA.linkMax), placeholder: 'https://', autocapitalize: 'off', spellcheck: 'false', required: true });
  const email = el('input', { class: 'campo__entrada', name: 'email', type: 'email', inputmode: 'email', maxlength: String(LIMITES_DA_TELA.emailMax), autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false' });
  // Isca para robô: escondida de quem vê e de quem usa leitor de tela.
  const isca = el('input', { name: 'site', type: 'text', tabindex: '-1', autocomplete: 'off', id: `${base}-site` });
  const entradas = { o_que_esta_errado: texto, link_da_prova: link, email };

  const status = el('p', { class: 'reporte__status', role: 'status' });
  const enviarBotao = el('button', { type: 'submit', class: 'botao' }, 'Enviar aviso');
  const cancelar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Cancelar');

  const formulario = el('form', { class: 'reporte__formulario pilha--sm', novalidate: true, 'aria-labelledby': `${base}-titulo` },
    el('p', { class: 'reporte__titulo', id: `${base}-titulo` }, 'Avise o que está errado'),
    el('p', { class: 'texto-pequeno' }, 'Loja: ', el('strong', {}, loja.nome)),
    campo({ id: `${base}-texto`, rotulo: 'O que está errado?', ajuda: 'Por exemplo: "a oferta acabou ontem" ou "agora são 8 pontos por real, não 10".', entrada: texto }),
    campo({ id: `${base}-link`, rotulo: 'Link da prova', ajuda: 'A página da loja ou do programa que mostra a informação certa.', entrada: link }),
    campo({ id: `${base}-email`, rotulo: 'Seu e-mail (opcional)', ajuda: 'Só se quiser resposta. Ele é apagado quando a gente resolve o aviso, em até 90 dias.', entrada: email }),
    el('div', { class: 'reporte__isca', 'aria-hidden': 'true' },
      el('label', { for: `${base}-site` }, 'Deixe em branco'), isca),
    el('p', { class: 'texto-pequeno texto-suave' }, 'Não escreva número de cartão, CPF nem senha. Veja ', el('a', { href: 'privacidade/' }, 'Privacidade'), '.'),
    status,
    el('div', { class: 'linha reporte__botoes' }, enviarBotao, cancelar));

  const painel = el('div', { class: 'reporte__painel', id: base, hidden: true }, formulario);
  const caixa = el('div', { class: 'reporte' }, botao, painel);
  let abertoEm = 0;
  let enviando = false;

  function marcar(erros) {
    for (const nome of CAMPOS) {
      const entrada = entradas[nome];
      const caixaErro = formulario.querySelector(`#${entrada.id}-erro`);
      caixaErro.textContent = erros[nome] ?? '';
      if (erros[nome]) entrada.setAttribute('aria-invalid', 'true');
      else entrada.removeAttribute('aria-invalid');
    }
    const primeiro = CAMPOS.find((n) => erros[n]);
    if (primeiro) entradas[primeiro].focus();
    return Boolean(primeiro);
  }

  function abrir() {
    painel.hidden = false;
    botao.setAttribute('aria-expanded', 'true');
    abertoEm = relogio();
    texto.focus();
  }
  function fechar() {
    painel.hidden = true;
    botao.setAttribute('aria-expanded', 'false');
    botao.focus();
  }
  botao.addEventListener('click', () => (painel.hidden ? abrir() : fechar()));
  cancelar.addEventListener('click', fechar);
  formulario.addEventListener('keydown', (evento) => { if (evento.key === 'Escape') fechar(); });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (enviando) return;
    status.textContent = '';
    const valores = Object.fromEntries(CAMPOS.map((n) => [n, entradas[n].value]));
    if (marcar(conferirNaTela(valores))) return;

    enviando = true;
    enviarBotao.disabled = true;
    status.textContent = 'Enviando…';
    const corpo = {
      loja_id: loja.id,
      oferta_id: jeito.oferta_id ?? null,
      programa_id: jeito.programa?.id ?? null,
      // Cartão adicionado pela pessoa não está nos nossos dados: não vai.
      cartao_id: jeito.cartao && jeito.cartao.informado_pela_pessoa !== true ? jeito.cartao.id : null,
      o_que_esta_errado: valores.o_que_esta_errado,
      link_da_prova: valores.link_da_prova.trim(),
      email: valores.email.trim(),
      site: isca.value,
      tempo_no_formulario_ms: Math.round(relogio() - abertoEm),
    };
    let resposta = null;
    let dados = {};
    try {
      resposta = await enviar(ENDERECO_DO_REPORTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
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
        el('span', { 'aria-hidden': 'true' }, '✓ '), 'Recebemos o seu aviso. Obrigado! A gente confere e corrige.');
      caixa.replaceChildren(feito);
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
