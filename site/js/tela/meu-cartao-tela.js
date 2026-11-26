// "Meu cartão não está na lista": formulário para a pessoa adicionar um cartão
// com os números que ela conhece (programa, pontos por real ou por dólar e
// anuidade). O cartão entra na conta na hora e fica só neste aparelho, dentro
// do perfil (ver cartoes_proprios em js/perfil/formato.js).
//
// A conferência é a mesma da importação (validarCartaoProprio, via
// lerCartaoDigitado). Nada aqui vira HTML: tudo entra por el(). Nada vai para servidor.

const CAMPOS = ['nome', 'programa_id', 'pontos_por_real', 'pontos_por_dolar', 'anuidade_brl'];

import { CARTOES_PROPRIOS_MAXIMO, NOME_CARTAO_MAXIMO, PONTOS_MAXIMO } from '../perfil/formato.js';
import { lerCartaoDigitado, mascaraAnuidade } from '../perfil/cartao-digitado.js';
import { el } from './dom.js';

function campo({ id, rotulo, ajuda, entrada, moeda = false }) {
  entrada.setAttribute('id', id);
  entrada.setAttribute('aria-describedby', [ajuda ? `${id}-ajuda` : null, `${id}-erro`].filter(Boolean).join(' '));
  return el('div', { class: 'campo' },
    el('label', { class: 'campo__rotulo', for: id }, rotulo),
    moeda ? el('div', { class: 'campo__moeda' }, entrada) : entrada,
    ajuda ? el('span', { class: 'campo__ajuda', id: `${id}-ajuda` }, ajuda) : null,
    el('span', { class: 'campo__erro', id: `${id}-erro` }));
}

/**
 * @param {object} opcoes
 * @param {{id: string, nome: string}[]} opcoes.programas
 * @param {() => string|null} opcoes.proximoId    id livre, ou null se já há o máximo
 * @param {(cartao: object) => void} opcoes.aoAdicionar
 * @returns {{ elemento: HTMLElement, atualizar(): void }}
 */
export function montarAdicionarCartao({ programas, proximoId, aoAdicionar }) {
  const nomePrograma = new Map(programas.map((p) => [p.id, p.nome]));
  const base = 'meu-cartao';
  const nome = el('input', { type: 'text', class: 'campo__entrada', maxlength: String(NOME_CARTAO_MAXIMO), autocomplete: 'off', spellcheck: 'false' });
  const programa = el('select', { class: 'campo__entrada' },
    el('option', { value: '' }, 'Escolha o programa'),
    programas.map((p) => el('option', { value: p.id }, p.nome)));
  const ppr = el('input', { type: 'text', class: 'campo__entrada', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Ex.: 2,5' });
  const ppd = el('input', { type: 'text', class: 'campo__entrada', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Ex.: 3' });
  const anuidade = el('input', { type: 'text', class: 'campo__entrada', inputmode: 'numeric', autocomplete: 'off', placeholder: '0,00' });
  anuidade.addEventListener('input', () => { anuidade.value = mascaraAnuidade(anuidade.value).texto; });
  const entradas = { nome, programa_id: programa, pontos_por_real: ppr, pontos_por_dolar: ppd, anuidade_brl: anuidade };
  const geral = el('p', { class: 'campo__erro', id: `${base}-geral`, role: 'status' });
  const botao = el('button', { type: 'submit', class: 'botao' }, 'Adicionar meu cartão');
  const cheio = el('p', { class: 'texto-suave', hidden: true },
    `Você já adicionou ${CARTOES_PROPRIOS_MAXIMO} cartões, o máximo. Remova um para adicionar outro.`);

  const formulario = el('form', { class: 'pilha--sm', novalidate: true, autocomplete: 'off', 'aria-labelledby': `${base}-resumo` },
    el('p', { class: 'texto-pequeno texto-suave' },
      'Use os números do site do banco. O cartão entra na conta na hora, fica só neste aparelho e aparece no resultado como "informado por você": a gente não confere esses números.'),
    campo({ id: `${base}-nome`, rotulo: 'Nome do cartão', ajuda: 'Só o nome, como "Cartão X Platinum". Nunca o número do cartão.', entrada: nome }),
    campo({ id: `${base}-programa`, rotulo: 'Programa em que os pontos caem', entrada: programa }),
    el('div', { class: 'perfil__dois' },
      campo({ id: `${base}-ppr`, rotulo: 'Pontos por real', ajuda: `Quantos pontos cada R$ 1 gasto dá. Até ${PONTOS_MAXIMO}.`, entrada: ppr }),
      campo({ id: `${base}-ppd`, rotulo: 'Pontos por dólar', ajuda: 'Muitos bancos informam assim, mesmo em compra em reais. Preencha um dos dois.', entrada: ppd })),
    campo({ id: `${base}-anuidade`, rotulo: 'Anuidade por ano (opcional)', ajuda: 'Some as 12 parcelas, se o banco cobrar por mês. Serve para a conta "Vale a pena?".', entrada: anuidade, moeda: true }),
    geral,
    el('div', { class: 'linha' }, botao));

  const elemento = el('div', { class: 'pilha--sm' },
    el('details', { class: 'perfil__adicionar', id: base },
      el('summary', { id: `${base}-resumo` }, 'Adicionar meu cartão'),
      cheio,
      formulario));

  function marcar(erros) {
    for (const n of CAMPOS) {
      const entrada = entradas[n];
      formulario.querySelector(`#${entrada.id}-erro`).textContent = erros[n] ?? '';
      if (erros[n]) entrada.setAttribute('aria-invalid', 'true');
      else entrada.removeAttribute('aria-invalid');
    }
    geral.textContent = erros.geral ?? '';
    const primeiro = CAMPOS.find((n) => erros[n]);
    if (primeiro) entradas[primeiro].focus();
    return Boolean(primeiro || erros.geral);
  }

  // Corrigiu o campo: o aviso de erro dele sai, para não parecer que continua errado.
  for (const n of CAMPOS) {
    const entrada = entradas[n];
    entrada.addEventListener('input', () => {
      if (entrada.getAttribute('aria-invalid') !== 'true') return;
      entrada.removeAttribute('aria-invalid');
      formulario.querySelector(`#${entrada.id}-erro`).textContent = '';
    });
  }

  function atualizar() {
    const semVaga = proximoId() === null;
    cheio.hidden = !semVaga;
    formulario.hidden = semVaga;
  }

  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const id = proximoId();
    if (!id) { atualizar(); return; }
    const r = lerCartaoDigitado({
      nome: nome.value, programa_id: programa.value, pontos_por_real: ppr.value, pontos_por_dolar: ppd.value, anuidade: anuidade.value,
    }, nomePrograma, id);
    if (!r.ok) {
      // O id é nosso; erro nele não é da pessoa.
      const { id: _id, ...erros } = r.erros;
      marcar(erros);
      return;
    }
    marcar({});
    for (const entrada of [nome, ppr, ppd, anuidade]) entrada.value = '';
    programa.value = '';
    aoAdicionar(r.cartao);
    atualizar();
  });

  atualizar();
  return { elemento, atualizar };
}
