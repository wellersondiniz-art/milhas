// Contas da "decisão final": pontos, cashback ou desconto? E a anuidade do
// cartão compensa?
//
// Mesmas regras do resto do motor (CLAUDE.md): funções puras, dinheiro em
// centavos inteiros na entrada, contas em BigInt com escala fixa e
// arredondamento só na exibição.
//   - valores em bilionésimos de centavo (ESCALA_VALOR)
//   - pontos × 1.000.000 (ESCALA_PONTOS)
//   - porcentagens × 100 (5,25% = 525), para aceitar até 2 casas
//   - cotação do dólar × 10.000 (R$ 5,3456 = 53456)
//
// Dado que falta (milheiro, anuidade ou pontos A_CONFIRMAR) não vira número
// inventado: a resposta diz o que dá para dizer e por que não dá o resto.

import { A_CONFIRMAR, ESCALA_COTACAO } from './calcular.js';
import {
  ESCALA_PONTOS, ESCALA_VALOR, formatarCentavos, formatarCotacao, formatarNumero, formatarPontos, formatarValor,
} from './formatar.js';

/** Porcentagem × 100: 100% = 10.000. */
export const ESCALA_PORCENTO = 10_000n;
/** Maior porcentagem aceita (100,00%). */
export const PORCENTO_MAXIMO = 10_000;

function erro(msg) {
  return new Error(`decisão: ${msg}`);
}

function centavosValidos(v, nome) {
  if (!Number.isSafeInteger(v) || v < 0) throw erro(`${nome} precisa ser centavos inteiros >= 0 (recebido: ${v})`);
  return BigInt(v);
}

function porcentoValido(v, nome) {
  if (!Number.isSafeInteger(v) || v < 0 || v > PORCENTO_MAXIMO) {
    throw erro(`${nome} precisa ser um inteiro de 0 a ${PORCENTO_MAXIMO} (porcentagem × 100; recebido: ${v})`);
  }
  return BigInt(v);
}

/** Divisão inteira arredondando para cima (a, b > 0). */
function tetoDiv(a, b) {
  return (a + b - 1n) / b;
}

/** 525 → "5,25%"; 500 → "5%". */
export function formatarPorcento(x100) {
  const v = BigInt(x100);
  const inteiro = v / 100n;
  const resto = v % 100n;
  if (resto === 0n) return `${inteiro}%`;
  return `${inteiro},${resto.toString().padStart(2, '0').replace(/0$/, '')}%`;
}

// ---------------------------------------------------------------------------
// Pontos x cashback x desconto

/**
 * Compara, numa compra, o valor dos pontos com o dinheiro de um cashback ou
 * de um desconto. Cada alternativa é "um ou outro": em geral o cashback de um
 * site parceiro não soma com a oferta de pontos, e pagar no Pix para ter
 * desconto tira os pontos do cartão.
 *
 * @param {object} entrada
 * @param {number} entrada.valor_compra_centavos
 * @param {bigint} entrada.pontos_escalados        total de pontos × 1.000.000 (saída do motor)
 * @param {bigint|null} entrada.valor_pontos       valor dos pontos em bilionésimos de centavo, ou null sem milheiro
 * @param {number} [entrada.cashback_porcento]     porcentagem × 100 (500 = 5%)
 * @param {number} [entrada.desconto_porcento]     porcentagem × 100
 * @param {number} [entrada.desconto_centavos]     desconto em reais (centavos)
 */
