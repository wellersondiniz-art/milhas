// Formulário opcional "Seus cartões e programas". Salva sozinho, só neste aparelho.

import { el } from './dom.js';
import { aplicarMascara } from './moeda.js';
import { termo } from './resultado.js';

const A_CONFIRMAR = 'A_CONFIRMAR';

/**
 * @param {HTMLElement} raiz       onde o formulário é montado
 * @param {object} dados           { programas, cartoes }
 * @param {object|null} perfil     perfil salvo (ou null)
 * @param {(perfil: object) => void} aoMudar
 */
export function montarPerfil(raiz, dados, perfil, aoMudar) {
  const salvo = perfil ?? { programas: [], cartoes: [], valor_milheiro_brl: {} };
  const doPrograma = new Map(salvo.programas.map((p) => [p.programa_id, p]));
  const campos = [];

  const blocosPrograma = dados.programas.map((programa) => {
    const atual = doPrograma.get(programa.id);
    const base = `perfil-${programa.id}`;
    const tem = el('input', { type: 'checkbox', id: `${base}-tem`, checked: Boolean(atual) });
    const clube = el('input', { type: 'checkbox', id: `${base}-clube`, checked: atual?.clube_ativo === true });
    const desde = el('input', {
      type: 'date', id: `${base}-desde`, class: 'campo__entrada', value: atual?.clube_ativo_desde ?? null,
      'aria-describedby': `${base}-desde-ajuda`,
    });
    const milheiroCentavos = salvo.valor_milheiro_brl?.[programa.id];
    const milheiro = el('input', {
      type: 'text', id: `${base}-milheiro`, class: 'campo__entrada', inputmode: 'numeric', autocomplete: 'off',
      placeholder: '0,00', value: milheiroCentavos ? aplicarMascara(String(milheiroCentavos)).texto : null,
      'aria-describedby': `${base}-milheiro-ajuda`,
    });
    milheiro.addEventListener('input', () => { milheiro.value = aplicarMascara(milheiro.value).texto; });

    const detalhes = el('div', { class: 'perfil__detalhes pilha--sm', hidden: !atual },
      el('label', { class: 'opcao' }, clube, `Assino o clube ${programa.nome}`),
      el('div', { class: 'campo', hidden: !(atual?.clube_ativo) },
        el('label', { class: 'campo__rotulo', for: desde.id }, 'Desde quando?'),
        desde,
        el('span', { class: 'campo__ajuda', id: `${base}-desde-ajuda` },
          'Algumas ofertas só valem se o clube estiver ativo há pelo menos 24 horas.')),
      el('div', { class: 'campo' },
        el('label', { class: 'campo__rotulo', for: milheiro.id }, `Quanto vale o milheiro ${programa.nome} para você? (opcional)`),
        el('div', { class: 'campo__moeda' }, milheiro),
        el('span', { class: 'campo__ajuda', id: `${base}-milheiro-ajuda` },
          programa.valor_milheiro_brl === A_CONFIRMAR
            ? 'Ainda não temos esse valor confirmado. Se você informar, mostramos quanto os pontos valem em reais.'
            : 'Se deixar em branco, usamos o valor médio do nosso cadastro.')),
    );
    const campoDesde = detalhes.children[1];
    tem.addEventListener('change', () => { detalhes.hidden = !tem.checked; });
    clube.addEventListener('change', () => { campoDesde.hidden = !clube.checked; });
    campos.push({ programa, tem, clube, desde, milheiro });
    return el('div', { class: 'perfil__programa' },
      el('label', { class: 'opcao perfil__nome' }, tem, `Tenho conta no ${programa.nome}`), detalhes);
  });

  const nomePrograma = new Map(dados.programas.map((p) => [p.id, p.nome]));
  const cartoes = dados.cartoes.map((cartao) => {
    const caixa = el('input', { type: 'checkbox', id: `perfil-cartao-${cartao.id}`, value: cartao.id, checked: salvo.cartoes.includes(cartao.id) });
    const semPontos = cartao.status === A_CONFIRMAR || typeof cartao.pontos_por_real !== 'number';
    return {
      caixa,
      no: el('label', { class: 'opcao' }, caixa,
        el('span', {}, cartao.nome,
          el('span', { class: 'texto-suave texto-pequeno perfil__nota' },
            ` · junta ${nomePrograma.get(cartao.programa_id) ?? 'pontos'}${semPontos ? ' (pontos por real ainda não confirmados)' : ''}`))),
    };
  });

  const status = el('p', { class: 'texto-suave texto-pequeno', role: 'status' });

  function lerFormulario() {
    const novo = { programas: [], cartoes: [], valor_milheiro_brl: {} };
    for (const c of campos) {
      if (!c.tem.checked) continue;
      const item = { programa_id: c.programa.id, clube_ativo: c.clube.checked };
      if (c.clube.checked && c.desde.value) item.clube_ativo_desde = c.desde.value;
      novo.programas.push(item);
      const { centavos } = aplicarMascara(c.milheiro.value);
      if (centavos) novo.valor_milheiro_brl[c.programa.id] = centavos;
    }
    novo.cartoes = cartoes.filter((c) => c.caixa.checked).map((c) => c.caixa.value);
    return novo;
  }

  const apagar = el('button', { type: 'button', class: 'botao botao--fantasma' }, 'Apagar o que salvei');

  const formulario = el('form', { class: 'pilha', novalidate: true },
    el('p', { class: 'texto-suave' },
      'Marque o que você tem. Fica salvo só neste aparelho: não pedimos número de cartão, CPF nem senha.'),
    el('fieldset', { class: 'grupo pilha--sm' },
      el('legend', { class: 'campo__rotulo' }, 'Programas de pontos'),
      blocosPrograma),
    termo('clube'),
    el('fieldset', { class: 'grupo' },
      el('legend', { class: 'campo__rotulo' }, 'Cartões de crédito'),
      cartoes.map((c) => c.no)),
    el('div', { class: 'linha' }, apagar),
    status,
  );
  formulario.addEventListener('submit', (evento) => evento.preventDefault());
  formulario.addEventListener('change', () => {
    const novo = lerFormulario();
    status.textContent = aoMudar(novo) ? 'Salvo neste aparelho.' : 'Não deu para salvar neste navegador. A conta usa o que está marcado agora.';
  });
  apagar.addEventListener('click', () => {
    for (const c of campos) { c.tem.checked = false; c.clube.checked = false; c.desde.value = ''; c.milheiro.value = ''; }
    for (const c of cartoes) c.caixa.checked = false;
    for (const d of formulario.querySelectorAll('.perfil__detalhes')) d.hidden = true;
    aoMudar(null);
    status.textContent = 'Apagado. Agora a conta volta a usar todos os cartões e programas.';
  });

  raiz.replaceChildren(formulario);
}
