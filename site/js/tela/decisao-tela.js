// Dois blocos da tela inicial:
//  - "Ajuste a conta para você": os padrões da conta, ditos em palavras, com
//    os campos para mudar na hora (cartão, clube, dólar). Salva no perfil.
//  - "Vale a pena?": pontos x cashback x desconto, e se a anuidade compensa.
// Toda conta vem do motor (js/motor/decisao.js). Aqui só se lê campo e se
// escreve texto, sempre por el(), nunca como HTML em texto (CLAUDE.md, seção 6).

import { calcularAnuidade, compararComDinheiro, formatarCentavos, formatarCotacao } from '../motor/index.js';
import { el } from './dom.js';
import { aplicarMascara, mascaraCotacao } from './moeda.js';
import {
  cartaoSugerido, cotacaoDe, escolhaDeCartao, lerPorcento, milheiroDe, programasComOfertaNaLoja, textoAnuidade,
} from './primeira-visita.js';

/** replaceChildren sem os null (o DOM escreveria "null" na tela). */
function encher(no, ...filhos) {
  no.replaceChildren(...filhos.flat().filter((f) => f !== null && f !== undefined && f !== false));
}

let contador = 0;
const novoId = (base) => `${base}-${++contador}`;

function campo(rotulo, entrada, ajuda) {
  const idAjuda = ajuda ? `${entrada.id}-ajuda` : null;
  if (idAjuda) entrada.setAttribute('aria-describedby', idAjuda);
  return el('div', { class: 'campo' },
    el('label', { class: 'campo__rotulo', for: entrada.id }, rotulo),
    entrada,
    ajuda ? el('span', { class: 'campo__ajuda', id: idAjuda }, ajuda) : null);
}

// ---------------------------------------------------------------------------
// Ajuste rápido

/**
 * @param {object} p
 * @param {object} p.dados
 * @param {object|null} p.perfilSalvo
 * @param {object} p.perfilDaConta      o que foi para o motor
 * @param {boolean} p.semPerfil
 * @param {string} p.lojaId
 * @param {string} p.hoje               "AAAA-MM-DD"
 * @param {(ajuste: object) => void} p.aoAjustar
 * @returns {{ elemento: HTMLElement, atualizarPremissas(lista: object[]): void, avisar(texto: string): void }}
 */
