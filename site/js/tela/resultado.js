// Monta o resultado na tela a partir do que o motor devolveu.
// A tela só exibe: toda conta vem de calcularJeitosDeComprar.

import { el } from './dom.js';
import { REPORTE_LIGADO } from '../reporte/config.js';
import { montarReporte } from '../reporte/formulario.js';
import {
  destaqueDoJeito, fraseDoJeito, palavrasQueAparecem, seloDeVencimento, textoValidade, textosAntesDeComprar, textosConferido,
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
  const vence = seloDeVencimento(jeito);
  if (vence) lista.push(el('span', { class: 'selo selo--aviso' }, vence));
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

function card(jeito, posicao, loja, reporteLigado) {
  const nomeLoja = loja.nome;
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
    reporteLigado ? montarReporte({ id, loja, jeito }) : null,
  );
}

/**
 * @param {object[]} jeitos   saída do motor, do melhor ao pior
 * @param {object} contexto   { loja, valorTexto, semPerfil, reporteLigado? }
 */
export function montarResultado(jeitos, contexto) {
  const { loja, valorTexto, semPerfil, reporteLigado = REPORTE_LIGADO } = contexto;
  const partes = [];
  const [melhor, ...demais] = jeitos;
  const temOferta = jeitos.some((j) => j.tipo === 'oferta');

  if (semPerfil) {
    partes.push(alerta('info', 'Mostrando com todos os cartões e programas',
      el('p', {}, 'Você ainda não disse quais cartões e programas tem. Por isso a conta usa todos os que conhecemos, sem clube.'),
      el('a', { class: 'botao botao--secundario', href: '#/perfil' }, 'Cadastrar os meus')));
  }
  if (!temOferta) {
    partes.push(alerta('info', `A ${loja.nome} não tem oferta de pontos valendo hoje`,
      semPerfil
        ? 'Abaixo está o que cada cartão rende numa compra normal, começando pelo melhor.'
        : 'Pelo menos não para os programas que você marcou. Abaixo está o que o seu melhor cartão rende numa compra normal.'));
  }
  if (jeitos.some((j) => j.tem_dado_antigo)) {
    partes.push(alerta('aviso', 'Alguns dados podem estar desatualizados',
      'Parte do que usamos foi conferido há mais de 14 dias. As regras podem ter mudado: confira na loja e no programa antes de comprar. Oferta conferida há mais de 30 dias fica fora da conta até ser conferida de novo.'));
  }

  partes.push(el('h3', { class: 'resultado__secao' }, 'O melhor jeito de comprar'));
  partes.push(card(melhor, 0, loja, reporteLigado));

  const palavras = palavrasQueAparecem(jeitos);
  if (palavras.milheiro || palavras.clube) {
    partes.push(el('div', { class: 'pilha--sm' },
      palavras.milheiro ? termo('milheiro') : null,
      palavras.clube ? termo('clube') : null));
  }

  if (demais.length) {
    partes.push(el('h3', { class: 'resultado__secao' }, demais.length === 1 ? 'Outro jeito' : `Outros ${demais.length} jeitos`));
    partes.push(el('div', { class: 'pilha resultado__demais' }, demais.map((j, i) => card(j, i + 1, loja, reporteLigado))));
  }

  const botaoDeSaida = linkDeSaida(contexto.saida, loja.nome);
  if (botaoDeSaida) partes.push(botaoDeSaida);

  return el('div', { class: 'pilha', 'data-resumo': `${valorTexto} na ${loja.nome}` }, partes);
}

/**
 * "Ir para a loja", depois do resultado. `saida` vem de montarLinkDeSaida
 * (js/saida/links.js); a lista acima já está pronta e não muda por causa dele.
 * Link de afiliado leva rel="sponsored noopener noreferrer" e o aviso de comissão.
 */
export function linkDeSaida(saida, nomeLoja) {
  if (!saida || typeof saida.url !== 'string' || !/^https:\/\/[^\s]+$/i.test(saida.url)) return null;
  const idAviso = 'resultado-aviso-comissao';
  return el('div', { class: 'pilha--sm' },
    el('a', { class: 'botao botao--secundario botao--bloco', href: saida.url, rel: saida.rel, 'aria-describedby': saida.aviso ? idAviso : null }, `Ir para a loja ${nomeLoja}`),
    saida.aviso ? el('p', { id: idAviso, class: 'texto-suave texto-pequeno' }, saida.aviso) : null);
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
