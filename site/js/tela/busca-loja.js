// Campo de loja com autocompletar (padrão "combobox" com lista, do ARIA APG).
// Teclado: setas sobem e descem, Enter escolhe, Esc fecha.

import { el } from './dom.js';
import { filtrarLojas, lojaPeloNome } from './lojas.js';

/**
 * @param {object} opcoes
 * @param {HTMLInputElement} opcoes.campo
 * @param {HTMLElement} opcoes.lista   <ul role="listbox">
 * @param {HTMLElement} opcoes.status  região aria-live para contar quantas lojas apareceram
 * @param {(loja: object|null) => void} opcoes.aoEscolher
 */
export function criarBuscaDeLoja({ campo, lista, status, aoEscolher }) {
  let lojas = [];
  let achadas = [];
  let ativa = -1;
  let escolhida = null;

  function fechar() {
    lista.hidden = true;
    campo.setAttribute('aria-expanded', 'false');
    campo.removeAttribute('aria-activedescendant');
    ativa = -1;
  }

  function marcarAtiva(indice) {
    ativa = indice;
    for (const [i, item] of [...lista.querySelectorAll('[role="option"]')].entries()) {
      item.setAttribute('aria-selected', String(i === ativa));
      if (i === ativa) {
        campo.setAttribute('aria-activedescendant', item.id);
        item.scrollIntoView({ block: 'nearest' });
      }
    }
    if (ativa < 0) campo.removeAttribute('aria-activedescendant');
  }

  function escolher(loja) {
    escolhida = loja;
    campo.value = loja.nome;
    fechar();
    aoEscolher(loja);
  }

  function abrir() {
    achadas = filtrarLojas(lojas, campo.value);
    const itens = achadas.map((loja, i) => {
      const item = el('li', { id: `loja-opcao-${i}`, role: 'option', 'aria-selected': 'false', class: 'busca__opcao' }, loja.nome);
      // mousedown, e não click: assim o campo não perde o foco antes da escolha.
      item.addEventListener('mousedown', (evento) => {
        evento.preventDefault();
        escolher(loja);
      });
      return item;
    });
    if (!itens.length) {
      const nomes = filtrarLojas(lojas, '', 50).map((l) => l.nome).join(', ');
      itens.push(el('li', { class: 'busca__vazio' }, `Não achamos essa loja. Por enquanto temos: ${nomes}.`));
    }
    lista.replaceChildren(...itens);
    lista.hidden = false;
    campo.setAttribute('aria-expanded', 'true');
    ativa = -1;
    status.textContent = achadas.length
      ? `${achadas.length} ${achadas.length === 1 ? 'loja encontrada' : 'lojas encontradas'}. Use as setas para escolher.`
      : 'Nenhuma loja encontrada.';
  }

  campo.addEventListener('input', () => {
    if (escolhida && campo.value !== escolhida.nome) {
      escolhida = null;
      aoEscolher(null);
    }
    abrir();
  });
  campo.addEventListener('focus', () => { if (!escolhida) abrir(); });
  campo.addEventListener('click', () => { if (lista.hidden) abrir(); });
  campo.addEventListener('blur', () => {
    // Quem digitou o nome inteiro sem escolher na lista também vale.
    if (!escolhida) {
      const exata = lojaPeloNome(lojas, campo.value);
      if (exata) escolher(exata);
    }
    fechar();
  });
  campo.addEventListener('keydown', (evento) => {
    const aberta = !lista.hidden;
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      if (!aberta) abrir();
      if (achadas.length) marcarAtiva((ativa + 1) % achadas.length);
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!aberta) abrir();
      if (achadas.length) marcarAtiva(ativa <= 0 ? achadas.length - 1 : ativa - 1);
    } else if (evento.key === 'Enter') {
      if (aberta && ativa >= 0) {
        evento.preventDefault();
        escolher(achadas[ativa]);
      } else if (aberta && achadas.length === 1) {
        evento.preventDefault();
        escolher(achadas[0]);
      }
    } else if (evento.key === 'Escape') {
      if (aberta) {
        evento.preventDefault();
        fechar();
      }
    }
  });

  return {
    definirLojas(novas) { lojas = novas; },
    escolhida: () => escolhida,
    /** Tenta aceitar o texto digitado (nome exato). Devolve a loja ou null. */
    confirmar() {
      if (!escolhida) {
        const exata = lojaPeloNome(lojas, campo.value);
        if (exata) escolher(exata);
      }
      return escolhida;
    },
  };
}