export function montarAjusteRapido({ dados, perfilSalvo, perfilDaConta, semPerfil, lojaId, hoje, aoAjustar }) {
  const premissas = el('ul', { class: 'ajuste__premissas' });
  const status = el('p', { class: 'ajuste__status texto-pequeno', role: 'status' });

  // Cartão
  const escolha = escolhaDeCartao(perfilDaConta, dados, semPerfil);
  const seletor = el('select', { id: 'ajuste-cartao', class: 'campo__entrada' },
    el('option', { value: 'todos', selected: escolha === 'todos' }, 'Ainda não sei: mostrar todos'),
    el('option', { value: 'nenhum', selected: escolha === 'nenhum' }, 'Nenhum cartão de pontos (cartão comum ou Pix)'),
    escolha === 'meus' ? el('option', { value: 'meus', selected: true }, 'Os cartões do meu perfil') : null,
    el('optgroup', { label: 'Cartões de pontos' },
      dados.cartoes.map((c) => el('option', { value: c.id, selected: escolha === c.id }, c.nome))));
  seletor.addEventListener('change', () => aoAjustar({ cartao: seletor.value }));

  // Clubes dos programas com oferta nesta loja
  const clubes = programasComOfertaNaLoja(dados, lojaId, hoje).map((programa) => {
    const atual = perfilSalvo?.programas.find((p) => p.programa_id === programa.id);
    const caixa = el('input', { type: 'checkbox', id: novoId(`ajuste-clube-${programa.id}`), checked: atual?.clube_ativo === true });
    const desde = el('input', { type: 'date', id: novoId(`ajuste-desde-${programa.id}`), class: 'campo__entrada', max: hoje, value: atual?.clube_ativo_desde ?? null });
    const blocoDesde = el('div', { hidden: !caixa.checked },
      campo('Desde quando?', desde, 'Algumas ofertas só valem com o clube ativo há pelo menos 24 horas. Sem a data, essas faixas ficam de fora.'));
    const enviar = () => {
      blocoDesde.hidden = !caixa.checked;
      aoAjustar({ clube: { programa_id: programa.id, ativo: caixa.checked, desde: desde.value || undefined } });
    };
    caixa.addEventListener('change', enviar);
    desde.addEventListener('change', enviar);
    return el('div', { class: 'pilha--sm' }, el('label', { class: 'opcao' }, caixa, `Assino o clube ${programa.nome}`), blocoDesde);
  });

  // Dólar: só aparece se algum cartão do cadastro dá pontos por dólar.
  const temPorDolar = dados.cartoes.some((c) => c.status !== 'A_CONFIRMAR'
    && typeof c.pontos_por_real !== 'number' && typeof c.pontos_por_dolar === 'number');
  const cot = cotacaoDe(perfilSalvo, dados);
  const doCadastro = cotacaoDe(null, dados);
  const dolar = el('input', {
    type: 'text', id: 'ajuste-dolar', class: 'campo__entrada', inputmode: 'numeric', autocomplete: 'off', placeholder: '0,0000',
    value: cot?.doPerfil ? mascaraCotacao(String(cot.x10000)).texto : null,
  });
  dolar.addEventListener('input', () => { dolar.value = mascaraCotacao(dolar.value).texto; });
  dolar.addEventListener('change', () => aoAjustar({ cotacao_dolar: mascaraCotacao(dolar.value).valor }));
  const ajudaDolar = doCadastro
    ? `Opcional. Em branco, usamos ${formatarCotacao(doCadastro.x10000)}, a PTAX do Banco Central.`
    : 'Ainda não temos a cotação oficial. Sem ela, cartões que dão pontos por dólar contam 0 ponto.';

  const formulario = el('form', { class: 'pilha', novalidate: true, autocomplete: 'off' },
    campo('Com qual cartão você vai pagar?', seletor),
    clubes.length ? el('fieldset', { class: 'grupo pilha--sm' }, el('legend', { class: 'campo__rotulo' }, 'Clube de pontos'), clubes) : null,
    temPorDolar && el('div', { class: 'campo' },
      el('label', { class: 'campo__rotulo', for: dolar.id }, 'Quanto está o dólar?'),
      el('div', { class: 'campo__moeda' }, dolar),
      el('span', { class: 'campo__ajuda', id: 'ajuste-dolar-ajuda' }, ajudaDolar)));
  dolar.setAttribute('aria-describedby', 'ajuste-dolar-ajuda');
  formulario.addEventListener('submit', (e) => {
    e.preventDefault();
    aoAjustar({ cotacao_dolar: mascaraCotacao(dolar.value).valor });
  });

  const mudar = el('details', { class: 'termo ajuste__mudar', open: semPerfil ? null : true });
  const elemento = el('section', { class: 'card pilha ajuste', 'aria-labelledby': 'ajuste-titulo' },
    el('h3', { id: 'ajuste-titulo', class: 'resultado__secao' }, 'O que a conta supôs'),
    el('p', { class: 'texto-suave' }, 'Para mostrar o resultado sem cadastro, usamos estes padrões. Mude o que não for o seu caso: fica salvo só neste aparelho.'),
    premissas,
    mudar,
    status);
  mudar.append(
    el('summary', {}, 'Mudar para o meu caso'),
    el('div', { class: 'termo__texto' }, formulario, el('p', { class: 'texto-pequeno' },
      'Para o valor do milheiro e tudo mais: ', el('a', { href: '#/perfil' }, 'Meu perfil'), '.')));

  return {
    elemento,
    atualizarPremissas(lista) {
      premissas.replaceChildren(...lista.map((p) => el('li', { class: p.falta ? 'ajuste__falta' : null }, p.texto)));
      // Falta algo que muda a conta (como o dólar): o campo já aparece aberto.
      if (lista.some((p) => p.falta)) mudar.open = true;
    },
    avisar(texto) {
      status.textContent = '';
      if (texto) setTimeout(() => { status.textContent = texto; }, 100);
    },
  };
}

