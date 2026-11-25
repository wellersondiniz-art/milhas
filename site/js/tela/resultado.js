// Monta o resultado na tela a partir do que o motor devolveu.
// A tela só exibe: toda conta vem de calcularJeitosDeComprar.

import { el } from './dom.js';
import { fraseSemPontos, separarJeitos } from './primeira-visita.js';
import {
  destaqueDoJeito, fraseDoJeito, palavrasQueAparecem, textoValidade, textosAntesDeComprar, textosConferido,
} from './textos.js';

const TERMOS = {
  milheiro: ['O que é milheiro?', 'É quanto valem 1.000 pontos. Se o milheiro vale R$ 20,00, cada 1.000 pontos que você junta valem uns R$ 20,00 em passagem ou produto. É uma média: o valor real depende de como você usa os pontos.'],
  clube: ['O que é clube?', 'É uma assinatura mensal do programa de pontos. Quem assina costuma ganhar mais pontos por real nas lojas parceiras. Algumas ofertas pedem que o clube esteja ativo há um tempo, por exemplo 24 horas antes da compra.'],
};

export function termo(chave) {
  const [pergunta, resposta] = TERMOS[chave];
  return el('details', { class: 'termo' }, el('summary', {}, pergunta), el('p', { class: 'termo__texto' }, resposta));
}

export function alerta(tipo, titulo, ...corpo) {
  const icones = { info: 'i', aviso: '!', perigo: '×', sucesso: '✓' };
  return el(
    'div',
    { class: `alerta alerta--${tipo}`, role: tipo === 'perigo' ? 'alert' : 'note' },
    el('span', { class: 'alerta__icone', 'aria-hidden': 'true' }, icones[tipo]),
    el('div', { class: 'alerta__corpo' }, el('strong', { class: 'alerta__titulo' }, titulo), ...corpo),
  );
}

function selos(jeito, posicao) {
  const lista = [];
  if (posicao === 0) lista.push(el('span', { class: 'selo selo--destaque' }, el('span', { 'aria-hidden': 'true' }, '★'), ' Melhor jeito'));
  else lista.push(el('span', { class: 'selo' }, `${posicao + 1}º jeito`));
  if (jeito.tipo === 'sem_oferta') lista.push(el('span', { class: 'selo selo--info' }, 'Sem oferta'));
  if (jeito.tem_dado_antigo) lista.push(el('span', { class: 'selo selo--aviso' }, 'Dado antigo'));
  return el('div', { class: 'card__topo' }, lista);
}

function blocoComoCalcular(jeito) {
  return el(
    'details',
    { class: 'termo resultado__detalhe' },
    el('summary', {}, 'Como calcular'),
    el('div', { class: 'termo__texto' },
      el('ol', { class: 'resultado__passos' }, jeito.explicacao.map((passo) => el('li', {}, passo)))),
  );
}

function blocoAntesDeComprar(jeito) {
  const { fazer, daPraGanharMais } = textosAntesDeComprar(jeito);
  return el(
    'details',
    { class: 'termo resultado__detalhe' },
    el('summary', {}, 'O que fazer antes de comprar'),
    el('div', { class: 'termo__texto pilha--sm' },
      fazer.length
        ? el('ul', { class: 'resultado__lista' }, fazer.map((t) => el('li', {}, t)))
        : el('p', {}, 'Nada especial: é só comprar.'),
      daPraGanharMais.length ? el('p', { class: 'resultado__subtitulo' }, 'Dá para ganhar mais') : null,
      daPraGanharMais.length ? el('ul', { class: 'resultado__lista' }, daPraGanharMais.map((t) => el('li', {}, t))) : null),
  );
}

function card(jeito, posicao, nomeLoja) {
  const id = `jeito-${posicao}`;
  const destaque = destaqueDoJeito(jeito);
  const conferido = textosConferido(jeito);
  return el(
    'article',
    { class: `card resultado__card${posicao === 0 ? ' card--destaque' : ''}`, 'aria-labelledby': `${id}-frase ${id}-valor` },
    selos(jeito, posicao),
    el('p', { class: `card__valor${destaque.emReais ? '' : ' card__valor--pontos'}`, id: `${id}-valor` }, destaque.principal),
    el('p', { class: 'card__legenda' }, destaque.legenda),
    el('div', { class: 'card__bloco' },
      el('p', { id: `${id}-frase` }, fraseDoJeito(jeito, nomeLoja)),
      destaque.emReais
        ? el('p', { class: 'texto-suave texto-pequeno numeros' }, `Total: ${jeito.total_pontos_texto === '1' ? '1 ponto' : `${jeito.total_pontos_texto} pontos`}`)
        : null),
    jeito.avisos.length
      ? el('div', { class: 'resultado__avisos' },
        el('p', { class: 'resultado__subtitulo' }, 'Fique de olho'),
        el('ul', { class: 'resultado__lista' }, jeito.avisos.map((a) => el('li', {}, a))))
      : null,
    el('div', { class: 'resultado__datas texto-pequeno' },
      el('p', {}, textoValidade(jeito)),
      conferido.length ? el('p', { class: 'resultado__subtitulo' }, 'Quando conferimos os dados') : null,
      conferido.length
        ? el('ul', { class: 'resultado__conferido' },
          conferido.map((c) => el('li', { class: c.antigo ? 'resultado__antigo' : null }, c.texto)))
        : null),
    el('div', { class: 'card__acoes' }, blocoAntesDeComprar(jeito), blocoComoCalcular(jeito)),
  );
}

