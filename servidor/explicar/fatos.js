// Monta os FATOS que o modelo recebe: o resultado que o motor já calculou,
// com as mesmas frases que a tela mostra. O modelo só explica isto; não
// recebe dados soltos para fazer conta nenhuma.
//
// Também devolve o que a conferência da resposta (saida.js) precisa:
//   - numeros:  todos os números que aparecem nos fatos (a resposta só pode
//               usar estes);
//   - nomesDeFora: nomes de lojas, programas e cartões dos nossos dados que
//               NÃO aparecem no resultado (citar um deles é inventar oferta).

import {
  A_CONFIRMAR, ESCALA_PONTOS, formatarCentavos, formatarData, formatarPontos, formatarValor,
} from '../../site/js/motor/index.js';
import { destaqueDoJeito, fraseDoJeito, textosAntesDeComprar, textoValidade } from '../../site/js/tela/textos.js';
import { LIMITES } from './config.js';

/** O que nunca está nos nossos dados. O modelo deve dizer "não sei" sobre isto. */
export const O_QUE_NAO_SABEMOS = Object.freeze([
  'o preço da assinatura do clube de cada programa',
  'o preço do produto em outras lojas',
  'juros, parcelamento e tarifas do cartão (além da anuidade, quando aparece aqui)',
  'se a pessoa vai conseguir usar os pontos antes de vencerem',
  'ofertas de outras lojas ou de programas que não aparecem neste resultado',
  'qualquer coisa que tenha mudado depois da data em que conferimos os dados',
]);

function anuidade(cartao) {
  if (!cartao) return null;
  const v = cartao.anuidade_brl;
  if (Number.isSafeInteger(v)) return v === 0 ? 'sem anuidade' : `${formatarCentavos(v)} por ano`;
  return 'não informada nos nossos dados';
}

/** Pontos (number do motor, até 6 casas) de volta para a escala interna, em BigInt. */
function escala(pontos) {
  return BigInt(Math.round(pontos * Number(ESCALA_PONTOS)));
}

/**
 * Diferenças já calculadas, para o modelo não precisar fazer conta (e para a
 * conferência aceitar esses números). Mesmo jeito do motor: valor em
 * bilionésimos de centavo = pontos na escala × milheiro em centavos.
 */
export function aMaisSe(hipotese, jeito) {
  const hip = escala(hipotese.pontos_do_programa);
  const diferenca = hip - escala(jeito.pontos_do_programa);
  const valor = hipotese.valor_estimado_em_reais?.bilionesimos_de_centavo;
  const milheiro = typeof valor === 'bigint' && hip > 0n ? valor / hip : null;
  return {
    o_que_mudaria: hipotese.texto,
    pontos_a_mais: formatarPontos(diferenca),
    valor_a_mais_em_reais: milheiro === null ? 'não dá para estimar (falta o valor do milheiro)' : formatarValor(diferenca * milheiro),
  };
}

export function comparadoAoMelhor(jeito, melhor) {
  const menos = escala(melhor.total_pontos) - escala(jeito.total_pontos);
  const a = melhor.valor_estimado_em_reais?.bilionesimos_de_centavo;
  const b = jeito.valor_estimado_em_reais?.bilionesimos_de_centavo;
  return {
    pontos_a_menos_que_o_melhor: formatarPontos(menos),
    valor_a_menos_que_o_melhor: typeof a === 'bigint' && typeof b === 'bigint' && a >= b
      ? formatarValor(a - b)
      : 'não dá para comparar em reais',
  };
}

function fatoDoJeito(jeito, posicao, loja, dados, melhor) {
  const destaque = destaqueDoJeito(jeito);
  const { fazer } = textosAntesDeComprar(jeito);
  const cartao = jeito.cartao ? dados.cartoes.find((c) => c.id === jeito.cartao.id) : null;
  return {
    posicao,
    como_comprar: fraseDoJeito(jeito, loja.nome),
    resultado: `${destaque.principal}: ${destaque.legenda}`,
    total_de_pontos: jeito.total_pontos_texto,
    valor_estimado_em_reais: jeito.valor_estimado_em_reais?.texto ?? 'não dá para estimar (falta o valor do milheiro)',
    validade: textoValidade(jeito),
    o_que_fazer_antes_de_comprar: fazer,
    da_para_ganhar_mais_se: (jeito.o_que_voce_ganharia_se ?? []).map((h) => aMaisSe(h, jeito)),
    ...(posicao > 1 ? comparadoAoMelhor(jeito, melhor) : {}),
    fique_de_olho: jeito.avisos,
    como_calculamos: jeito.explicacao,
    anuidade_do_cartao: anuidade(cartao),
  };
}

/**
 * @param {object[]} jeitos   saída de calcularJeitosDeComprar
 * @param {object} contexto   { loja, valor_centavos, semPerfil, hoje: "AAAA-MM-DD..." }
 * @param {object} dados      { lojas, programas, cartoes }
 */
export function montarFatos(jeitos, { loja, valor_centavos: valor, semPerfil, hoje }, dados) {
  const usados = jeitos.slice(0, LIMITES.jeitos);
  const fatos = {
    compra: {
      loja: loja.nome,
      valor: formatarCentavos(valor),
      data_da_conta: formatarData(hoje.slice(0, 10)),
    },
    perfil: semPerfil
      ? 'A pessoa não marcou os cartões e programas dela. A conta usou todos os que conhecemos, sem clube.'
      : 'A conta usou só os cartões e programas que a pessoa marcou em "Meu perfil".',
    jeitos_de_comprar: usados.map((j, i) => fatoDoJeito(j, i + 1, loja, dados, jeitos[0])),
    jeitos_que_ficaram_de_fora: Math.max(0, jeitos.length - usados.length),
    ha_oferta_da_loja: jeitos.some((j) => j.tipo === 'oferta'),
    o_que_nao_sabemos: O_QUE_NAO_SABEMOS,
  };
  // < e > viram \u003c e \u003e (o JSON continua o mesmo): nenhum texto dos
  // dados consegue fechar a etiqueta que cerca os fatos no prompt.
  const texto = JSON.stringify(fatos, null, 1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return { fatos, texto, numeros: numerosDe(texto), nomesDeFora: nomesDeFora(texto, dados) };
}

/**
 * Números de um texto, normalizados: "1.299,00" → "1299,00" e "1299";
 * "17" → "17". Sem ponto de milhar, vírgula decimal, como na tela.
 */
export function numerosDe(texto) {
  const achados = new Set();
  for (const m of texto.matchAll(/\d[\d.]*(?:,\d+)?/g)) {
    const bruto = m[0].replace(/\.$/, '');
    const semMilhar = bruto.replace(/\.(?=\d{3}(?:\D|$))/g, '');
    achados.add(semMilhar);
    const [inteiro, decimais] = semMilhar.split(',');
    if (decimais !== undefined && /^0+$/.test(decimais)) achados.add(inteiro);
    // "17.5" de cartões com ponto decimal (ex.: 2.5 pontos por dólar)
    if (/^\d+\.(?:\d{1,2}|\d{4,})$/.test(bruto)) achados.add(bruto.replace('.', ','));
  }
  return achados;
}

export function normalizarNome(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function nomesDeFora(texto, dados) {
  const presentes = normalizarNome(texto);
  const nomes = [...dados.lojas, ...dados.programas, ...dados.cartoes]
    .map((r) => r.nome)
    .filter((n) => typeof n === 'string' && n !== A_CONFIRMAR && n.trim().length >= 3);
  return [...new Set(nomes.map(normalizarNome))].filter((n) => !presentes.includes(n));
}