// ---------------------------------------------------------------------------
// Vale a pena?

function saida() {
  return el('div', { class: 'vale__saida', 'aria-live': 'polite' });
}

function blocoDinheiro(jeito, valorCentavos) {
  const cashback = el('input', { type: 'text', id: novoId('vale-cashback'), class: 'campo__entrada', inputmode: 'decimal', autocomplete: 'off', placeholder: 'ex.: 5' });
  const desconto = el('input', { type: 'text', id: novoId('vale-desconto'), class: 'campo__entrada', inputmode: 'decimal', autocomplete: 'off', placeholder: 'ex.: 10' });
  const tipo = el('select', { id: novoId('vale-desconto-tipo'), class: 'campo__entrada', 'aria-label': 'O desconto é em' },
    el('option', { value: 'porcento' }, '% do valor'), el('option', { value: 'reais' }, 'reais (R$)'));
  const erro = el('p', { class: 'campo__erro', role: 'alert' });
  const resposta = saida();

  function atualizar() {
    erro.textContent = '';
    const cb = lerPorcento(cashback.value);
    if (cashback.value.trim() && cb === null) erro.textContent = 'Cashback: use um número de 0 a 100, como 5 ou 5,5.';
    let entradaDesconto = {};
    if (desconto.value.trim()) {
      if (tipo.value === 'porcento') {
        const d = lerPorcento(desconto.value);
        if (d === null) erro.textContent = 'Desconto: use um número de 0 a 100, como 10.';
        else entradaDesconto = { desconto_porcento: d };
      } else {
        const { centavos } = aplicarMascara(desconto.value.includes(',') ? desconto.value : `${desconto.value},00`);
        if (centavos === null || centavos > valorCentavos) erro.textContent = `Desconto: use um valor até ${formatarCentavos(valorCentavos)}.`;
        else entradaDesconto = { desconto_centavos: centavos };
      }
    }
    const r = compararComDinheiro({
      valor_compra_centavos: valorCentavos,
      pontos_escalados: jeito.total_pontos_escalado,
      valor_pontos: jeito.valor_estimado_em_reais?.bilionesimos_de_centavo ?? null,
      cashback_porcento: cb ?? undefined,
      ...entradaDesconto,
    });
    encher(resposta,
      r.opcoes.length > 1
        ? el('ul', { class: 'vale__opcoes' }, r.opcoes.map((o) => el('li', { class: o.tipo === r.vencedor ? 'vale__vencedor' : null },
          el('span', {}, o.rotulo), el('strong', { class: 'numeros' }, o.texto))))
        : null,
      el('p', { class: r.vencedor ? 'vale__veredito' : 'texto-suave' }, r.veredito));
  }
  for (const c of [cashback, desconto]) c.addEventListener('input', atualizar);
  tipo.addEventListener('change', atualizar);
  atualizar();

  return el('div', { class: 'pilha--sm vale__bloco' },
    el('h4', { class: 'vale__titulo' }, 'Pontos, cashback ou desconto?'),
    el('p', { class: 'texto-suave texto-pequeno' },
      'Cashback é parte do dinheiro que volta para você depois da compra. Em geral dá para pegar só um: o cashback de um site parceiro não soma com a oferta de pontos, e pagar no Pix para ganhar desconto tira os pontos do cartão.'),
    el('div', { class: 'vale__campos' },
      campo('Cashback oferecido (%)', cashback),
      el('div', { class: 'campo' },
        el('label', { class: 'campo__rotulo', for: desconto.id }, 'Desconto à vista ou cupom'),
        el('div', { class: 'linha linha--justa' }, desconto, tipo))),
    erro,
    resposta);
}

