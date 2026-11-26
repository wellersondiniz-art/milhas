// Monta o resultado de "Quanto rende abastecer" a partir do que o motor devolveu.
// A tela só exibe: toda conta vem de calcularAbastecimento.

import { el } from './dom.js';
import { alerta, termo } from './resultado.js';
import { destaqueDoJeito, palavrasQueAparecem, textosConferido } from './textos.js';
import { fraseDoAbastecimento, textosAntesDeAbastecer, textoValidadeDoAbastecimento } from './abastecer-textos.js';

/** Quantos "outros jeitos" aparecem abertos; o resto fica em "Ver mais". */
const OUTROS_A_VISTA = 3;

/** Link para a fonte oficial. Só https (o schema já exige); outro endereço vira texto. */
function linkFonte(url, texto) {
  if (!/^https:\/\//.test(url ?? '')) return null;
  return el('a', { href: url, rel: 'noopener noreferrer external' }, texto);
}

function selos(jeito, posicao) {
  const lista = [];
  if (posicao === 0) lista.push(el('span', { class: 'selo selo--destaque' }, el('span', { 'aria-hidden': 'true' }, '★'), ' Melhor jeito'));
  else lista.push(el('span', { class: 'selo' }, `${posicao + 1}º jeito`));
  if (jeito.tipo === 'combustivel_so_cartao') lista.push(el('span', { class: 'selo selo--info' }, 'Só o cartão'));
  else lista.push(el('span', { class: 'selo selo--info' }, jeito.rede.nome));
  if (jeito.tem_dado_antigo) lista.push(el('span', { class: 'selo selo--aviso' }, 'Dado antigo'));
  return el('div', { class: 'card__topo' }, lista);
}

function detalhe(titulo, ...corpo) {
  return el('details', { class: 'termo resultado__detalhe' }, el('summary', {}, titulo), el('div', { class: 'termo__texto pilha--sm' }, ...corpo));
}

function card(jeito, posicao) {
  const id = `abastecer-${posicao}`;
  const destaque = destaqueDoJeito(jeito);
  const conferido = textosConferido(jeito);
  const fazer = textosAntesDeAbastecer(jeito);
  const fonte = linkFonte(jeito.fonte_url, 'Ver o regulamento do programa');
  return el(
    'article',
    { class: `card resultado__card${posicao === 0 ? ' card--destaque' : ''}`, 'aria-labelledby': `${id}-frase ${id}-valor` },
    selos(jeito, posicao),
    el('p', { class: `card__valor${destaque.emReais ? '' : ' card__valor--pontos'}`, id: `${id}-valor` }, destaque.principal),
    el('p', { class: 'card__legenda' }, destaque.legenda.replace('desta compra', 'deste abastecimento').replace('esta compra', 'este abastecimento')),
    el('div', { class: 'card__bloco' },
      el('p', { id: `${id}-frase` }, fraseDoAbastecimento(jeito)),
      destaque.emReais
        ? el('p', { class: 'texto-suave texto-pequeno numeros' }, `Total: ${jeito.total_pontos_texto === '1' ? '1 ponto' : `${jeito.total_pontos_texto} pontos`}`)
        : null),
    jeito.avisos.length
      ? el('div', { class: 'resultado__avisos' },
        el('p', { class: 'resultado__subtitulo' }, 'Fique de olho'),
        el('ul', { class: 'resultado__lista' }, jeito.avisos.map((a) => el('li', {}, a))))
      : null,
    el('div', { class: 'resultado__datas texto-pequeno' },
      el('p', {}, textoValidadeDoAbastecimento(jeito)),
      conferido.length ? el('p', { class: 'resultado__subtitulo' }, 'Quando conferimos os dados') : null,
      conferido.length
        ? el('ul', { class: 'resultado__conferido' },
          conferido.map((c) => el('li', { class: c.antigo ? 'resultado__antigo' : null }, c.texto)))
        : null,
      fonte ? el('p', {}, fonte) : null),
    el('div', { class: 'card__acoes' },
      detalhe('O que fazer antes de abastecer',
        fazer.length
          ? el('ul', { class: 'resultado__lista' }, fazer.map((t) => el('li', {}, t)))
          : el('p', {}, 'Nada especial: é só abastecer.')),
      detalhe('Como calcular', el('ol', { class: 'resultado__passos' }, jeito.explicacao.map((passo) => el('li', {}, passo))))),
  );
}

function listaComFonte(itens) {
  return el('ul', { class: 'resultado__lista' }, itens.map((i) => {
    const fonte = linkFonte(i.fonte_url, 'fonte');
    return el('li', {}, i.texto, fonte ? ' (' : null, fonte, fonte ? ')' : null);
  }));
}

/**
 * @param {object} resultado  saída de calcularAbastecimento
 * @param {object} contexto   { semPerfil, raiz }  raiz = caminho até a raiz do site ("../")
 */
export function montarResultadoAbastecer(resultado, { semPerfil, raiz }) {
  const partes = [];
  const { jeitos } = resultado;
  const temPrograma = jeitos.some((j) => j.tipo === 'combustivel');

  if (semPerfil) {
    partes.push(alerta('info', 'Mostrando com todos os cartões e programas',
      el('p', {}, 'Você ainda não disse quais cartões e programas tem. Por isso a conta usa todos os que conhecemos.'),
      el('a', { class: 'botao botao--secundario', href: `${raiz}#/perfil` }, 'Cadastrar os meus')));
  }
  if (resultado.falta_preco.length) {
    partes.push(alerta('info', 'Informe o preço do litro para ver mais',
      el('p', {}, 'Algumas regras contam pontos na outra medida. Com o preço que aparece na bomba, a gente converte. O preço não fica guardado.'),
      el('ul', { class: 'resultado__lista' }, resultado.falta_preco.map((f) => el('li', {}, f.texto)))));
  }
  if (jeitos.some((j) => j.tem_dado_antigo)) {
    partes.push(alerta('aviso', 'Alguns dados podem estar desatualizados',
      'Parte do que usamos foi conferido há mais de 14 dias. As regras podem ter mudado: confira no app do posto antes de abastecer.'));
  }

  if (jeitos.length) {
    if (!temPrograma) {
      partes.push(alerta('info', 'Nenhum programa de posto vale para este abastecimento',
        semPerfil
          ? 'Abaixo está o que cada cartão rende num abastecimento normal, começando pelo melhor.'
          : 'Pelo menos não com os programas que você marcou. Abaixo está o que o seu cartão rende num abastecimento normal.'));
    }
    const [melhor, ...demais] = jeitos;
    partes.push(el('h3', { class: 'resultado__secao' }, 'O melhor jeito de abastecer'));
    partes.push(card(melhor, 0));
    if (palavrasQueAparecem(jeitos).milheiro) partes.push(termo('milheiro'));
    if (demais.length) {
      partes.push(el('h3', { class: 'resultado__secao' }, demais.length === 1 ? 'Outro jeito' : `Outros ${demais.length} jeitos`));
      // Sem perfil, a conta usa todos os cartões e a lista fica longa: os
      // primeiros ficam à vista e o resto, um clique abaixo.
      const visiveis = demais.slice(0, OUTROS_A_VISTA);
      const resto = demais.slice(OUTROS_A_VISTA);
      partes.push(el('div', { class: 'pilha resultado__demais' }, visiveis.map((j, i) => card(j, i + 1))));
      if (resto.length) {
        partes.push(el('details', { class: 'termo' },
          el('summary', {}, `Ver mais ${resto.length} ${resto.length === 1 ? 'jeito' : 'jeitos'}`),
          el('div', { class: 'pilha resultado__demais' }, resto.map((j, i) => card(j, i + 1 + OUTROS_A_VISTA)))));
      }
    }
  }

  if (resultado.fora_do_perfil.length) {
    partes.push(el('h3', { class: 'resultado__secao' }, 'Dá para ganhar mais'));
    partes.push(el('div', { class: 'card pilha--sm' },
      el('p', {}, 'Estes programas de posto não estão no seu perfil. Se você participa, marque em "Meu perfil".'),
      listaComFonte(resultado.fora_do_perfil),
      el('a', { class: 'botao botao--secundario', href: `${raiz}#/perfil` }, 'Mudar meu perfil')));
  }
  if (resultado.a_confirmar.length || resultado.outro_combustivel.length) {
    partes.push(el('h3', { class: 'resultado__secao' }, 'Fora da conta'));
    partes.push(el('div', { class: 'card pilha--sm' },
      resultado.a_confirmar.length ? el('p', { class: 'resultado__subtitulo' }, 'Ainda sem número confirmado') : null,
      resultado.a_confirmar.length ? listaComFonte(resultado.a_confirmar) : null,
      resultado.outro_combustivel.length ? el('p', { class: 'resultado__subtitulo' }, 'Não pontua este combustível') : null,
      resultado.outro_combustivel.length ? listaComFonte(resultado.outro_combustivel) : null));
  }

  return el('div', { class: 'pilha' }, partes);
}