export function compararComDinheiro(entrada) {
  const valor = centavosValidos(entrada.valor_compra_centavos, 'valor_compra_centavos');
  const pontos = entrada.pontos_escalados;
  if (typeof pontos !== 'bigint' || pontos < 0n) throw erro('pontos_escalados precisa ser BigInt >= 0');
  const valorPontos = entrada.valor_pontos;
  if (valorPontos !== null && (typeof valorPontos !== 'bigint' || valorPontos < 0n)) {
    throw erro('valor_pontos precisa ser BigInt >= 0 ou null');
  }

  const opcoes = [];
  opcoes.push({
    tipo: 'pontos',
    rotulo: `Pontos (${formatarPontos(pontos)})`,
    nome: 'os pontos',
    valor: valorPontos,
    texto: valorPontos === null ? 'valor em reais desconhecido' : `uns ${formatarValor(valorPontos)}`,
    certo: false,
  });

  if (entrada.cashback_porcento !== undefined && entrada.cashback_porcento !== null) {
    const p = porcentoValido(entrada.cashback_porcento, 'cashback_porcento');
    if (p > 0n) {
      const v = (valor * p * ESCALA_VALOR) / ESCALA_PORCENTO;
      opcoes.push({ tipo: 'cashback', rotulo: `Cashback de ${formatarPorcento(p)}`, nome: `o cashback de ${formatarPorcento(p)}`, valor: v, texto: formatarValor(v), certo: true });
    }
  }

  let desconto = null;
  if (entrada.desconto_porcento !== undefined && entrada.desconto_porcento !== null) {
    const p = porcentoValido(entrada.desconto_porcento, 'desconto_porcento');
    if (p > 0n) desconto = { v: (valor * p * ESCALA_VALOR) / ESCALA_PORCENTO, rotulo: `Desconto de ${formatarPorcento(p)}`, nome: `o desconto de ${formatarPorcento(p)}` };
  } else if (entrada.desconto_centavos !== undefined && entrada.desconto_centavos !== null) {
    const c = centavosValidos(entrada.desconto_centavos, 'desconto_centavos');
    if (c > valor) throw erro('o desconto não pode ser maior que a compra');
    if (c > 0n) desconto = { v: c * ESCALA_VALOR, rotulo: `Desconto de ${formatarCentavos(c)}`, nome: 'o desconto' };
  }
  if (desconto) opcoes.push({ tipo: 'desconto', rotulo: desconto.rotulo, nome: desconto.nome, valor: desconto.v, texto: formatarValor(desconto.v), certo: true });

  const dinheiro = opcoes.filter((o) => o.certo);
  const melhorDinheiro = dinheiro.reduce((m, o) => (!m || o.valor > m.valor ? o : m), null);

  // Milheiro de empate: a partir de quanto valem 1.000 pontos para os pontos
  // empatarem com o melhor dinheiro. valor = pontos × milheiro ÷ 1.000, então
  // milheiro (centavos) = dinheiro (bilionésimos) ÷ pontos (× 1.000.000).
  let milheiroDeEmpate = null;
  if (melhorDinheiro && pontos > 0n) {
    milheiroDeEmpate = tetoDiv(melhorDinheiro.valor, pontos);
  }

  let vencedor = null;
  let empate = false;
  let veredito;
  if (!melhorDinheiro) {
    veredito = 'Informe um cashback ou um desconto para comparar com os pontos.';
  } else if (pontos === 0n) {
    vencedor = melhorDinheiro.tipo;
    veredito = `Esta compra não rende pontos: fique com ${melhorDinheiro.nome} (${melhorDinheiro.texto}).`;
  } else if (valorPontos === null) {
    veredito =
      `Não sabemos quanto valem esses pontos. Eles só ganham ${melhorDinheiro.nome.replace(/^o /, 'do ')} ` +
      `(${melhorDinheiro.texto}) se 1.000 pontos valerem mais que ${formatarCentavos(milheiroDeEmpate)}.`;
  } else if (valorPontos === melhorDinheiro.valor) {
    empate = true;
    veredito = `Empate: os pontos valem o mesmo que ${melhorDinheiro.nome}. Na dúvida, dinheiro é certo e não vence.`;
  } else if (valorPontos > melhorDinheiro.valor) {
    vencedor = 'pontos';
    veredito =
      `Os pontos valem mais: uns ${formatarValor(valorPontos)} contra ${melhorDinheiro.texto}. ` +
      `Mas só se você usar 1.000 pontos por mais de ${formatarCentavos(milheiroDeEmpate)}; abaixo disso, ${melhorDinheiro.nome} rende mais.`;
  } else {
    vencedor = melhorDinheiro.tipo;
    veredito =
      `${melhorDinheiro.nome[0].toUpperCase()}${melhorDinheiro.nome.slice(1)} rende mais: ${melhorDinheiro.texto} contra uns ${formatarValor(valorPontos)} em pontos. ` +
      `Os pontos só ganhariam se 1.000 pontos valessem mais que ${formatarCentavos(milheiroDeEmpate)}.`;
  }

  const ordem = [...opcoes].sort((a, b) => {
    if (a.valor === b.valor) return a.certo === b.certo ? 0 : a.certo ? -1 : 1;
    if (a.valor === null) return 1;
    if (b.valor === null) return -1;
    return a.valor > b.valor ? -1 : 1;
  });

  return {
    opcoes: ordem,
    vencedor,
    empate,
    milheiro_de_empate_centavos: milheiroDeEmpate === null ? null : Number(milheiroDeEmpate),
    veredito,
  };
}