function blocoAnuidade({ jeitos, dados, perfil }) {
  const sugerido = cartaoSugerido(jeitos, perfil, dados);
  const cartao = el('select', { id: novoId('vale-cartao'), class: 'campo__entrada' },
    dados.cartoes.map((c) => el('option', { value: c.id, selected: c.id === sugerido }, c.nome)));
  const gasto = el('input', { type: 'text', id: novoId('vale-gasto'), class: 'campo__entrada', inputmode: 'numeric', autocomplete: 'off', placeholder: '0,00' });
  const alternativa = el('input', { type: 'text', id: novoId('vale-alternativa'), class: 'campo__entrada', inputmode: 'decimal', autocomplete: 'off', placeholder: 'ex.: 1' });
  const erro = el('p', { class: 'campo__erro', role: 'alert' });
  const resposta = saida();
  const cot = cotacaoDe(perfil, dados);

  function atualizar() {
    erro.textContent = '';
    gasto.value = aplicarMascara(gasto.value).texto;
    const centavos = aplicarMascara(gasto.value).centavos;
    const alt = lerPorcento(alternativa.value);
    if (alternativa.value.trim() && alt === null) erro.textContent = 'Cashback do outro cartão: use um número de 0 a 100, como 1.';
    const registro = dados.cartoes.find((c) => c.id === cartao.value);
    if (!registro) { resposta.replaceChildren(); return; }
    const r = calcularAnuidade({
      cartao: registro,
      gasto_mensal_centavos: centavos ?? 0,
      milheiro: milheiroDe(registro.programa_id, perfil, dados),
      cotacao: cot?.x10000 ?? null,
      cashback_alternativo_porcento: alt ?? 0,
    });
    const t = textoAnuidade(r, centavos !== null && centavos > 0);
    encher(resposta,
      el('p', { class: `vale__veredito vale__veredito--${r.situacao}` }, t.principal),
      t.detalhes.length ? el('ul', { class: 'resultado__lista texto-pequeno' }, t.detalhes.map((d) => el('li', {}, d))) : null,
      r.explicacao.length > 1
        ? el('details', { class: 'termo' }, el('summary', {}, 'Como calculamos'),
          el('div', { class: 'termo__texto' }, el('ol', { class: 'resultado__passos' }, r.explicacao.map((p) => el('li', {}, p)))))
        : null);
  }
  cartao.addEventListener('change', atualizar);
  gasto.addEventListener('input', atualizar);
  alternativa.addEventListener('input', atualizar);
  atualizar();

  return el('div', { class: 'pilha--sm vale__bloco' },
    el('h4', { class: 'vale__titulo' }, 'A anuidade do cartão compensa?'),
    el('p', { class: 'texto-suave texto-pequeno' },
      'Anuidade é o que o banco cobra por ano para você ter o cartão. A conta compara com o valor dos pontos que o seu gasto do mês rende em um ano.'),
    el('div', { class: 'vale__campos' },
      campo('Cartão', cartao),
      el('div', { class: 'campo' },
        el('label', { class: 'campo__rotulo', for: gasto.id }, 'Quanto você gasta por mês no cartão?'),
        el('div', { class: 'campo__moeda' }, gasto)),
      campo('Um cartão sem anuidade devolveria (%)', alternativa, 'Opcional. Se você tem ou pode ter um cartão sem anuidade com cashback, diga quanto ele devolve.')),
    erro,
    resposta);
}

/**
 * @param {object} p
 * @param {object[]} p.jeitos           saída do motor
 * @param {number} p.valorCentavos
 * @param {object} p.dados
 * @param {object} p.perfil             perfil que foi para o motor
 */
export function montarValeAPena({ jeitos, valorCentavos, dados, perfil }) {
  const [melhor] = jeitos;
  return el('section', { class: 'card pilha vale', 'aria-labelledby': 'vale-titulo' },
    el('h3', { id: 'vale-titulo', class: 'resultado__secao' }, 'Vale a pena?'),
    melhor ? blocoDinheiro(melhor, valorCentavos) : null,
    dados.cartoes.length ? blocoAnuidade({ jeitos, dados, perfil }) : null);
}
