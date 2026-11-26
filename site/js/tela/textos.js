// Textos dos cards de resultado. Funções puras: recebem um "jeito de comprar"
// que já saiu do motor e só escolhem as palavras. Nenhuma conta é feita aqui.

import { ESTADOS, formatarData, naLoja, quandoVence } from '../motor/index.js';

/** Texto do selo de alerta quando a oferta vence em até 3 dias ("Vence hoje", "Vence em 3 dias"). null se não vence logo. */
export function seloDeVencimento(jeito) {
  const s = jeito.situacao_da_oferta;
  if (s?.estado !== ESTADOS.VENCE_LOGO) return null;
  const quando = quandoVence(s.dias_para_vencer);
  return `Vence ${quando}`;
}

function pontos(texto) {
  return texto === '1' ? '1 ponto' : `${texto} pontos`;
}

/** Frase "compre assim": loja, programa e cartão. `loja` pode ser o registro da loja ou só o nome. */
export function fraseDoJeito(jeito, loja) {
  const programa = jeito.programa?.nome;
  const cartao = jeito.cartao?.nome;
  const na = naLoja(loja);
  if (jeito.tipo === 'oferta') {
    if (jeito.cartoes_que_servem?.length > 1) {
      return `Compre ${na} pela oferta do ${programa}. Os pontos vêm só da oferta, então tanto faz qual cartão você usa para pagar.`;
    }
    return cartao
      ? `Compre ${na} pela oferta do ${programa} e pague com o cartão ${cartao}.`
      : `Compre ${na} pela oferta do ${programa}.`;
  }
  if (cartao) return `Compre direto ${na} e pague com o cartão ${cartao}. Os pontos vão para o ${programa}.`;
  return `Sem oferta e sem cartão, esta compra ${na} não rende pontos.`;
}

/** "A Magalu", "O Mercado Livre", "As Casas Bahia" (início de frase). */
export function aLoja(loja) {
  const artigo = { a: 'A', o: 'O', as: 'As', os: 'Os' }[loja?.artigo] ?? 'A';
  return `${artigo} ${loja?.nome ?? loja}`;
}

/** "hoje", "ontem", "há 3 dias". */
export function haQuantoTempo(dias) {
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

/** "livelo.com.br" a partir do link da fonte. null se não for um link https. */
export function siteDaFonte(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Selo de confiança do card: quando a regra principal foi conferida e onde.
 * Com oferta, vale a data da oferta; sem oferta, a do cartão.
 * @returns {{ texto: string, site: string|null, fonte_url: string|null, antigo: boolean } | null}
 */
export function seloDeConferencia(jeito) {
  const lista = jeito.conferido_em ?? [];
  const principal = lista.find((c) => c.rotulo.startsWith('oferta ')) ?? lista.find((c) => c.rotulo.startsWith('cartão ')) ?? lista[0];
  if (!principal) return null;
  const site = siteDaFonte(principal.fonte_url);
  return {
    texto: `Conferido ${haQuantoTempo(principal.dias)} (${formatarData(principal.verificado_em)})`,
    site,
    fonte_url: site ? principal.fonte_url : null,
    antigo: principal.antigo,
  };
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
  if (jeito.validade_da_oferta) return `Validade da oferta: ${jeito.validade_da_oferta.texto.replace(/^(De|Regra|Início) /, (m) => m.toLowerCase())}`;
  return 'Sem oferta da loja: só os pontos normais do cartão.';
}

/** "Conferimos: oferta X em 22/11/2026; cartão Y em 20/11/2026 (há 16 dias)". */
export function textosConferido(jeito) {
  return (jeito.conferido_em ?? []).map((c) => {
    const site = siteDaFonte(c.fonte_url);
    return {
      texto: `${c.rotulo[0].toUpperCase()}${c.rotulo.slice(1)}: conferido em ${formatarData(c.verificado_em)} (${haQuantoTempo(c.dias)})`,
      antigo: c.antigo,
      site,
      fonte_url: site ? c.fonte_url : null,
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

/** Nenhum jeito rende ponto nenhum? (Aí a tela mostra uma mensagem só, sem lista.) */
export function nenhumJeitoRende(jeitos) {
  return jeitos.length > 0 && jeitos.every((j) => j.total_pontos === 0);
}

/** Título e texto da mensagem única quando nada rende pontos. */
export function textoNadaRende(jeitos) {
  if (jeitos.some((j) => j.falta_cotacao_do_dolar)) {
    return {
      titulo: 'Ainda não dá para calcular os pontos dos cartões',
      texto: 'Os cartões contam pontos por dólar gasto, mesmo em compra no Brasil, e ainda falta a cotação do dólar para fazer a conta. Se você souber a cotação, informe em Meu perfil e a conta aparece.',
      pedeCotacao: true,
    };
  }
  return {
    titulo: 'Esta compra não rende pontos, pelo que sabemos',
    texto: 'Nenhuma oferta valendo hoje nem cartão que conhecemos dá pontos nesta compra. As regras mudam: confira de novo em outro dia.',
    pedeCotacao: false,
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
  if (!melhor) return `Resultado para ${valorTexto} ${naLoja(nomeLoja)}: nenhum jeito de comprar encontrado.`;
  if (nenhumJeitoRende(jeitos)) {
    const { titulo, texto } = textoNadaRende(jeitos);
    return `Resultado para ${valorTexto} ${naLoja(nomeLoja)}. ${titulo}. ${texto}`;
  }
  const destaque = destaqueDoJeito(melhor);
  const numero = destaque.emReais
    ? `${destaque.principal} em pontos (${pontos(melhor.total_pontos_texto)})`
    : destaque.principal.toLowerCase();
  const semOferta = jeitos.some((j) => j.tipo === 'oferta') ? '' : ` ${aLoja(nomeLoja)} não tem oferta de pontos valendo hoje.`;
  const outros = jeitos.length > 1 ? ` Há mais ${jeitos.length - 1} ${jeitos.length === 2 ? 'jeito' : 'jeitos'} logo abaixo.` : '';
  return `Resultado para ${valorTexto} ${naLoja(nomeLoja)}.${semOferta} O melhor jeito rende ${numero}. ${fraseDoJeito(melhor, nomeLoja)}${outros}`;
}