// ---------------------------------------------------------------------------
// Compensa a anuidade?

/**
 * Faz a conta de um ano de cartão: pontos que o gasto rende, quanto valem,
 * menos a anuidade e menos o que um cartão sem anuidade daria de volta.
 *
 * @param {object} entrada
 * @param {object} entrada.cartao                  registro de cartoes.json
 * @param {number} entrada.gasto_mensal_centavos
 * @param {{centavos:number, doPerfil?:boolean}|null} entrada.milheiro   valor de 1.000 pontos do programa do cartão
 * @param {number|null} [entrada.cotacao]          reais por dólar × 10.000
 * @param {number} [entrada.cashback_alternativo_porcento]  cartão sem anuidade que devolve X% (× 100). Padrão: 0.
 */
export function calcularAnuidade(entrada) {
  const { cartao } = entrada;
  if (!cartao || typeof cartao.id !== 'string') throw erro('cartao precisa ser um registro de cartoes.json');
  const gastoMes = centavosValidos(entrada.gasto_mensal_centavos, 'gasto_mensal_centavos');
  const gastoAno = gastoMes * 12n;
  const cashback = porcentoValido(entrada.cashback_alternativo_porcento ?? 0, 'cashback_alternativo_porcento');
  const milheiro = entrada.milheiro ?? null;
  if (milheiro !== null && (!Number.isSafeInteger(milheiro.centavos) || milheiro.centavos < 0)) {
    throw erro('milheiro.centavos precisa ser centavos inteiros >= 0');
  }
  const cot = entrada.cotacao ?? null;
  if (cot !== null && (!Number.isSafeInteger(cot) || cot <= 0)) throw erro('cotacao precisa ser inteiro > 0');

  const anuidade = Number.isSafeInteger(cartao.anuidade_brl) && cartao.anuidade_brl >= 0 ? BigInt(cartao.anuidade_brl) : null;
  const confirmado = cartao.status !== A_CONFIRMAR;
  const passos = [];
  const avisos = [];
  passos.push(`Gasto no ano: ${formatarCentavos(gastoMes)} por mês × 12 = ${formatarCentavos(gastoAno)}.`);

  // Taxa de pontos por centavo gasto, como fração num/den sobre a escala de pontos:
  // pontos escalados = gasto (centavos) × num ÷ den.
  let taxa = null;
  if (!confirmado) {
    avisos.push(`Os pontos do cartão ${cartao.nome} ainda não estão confirmados; não entram na conta.`);
  } else if (typeof cartao.pontos_por_real === 'number' && cartao.pontos_por_real >= 0) {
    taxa = { num: BigInt(Math.round(cartao.pontos_por_real * 10_000)), den: 1n };
    taxa.conta = `${formatarCentavos(gastoAno)} × ${formatarNumero(cartao.pontos_por_real)} ponto(s) por real`;
  } else if (typeof cartao.pontos_por_dolar === 'number' && cartao.pontos_por_dolar >= 0) {
    if (cot === null) {
      avisos.push(`O cartão ${cartao.nome} rende pontos por dólar e falta a cotação do dólar.`);
    } else {
      // pontos × 1.000.000 = centavos × (ppd × 10.000) × 10.000 ÷ cotação × 10.000
      taxa = { num: BigInt(Math.round(cartao.pontos_por_dolar * 10_000)) * BigInt(ESCALA_COTACAO), den: BigInt(cot) };
      taxa.conta = `${formatarCentavos(gastoAno)} ÷ ${formatarCotacao(cot)} por dólar × ${formatarNumero(cartao.pontos_por_dolar)} ponto(s) por dólar`;
    }
  } else {
    avisos.push(`Os pontos do cartão ${cartao.nome} não estão confirmados; não entram na conta.`);
  }

  const pontosAno = taxa === null ? null : (gastoAno * taxa.num) / taxa.den;
  if (pontosAno !== null) passos.push(`Pontos no ano: ${taxa.conta} = ${formatarPontos(pontosAno)} pontos.`);

  const valorPontos = pontosAno !== null && milheiro !== null ? pontosAno * BigInt(milheiro.centavos) : null;
  if (pontosAno !== null && milheiro === null) avisos.push('O programa deste cartão não tem valor de milheiro; não dá para dizer quanto os pontos valem em reais.');
  if (valorPontos !== null) {
    passos.push(
      `Valor dos pontos: ${formatarPontos(pontosAno)} × ${formatarCentavos(milheiro.centavos)} por milheiro` +
      `${milheiro.doPerfil ? ' (valor que você informou)' : ' (estimativa)'} ÷ 1.000 = ${formatarValor(valorPontos)}.`,
    );
  }

  const alternativa = (gastoAno * cashback * ESCALA_VALOR) / ESCALA_PORCENTO;
  if (cashback > 0n) {
    passos.push(`Um cartão sem anuidade com ${formatarPorcento(cashback)} de cashback devolveria ${formatarValor(alternativa)} no mesmo ano.`);
  }

  if (anuidade === null) {
    avisos.push(`A anuidade do cartão ${cartao.nome} não está confirmada.`);
  } else {
    passos.push(`Anuidade: ${formatarCentavos(anuidade)} por ano.`);
  }

  // Saldo = valor dos pontos − anuidade − o que o cartão sem anuidade daria.
  const saldo = valorPontos !== null && anuidade !== null ? valorPontos - anuidade * ESCALA_VALOR - alternativa : null;

  // Gasto mensal de empate: 12 × G × (valor por centavo − cashback por centavo) = anuidade.
  // Valor por centavo (bilionésimos) = num × milheiro ÷ den; cashback por centavo = cashback × 10^9 ÷ 10^4.
  let empateMensal = null;
  let nuncaCompensa = false;
  if (taxa !== null && milheiro !== null && anuidade !== null) {
    const num = taxa.num * BigInt(milheiro.centavos) * ESCALA_PORCENTO - cashback * ESCALA_VALOR * taxa.den;
    const den = taxa.den * ESCALA_PORCENTO;
    if (anuidade > 0n) {
      if (num <= 0n) nuncaCompensa = true;
      else empateMensal = tetoDiv(anuidade * ESCALA_VALOR * den, 12n * num);
    }
  }

  let veredito;
  let situacao;
  if (saldo === null) {
    situacao = 'sem_conta';
    const pontosTexto = pontosAno === null ? '' : `O cartão renderia ${formatarPontos(pontosAno)} pontos por ano. `;
    veredito = `${pontosTexto}Sem ${anuidade === null ? 'a anuidade confirmada' : 'o valor dos pontos confirmado'}, não dá para dizer se compensa.`;
  } else if (saldo > 0n) {
    situacao = 'compensa';
    veredito = `Compensa: sobram uns ${formatarValor(saldo)} por ano depois de pagar a anuidade${cashback > 0n ? ' e de abrir mão do cashback' : ''}.`;
  } else if (saldo === 0n) {
    situacao = 'empata';
    veredito = 'Empata: os pontos pagam a anuidade e nada mais.';
  } else {
    situacao = 'nao_compensa';
    veredito = `Não compensa: faltam uns ${formatarValor(-saldo)} por ano para os pontos pagarem a anuidade${cashback > 0n ? ' e o cashback que você deixaria de ganhar' : ''}.`;
  }
  if (empateMensal !== null) {
    veredito += ` Passa a compensar com um gasto a partir de ${formatarCentavos(empateMensal)} por mês.`;
  } else if (nuncaCompensa) {
    veredito += ' Com esse valor de milheiro, nenhum gasto faz os pontos pagarem a anuidade.';
  }
  if (Number.isSafeInteger(cartao.anuidade_brl) && cartao.anuidade_brl > 0) {
    avisos.push('Muitos cartões dão desconto ou isenção da anuidade com gasto mínimo por mês; confira com o banco. Se o seu tiver, a conta melhora.');
  }

  return {
    cartao: { id: cartao.id, nome: cartao.nome },
    gasto_anual_centavos: Number(gastoAno),
    pontos_por_ano: pontosAno === null ? null : { escalados: pontosAno, texto: formatarPontos(pontosAno) },
    valor_dos_pontos: valorPontos === null ? null : { bilionesimos_de_centavo: valorPontos, texto: formatarValor(valorPontos) },
    anuidade_centavos: anuidade === null ? null : Number(anuidade),
    cashback_alternativo: cashback > 0n ? { bilionesimos_de_centavo: alternativa, texto: formatarValor(alternativa) } : null,
    saldo: saldo === null ? null : { bilionesimos_de_centavo: saldo, texto: formatarValor(saldo < 0n ? -saldo : saldo), negativo: saldo < 0n },
    situacao,
    gasto_mensal_de_empate_centavos: empateMensal === null ? null : Number(empateMensal),
    veredito,
    avisos,
    explicacao: passos,
  };
}

export { ESCALA_PONTOS };
