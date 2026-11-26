// Bloco "Explica pra mim" embaixo do resultado.
//
// A explicação vem de um modelo de linguagem, mas por uma função no NOSSO
// servidor (/api/explicar): o navegador não fala com o provedor de IA e não
// vê chave nenhuma. Tudo o que chega é montado com el() (textContent), então
// nenhum texto da resposta vira HTML (CLAUDE.md, seção 6).

import { el } from '../tela/dom.js';
import { ENDERECO_DO_EXPLICAR } from './config.js';
import { corpoDoPedido, lerResposta, problemaDaPergunta, TEXTOS } from './pedido.js';
import { SUGESTOES, TAMANHO_MAXIMO_DA_PERGUNTA } from './pergunta.js';

let contador = 0;

function montarBlocos(blocos) {
  return blocos.map((b) => (b.tipo === 'lista'
    ? el('ul', { class: 'resultado__lista' }, b.itens.map((i) => el('li', {}, i)))
    : el('p', {}, b.texto)));
}

/**
 * @param {object} contexto { lojaId, centavos, perfil, melhor }
 * @param {object} [opcoes] { buscar } (trocado nos testes)
 */
export function montarExplicar(contexto, { buscar = (...a) => globalThis.fetch(...a) } = {}) {
  const id = `explicar-${++contador}`;
  const campo = el('textarea', {
    id: `${id}-pergunta`,
    class: 'campo__entrada explicar__campo',
    rows: '2',
    maxlength: String(TAMANHO_MAXIMO_DA_PERGUNTA),
    'aria-describedby': `${id}-ajuda ${id}-erro`,
    placeholder: SUGESTOES[1],
  });
  const erro = el('p', { class: 'campo__erro', id: `${id}-erro` });
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Explica pra mim');
  const saida = el('div', { class: 'explicar__saida pilha--sm', role: 'status', 'aria-live': 'polite' });

  const sugestoes = el('div', { class: 'explicar__sugestoes' }, SUGESTOES.map((s) => {
    const b = el('button', { type: 'button', class: 'botao botao--secundario explicar__sugestao' }, s);
    b.addEventListener('click', () => { campo.value = s; campo.focus(); });
    return b;
  }));

  const form = el('form', { class: 'pilha--sm', novalidate: true, 'aria-labelledby': `${id}-titulo` },
    el('div', { class: 'campo' },
      el('label', { class: 'campo__rotulo', for: `${id}-pergunta` }, 'Sua dúvida (opcional)'),
      el('p', { class: 'campo__ajuda', id: `${id}-ajuda` },
        'Deixe em branco para uma explicação geral. Não escreva dados pessoais, como número de cartão ou CPF.'),
      campo, erro),
    sugestoes,
    botao);

  let enviando = false;
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (enviando) return;
    const problema = problemaDaPergunta(campo.value);
    erro.textContent = problema;
    if (problema) { campo.setAttribute('aria-invalid', 'true'); campo.focus(); return; }
    campo.removeAttribute('aria-invalid');
    enviando = true;
    botao.disabled = true;
    saida.setAttribute('aria-busy', 'true');
    saida.replaceChildren(el('p', { class: 'texto-suave' }, 'Escrevendo a explicação…'));
    let lido;
    try {
      const resposta = await buscar(ENDERECO_DO_EXPLICAR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpoDoPedido({ ...contexto, pergunta: campo.value })),
        credentials: 'same-origin',
      });
      lido = lerResposta(resposta.status, await resposta.json().catch(() => null));
    } catch {
      lido = { ok: false, mensagem: globalThis.navigator?.onLine === false ? TEXTOS.semInternet : TEXTOS.falhou };
    }
    saida.replaceChildren(...(lido.ok
      ? [el('p', { class: 'explicar__rotulo texto-pequeno' }, 'Explicação automática, feita por inteligência artificial a partir do resultado acima. Pode errar: na dúvida, vale o que a loja e o programa disserem.'),
        ...montarBlocos(lido.blocos)]
      : [el('p', { class: 'explicar__erro' }, lido.mensagem)]));
    saida.removeAttribute('aria-busy');
    botao.disabled = false;
    botao.textContent = 'Perguntar de novo';
    enviando = false;
  });

  return el('section', { class: 'card explicar pilha--sm', 'aria-labelledby': `${id}-titulo` },
    el('h3', { class: 'resultado__secao', id: `${id}-titulo` }, 'Ficou com dúvida?'),
    el('p', {}, 'A gente explica este resultado em palavras simples. A explicação usa só a conta acima: não busca ofertas novas.'),
    form,
    saida,
    el('p', { class: 'texto-suave texto-pequeno' },
      'Para escrever a explicação, a sua pergunta e o resultado (sem nada que identifique você) vão para um serviço de inteligência artificial. Veja ',
      el('a', { href: 'privacidade/' }, 'Privacidade'), '.'));
}
