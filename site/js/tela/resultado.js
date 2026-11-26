// Monta o resultado na tela a partir do que o motor devolveu.
// A tela só exibe: toda conta vem de calcularJeitosDeComprar.

import { el } from './dom.js';
import { fraseSemPontos, separarJeitos } from './primeira-visita.js';
import {
  aLoja, destaqueDoJeito, fraseDoJeito, haQuantoTempo, palavrasQueAparecem, seloDeConferencia, siteDaFonte, textoValidade,
  textosAntesDeComprar, textosConferido,
} from './textos.js';
import { formatarData, naLoja } from '../motor/index.js';

/** Link para fora do site: só https, sem passar quem somos. */
function linkDaFonte(url, texto, rotuloOculto) {
  if (!siteDaFonte(url)) return null;
  return el('a', { href: url, rel: 'noopener noreferrer', class: 'fonte__link' },
    texto, rotuloOculto ? el('span', { class: 'visualmente-oculto' }, rotuloOculto) : null);
}

/** "Conferido hoje (25/11/2026) · Fonte: livelo.com.br": bem à vista, logo abaixo do número. */
function seloDoCard(jeito) {
  const selo = seloDeConferencia(jeito);
  if (!selo) return null;
  return el('p', { class: `fonte${selo.antigo ? ' fonte--antiga' : ''}` },
    el('span', { class: 'fonte__icone', 'aria-hidden': 'true' }, selo.antigo ? '!' : '✓'),
    el('span', {}, selo.texto),
    selo.site ? el('span', {}, ' · Fonte: ', linkDaFonte(selo.fonte_url, selo.site)) : null);
}

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

function blocoDestaques(jeito) {
  const lista = jeito.destaques_da_oferta ?? [];
  if (!lista.length) return null;
  return el('div', { class: 'resultado__destaques' },
    el('p', { class: 'resultado__subtitulo' }, 'Rende mais nesta oferta'),
    el('ul', { class: 'resultado__lista' }, lista.map((t) => el('li', {}, t))),
    el('p', { class: 'texto-suave texto-pequeno' }, 'A conta acima usa a regra geral da oferta. Se o seu produto for desses, ele rende mais.'));
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
    seloDoCard(jeito),
    el('div', { class: 'card__bloco' },
      el('p', { id: `${id}-frase` }, fraseDoJeito(jeito, nomeLoja)),
      destaque.emReais
        ? el('p', { class: 'texto-suave texto-pequeno numeros' }, `Total: ${jeito.total_pontos_texto === '1' ? '1 ponto' : `${jeito.total_pontos_texto} pontos`}`)
        : null),
    blocoDestaques(jeito),
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
          conferido.map((c) => el('li', { class: c.antigo ? 'resultado__antigo' : null },
            c.texto, c.site ? '. ' : null, c.site ? linkDaFonte(c.fonte_url, `Fonte: ${c.site}`) : null)))
        : null),
    el('div', { class: 'card__acoes' }, blocoAntesDeComprar(jeito), blocoComoCalcular(jeito)),
  );
}

/** "Conferimos: a Livelo diz que a parceria na Amazon está inativa (25/11/2026, fonte)". */
function blocoSemParceria(loja, nomePrograma = (id) => id) {
  const lista = loja.sem_parceria ?? [];
  if (!lista.length) return null;
  return el('div', { class: 'pilha--sm' },
    el('p', { class: 'resultado__subtitulo' }, 'O que conferimos'),
    el('ul', { class: 'resultado__lista' }, lista.map((s) => el('li', {},
      `${s.motivo} Conferido ${haQuantoTempo(diasDesde(s.verificado_em))} (${formatarData(s.verificado_em)}). `,
      linkDaFonte(s.fonte_url, `Fonte: ${siteDaFonte(s.fonte_url)}`, ` (${nomePrograma(s.programa_id)})`)))));
}

/** Dias entre a data (AAAA-MM-DD) e hoje no aparelho. Só para o texto "há N dias". */
function diasDesde(data) {
  const [a, m, d] = data.split('-').map(Number);
  const hoje = new Date();
  const ms = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()) - Date.UTC(a, m - 1, d);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * @param {object[]} jeitos   saída do motor, do melhor ao pior
 * @param {object} contexto   { loja, valorTexto, semPerfil, ajuste?, valeAPena?, faltaDolar?, nomePrograma? }
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
    partes.push(alerta('info', `${aLoja(loja)} não tem oferta de pontos valendo hoje`,
      el('p', {}, semPerfil
        ? 'Abaixo está o que os cartões de pontos rendem numa compra normal, começando pelo melhor.'
        : 'Pelo menos não para os programas que você marcou. Abaixo está o que o seu cartão rende numa compra normal.'),
      blocoSemParceria(loja, contexto.nomePrograma)));
  }
  if (jeitos.some((j) => j.tem_dado_antigo)) {
    partes.push(alerta('aviso', 'Alguns dados podem estar desatualizados',
      'Parte do que usamos foi conferido há mais de 14 dias. As regras podem ter mudado: confira na loja e no programa antes de comprar.'));
  }

  partes.push(el('h3', { class: 'resultado__secao' }, 'O melhor jeito de comprar'));
  partes.push(card(melhor, 0, loja));

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
    partes.push(el('div', { class: 'pilha resultado__demais' }, abertos.map((j, i) => card(j, i + 1, loja))));
    if (recolhidos.length) {
      partes.push(el('details', { class: 'termo resultado__mais' },
        el('summary', {}, `Ver mais ${recolhidos.length} ${recolhidos.length === 1 ? 'jeito' : 'jeitos'}`),
        el('div', { class: 'pilha resultado__demais' }, recolhidos.map((j, i) => card(j, i + 1 + abertos.length, loja)))));
    }
  }
  if (semPontos.length) {
    partes.push(el('p', { class: 'texto-suave texto-pequeno resultado__sem-pontos' }, fraseSemPontos(semPontos, faltaDolar)));
  }

  return el('div', { class: 'pilha', 'data-resumo': `${valorTexto} ${naLoja(loja)}` }, partes);
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
