// Tela "Quanto rende abastecer": leitura dos campos e textos dos cards.
// Funções puras. Nenhuma conta de pontos é feita aqui: tudo vem do motor
// (calcularAbastecimento). Aqui só se lê o que a pessoa digitou e se escolhem
// as palavras.

import { LITROS_MAXIMOS_ML, PRECO_MAXIMO_MILESIMOS, formatarLitros, formatarPrecoLitro } from '../motor/index.js';

/**
 * Litros digitados → mililitros (inteiro). Aceita "40", "40,5", "40.5" e até
 * 3 casas depois da vírgula. Devolve { ml, erro }: ml null quando vazio ou inválido.
 */
export function lerLitros(texto) {
  const limpo = String(texto ?? '').replace(/\s/g, '').replace(/l(itros?)?$/i, '');
  if (!limpo) return { ml: null, erro: 'Digite quantos litros você vai abastecer.' };
  const m = /^(\d{1,9})(?:[,.](\d{1,3}))?$/.exec(limpo);
  if (!m) return { ml: null, erro: 'Use só números e, se precisar, vírgula. Por exemplo: 40 ou 40,5.' };
  const ml = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  if (ml === 0) return { ml: null, erro: 'A quantidade precisa ser maior que zero.' };
  if (ml > LITROS_MAXIMOS_ML) return { ml: null, erro: `O máximo é ${formatarLitros(LITROS_MAXIMOS_ML)}.` };
  return { ml, erro: '' };
}

const DIGITOS_PRECO = String(PRECO_MAXIMO_MILESIMOS).length;

/**
 * Máscara do preço do litro, jeito caixa eletrônico com 3 casas (como na bomba):
 * "6" → 0,006; "6299" → 6,299. Devolve { milesimos (inteiro) | null, texto }.
 * Vazio ou só zeros dá null: preço não informado (ele é opcional).
 */
export function mascaraPreco(texto) {
  const digitos = String(texto ?? '').replace(/\D/g, '').replace(/^0+/, '').slice(0, DIGITOS_PRECO);
  if (!digitos) return { milesimos: null, texto: '' };
  const milesimos = Number(digitos);
  return { milesimos, texto: formatarPrecoLitro(milesimos).replace(/^R\$ /, '') };
}

function nomeNoMeio(nome) {
  return /^[A-Z]{2}/.test(nome) ? nome : nome[0].toLowerCase() + nome.slice(1);
}

/** Título do resultado: "40 litros de gasolina comum" ou "R$ 200,00 de etanol comum, na Shell". */
export function tituloDoAbastecimento(resumo, nomeRede) {
  const quanto = resumo.informado === 'litros' ? resumo.litros_texto : resumo.reais_texto;
  return `${quanto} de ${nomeNoMeio(resumo.combustivel.nome)}${nomeRede ? `, nos postos ${nomeRede}` : ''}`;
}

/** Frase "abasteça assim": rede, programa do posto e cartão. */
export function fraseDoAbastecimento(jeito) {
  const cartao = jeito.cartao?.nome;
  if (jeito.tipo === 'combustivel') {
    const base = `Abasteça nos postos ${jeito.rede.nome} usando o ${jeito.programa_do_posto.nome}`;
    return cartao ? `${base} e pague com o cartão ${cartao}.` : `${base}.`;
  }
  const onde = jeito.rede ? `nos postos ${jeito.rede.nome}` : 'em qualquer posto';
  if (cartao) return `Abasteça ${onde} e pague com o cartão ${cartao}. Os pontos vão para o ${jeito.programa.nome}.`;
  return 'Sem programa do posto e sem cartão, este abastecimento não rende pontos.';
}

/** Linha da validade: regra do programa ou só o cartão. */
export function textoValidadeDoAbastecimento(jeito) {
  if (jeito.validade_da_regra) return `Validade da regra: ${jeito.validade_da_regra.texto}`;
  return 'Sem programa do posto: são só os pontos de sempre do cartão.';
}

/** O que fazer antes de abastecer: condições, prazo e validade dos pontos. */
export function textosAntesDeAbastecer(jeito) {
  const fazer = [...jeito.condicoes_a_cumprir];
  if (jeito.prazo_de_credito?.texto) fazer.push(jeito.prazo_de_credito.texto);
  if (jeito.validade_dos_pontos?.texto) fazer.push(jeito.validade_dos_pontos.texto);
  return fazer;
}

function pontos(texto) {
  return texto === '1' ? '1 ponto' : `${texto} pontos`;
}

/** Frase curta para o leitor de tela quando o resultado fica pronto. */
export function anuncioDoAbastecimento(resultado, titulo) {
  const [melhor] = resultado.jeitos;
  if (!melhor) {
    return resultado.falta_preco.length
      ? `Resultado para ${titulo}: informe o preço do litro para calcular.`
      : `Resultado para ${titulo}: nenhum jeito de ganhar pontos encontrado.`;
  }
  const numero = melhor.valor_estimado_em_reais && melhor.total_pontos > 0
    ? `${melhor.valor_estimado_em_reais.texto} em pontos (${pontos(melhor.total_pontos_texto)})`
    : melhor.total_pontos > 0 ? pontos(melhor.total_pontos_texto) : 'nenhum ponto';
  const outros = resultado.jeitos.length > 1
    ? ` Há mais ${resultado.jeitos.length - 1} ${resultado.jeitos.length === 2 ? 'jeito' : 'jeitos'} logo abaixo.`
    : '';
  return `Resultado para ${titulo}. O melhor jeito rende ${numero}. ${fraseDoAbastecimento(melhor)}${outros}`;
}