/**
 * @param {object[]} jeitos   saída do motor, do melhor ao pior
 * @param {object} contexto   { loja, valorTexto, semPerfil, ajuste?, valeAPena?, faltaDolar? }
 *   ajuste e valeAPena são elementos prontos ("O que a conta supôs" e "Vale a pena?").
 */
export function montarResultado(jeitos, contexto) {
  const { loja, valorTexto, semPerfil, ajuste, valeAPena, faltaDolar } = contexto;
  const partes = [];
  const { melhor, abertos, recolhidos, semPontos } = separarJeitos(jeitos);
  const temOferta = jeitos.some((j) => j.tipo === 'oferta');

  if (faltaDolar && melhor && !(melhor.total_pontos > 0)) {
    const botao = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Informar o dólar');
    botao.addEventListener('click', () => {
      const campo = document.getElementById('ajuste-dolar');
      campo?.closest('details')?.setAttribute('open', '');
      campo?.focus();
    });
    partes.push(alerta('aviso', 'Falta só a cotação do dólar',
      el('p', {}, 'Quase todos os cartões de pontos rendem por dólar gasto. Sem saber quanto está o dólar, eles aparecem com 0 ponto. Informe a cotação e a conta sai na hora.'),
      botao));
  }
  if (!temOferta) {
    partes.push(alerta('info', `A ${loja.nome} não tem oferta de pontos valendo hoje`,
      semPerfil
        ? 'Abaixo está o que os cartões de pontos rendem numa compra normal, começando pelo melhor.'
        : 'Pelo menos não para os programas que você marcou. Abaixo está o que o seu cartão rende numa compra normal.'));
  }
  if (jeitos.some((j) => j.tem_dado_antigo)) {
    partes.push(alerta('aviso', 'Alguns dados podem estar desatualizados',
      'Parte do que usamos foi conferido há mais de 14 dias. As regras podem ter mudado: confira na loja e no programa antes de comprar.'));
  }

  partes.push(el('h3', { class: 'resultado__secao' }, 'O melhor jeito de comprar'));
  partes.push(card(melhor, 0, loja.nome));

  const palavras = palavrasQueAparecem(jeitos);
  if (palavras.milheiro || palavras.clube) {
    partes.push(el('div', { class: 'pilha--sm' },
      palavras.milheiro ? termo('milheiro') : null,
      palavras.clube ? termo('clube') : null));
  }

  if (ajuste) partes.push(ajuste);
  if (valeAPena) partes.push(valeAPena);

  const outros = abertos.length + recolhidos.length;
  if (outros) {
    partes.push(el('h3', { class: 'resultado__secao' }, outros === 1 ? 'Outro jeito' : `Outros ${outros} jeitos`));
    partes.push(el('div', { class: 'pilha resultado__demais' }, abertos.map((j, i) => card(j, i + 1, loja.nome))));
    if (recolhidos.length) {
      partes.push(el('details', { class: 'termo resultado__mais' },
        el('summary', {}, `Ver mais ${recolhidos.length} ${recolhidos.length === 1 ? 'jeito' : 'jeitos'}`),
        el('div', { class: 'pilha resultado__demais' }, recolhidos.map((j, i) => card(j, i + 1 + abertos.length, loja.nome)))));
    }
  }
  if (semPontos.length) {
    partes.push(el('p', { class: 'texto-suave texto-pequeno resultado__sem-pontos' }, fraseSemPontos(semPontos, faltaDolar)));
  }

  return el('div', { class: 'pilha', 'data-resumo': `${valorTexto} na ${loja.nome}` }, partes);
}

/** Esqueleto enquanto os dados carregam. */
export function montarCarregando() {
  return el('div', { class: 'card pilha--sm', 'aria-busy': 'true', 'aria-label': 'Carregando' },
    el('span', { class: 'esqueleto esqueleto--curta' }),
    el('span', { class: 'esqueleto esqueleto--valor' }),
    el('span', { class: 'esqueleto esqueleto--linha' }),
    el('span', { class: 'esqueleto esqueleto--linha esqueleto--curta' }),
    el('span', { class: 'esqueleto esqueleto--botao' }));
}
