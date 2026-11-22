// Textos dos cards de resultado. Funções puras: recebem um "jeito de comprar"
// que já saiu do motor e só escolhem as palavras. Nenhuma conta é feita aqui.

import { formatarData } from '../motor/index.js';

/** Data e hora locais do aparelho no formato que o motor pede ("AAAA-MM-DDTHH:MM"). */
export function agoraLocal(data) {
  const dois = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}` +
    `T${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

function pontos(texto) {
  return texto === '1' ? '1 ponto' : `${texto} pontos`;
}

/** Frase "compre assim": loja, programa e cartão. */
export function fraseDoJeito(jeito, nomeLoja) {
  const programa = jeito.programa?.nome;
  const cartao = jeito.cartao?.nome;
  if (jeito.tipo === 'oferta') {
    return cartao
      ? `Compre na ${nomeLoja} pela oferta do ${programa} e pague com o cartão ${cartao}.`
      : `Compre na ${nomeLoja} pela oferta do ${programa}.`;
  }
  if (cartao) return `Compre direto na ${nomeLoja} e pague com o cartão ${cartao}. Os pontos vão para o ${programa}.`;
  return `Sem oferta e sem cartão, esta compra na ${nomeLoja} não rende pontos.`;
}

/**
 * O número grande do card e a legenda embaixo dele.
 * Com valor em reais, o real é o destaque. Sem ele, os pontos.
 */
export function destaqueDoJeito(jeito) {
  const total = jeito.total_pontos_texto;
  if (jeito.total_pontos === 0) {
    return { principal: 'Nenhum ponto', legenda: 'Com o que sabemos até agora, esta compra não rende pontos. O porquê está logo abaixo.', emReais: false };
  }
  if (jeito.valor_estimado_em_reais) {
    return {
      principal: jeito.valor_estimado_em_reais.texto,
      legenda: `é quanto valem, em média, os ${pontos(total)} desta compra`,
      emReais: true,
    };
  }
  return {
    principal: pontos(total),
    legenda: `Ainda não dá para dizer quanto isso vale em reais: falta o valor do milheiro do ${jeito.programa?.nome ?? 'programa'}.`,
    emReais: false,
  };
}

/** Linha da validade. Sem oferta, os pontos do cartão não vencem com a loja. */
export function textoValidade(jeito) {
  if (jeito.validade_da_oferta) return `Validade da oferta: ${jeito.validade_da_oferta.texto.replace(/^De /, 'de ')}`;
  return 'Sem oferta da loja: são só os pontos de sempre do cartão, sem data para acabar.';
}

/** "Conferimos: oferta X em 22/11/2026; cartão Y em 20/11/2026 (há 16 dias)". */
export function textosConferido(jeito) {
  return (jeito.conferido_em ?? []).map((c) => {
    const quando = c.dias === 0 ? 'hoje' : c.dias === 1 ? 'ontem' : `há ${c.dias} dias`;
    return {
      texto: `${c.rotulo[0].toUpperCase()}${c.rotulo.slice(1)}: conferido em ${formatarData(c.verificado_em)} (${quando})`,
      antigo: c.antigo,
    };
  });
}

/** Lista "o que fazer antes de comprar": condições e o que renderia mais. */
export function textosAntesDeComprar(jeito) {
  const fazer = [...jeito.condicoes_a_cumprir];
  if (jeito.prazo_de_credito?.texto) fazer.push(jeito.prazo_de_credito.texto);
  return {
    fazer,
    daPraGanharMais: (jeito.o_que_voce_ganharia_se ?? []).map((h) => h.texto),
  };
}

/** O motor fala em clube ou milheiro neste card? (Para explicar a palavra na tela.) */
export function palavrasQueAparecem(jeitos) {
  const tudo = JSON.stringify(jeitos.map((j) => [j.condicoes_a_cumprir, j.explicacao, j.avisos, j.o_que_voce_ganharia_se.map((h) => h.texto)]));
  return { clube: /clube/i.test(tudo), milheiro: /milheiro/i.test(tudo) };
}

/**
 * Frase curta para o leitor de tela quando o resultado fica pronto:
 * o número do melhor jeito e como comprar. O resto está na tela, em ordem.
 */
export function anuncioDoResultado(jeitos, { nomeLoja, valorTexto }) {
  const [melhor] = jeitos;
  if (!melhor) return `Resultado para ${valorTexto} na ${nomeLoja}: nenhum jeito de comprar encontrado.`;
  const destaque = destaqueDoJeito(melhor);
  const numero = destaque.emReais
    ? `${destaque.principal} em pontos (${pontos(melhor.total_pontos_texto)})`
    : destaque.principal.toLowerCase();
  const semOferta = jeitos.some((j) => j.tipo === 'oferta') ? '' : ` A ${nomeLoja} não tem oferta de pontos valendo hoje.`;
  const outros = jeitos.length > 1 ? ` Há mais ${jeitos.length - 1} ${jeitos.length === 2 ? 'jeito' : 'jeitos'} logo abaixo.` : '';
  return `Resultado para ${valorTexto} na ${nomeLoja}.${semOferta} O melhor jeito rende ${numero}. ${fraseDoJeito(melhor, nomeLoja)}${outros}`;
}
