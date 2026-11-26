// Motor de cálculo: dado o perfil, a compra, os dados e a data de hoje,
// lista os "jeitos de comprar" do melhor ao pior.
//
// Regras do projeto (CLAUDE.md): funções puras, sem DOM, sem rede, sem ler a
// data do sistema e sem aleatoriedade. Dinheiro em centavos inteiros. As contas
// usam BigInt com escala fixa, então nada se perde até a exibição:
//   - pontos por real × 10.000          (aceita até 4 casas decimais)
//   - pontos × 1.000.000                (ESCALA_PONTOS)
//   - valor em bilionésimos de centavo  (ESCALA_VALOR)
// Conta: pontos = pontos_por_real × valor_centavos / 100
//        valor (centavos) = pontos × milheiro (centavos) / 1000
// Cartão que só tem pontos por dólar:
//        pontos = valor em reais ÷ cotação do dólar × pontos_por_dolar
//        A cotação entra × 10.000 (R$ 5,3456 = 53456). A divisão é a única
//        conta que corta casas: guardamos 6 casas de ponto e cortamos para baixo.

import { calcularAbastecimento } from './combustivel.js';
import { diasEntre, horasGarantidasDesde, lerDataHora, soData } from './datas.js';
import { DIAS_ALERTA_VENCIMENTO, DIAS_DADO_ANTIGO, quandoVence, situacaoDaOferta } from './ciclo.js';
import {
  ESCALA_PONTOS, formatarCentavos, formatarCotacao, formatarData, formatarNumero, formatarPontos,
  formatarValor, pontosParaNumero, pontosPorReal,
} from './formatar.js';

export const A_CONFIRMAR = 'A_CONFIRMAR';
// Prazos do ciclo de vida (vencimento, dado antigo, reconferir): ver ciclo.js.
/** Escala da cotação do dólar: R$ 5,3456 = 53456. */
export const ESCALA_COTACAO = 10_000;
/** id do registro de cambio.json com a cotação do dólar. */
export const ID_COTACAO_DOLAR = 'usd-brl';

const ESCALA_PPR = 10_000;

// ---------------------------------------------------------------------------
// Entrada

export function erro(msg) {
  return new Error(`motor de cálculo: ${msg}`);
}

/** Confere o perfil (comum à compra em loja e ao abastecimento). */
export function validarPerfil(perfil) {
  if (!perfil || !Array.isArray(perfil.programas) || !Array.isArray(perfil.cartoes)) {
    throw erro('perfil precisa de "programas" e "cartoes" (listas)');
  }
  if (perfil.cotacao_dolar !== undefined && (!Number.isSafeInteger(perfil.cotacao_dolar) || perfil.cotacao_dolar <= 0)) {
    throw erro(`cotacao_dolar precisa ser um inteiro > 0, em reais × ${ESCALA_COTACAO} (recebido: ${perfil.cotacao_dolar})`);
  }
  for (const [id, v] of Object.entries(perfil.valor_milheiro_brl ?? {})) {
    if (!Number.isSafeInteger(v) || v < 0) {
      throw erro(`valor_milheiro_brl de "${id}" precisa ser centavos inteiros >= 0 (recebido: ${v})`);
    }
  }
}

function validarEntrada(perfil, compra, dados, hoje) {
  lerDataHora(hoje);
  validarPerfil(perfil);
  if (!compra || typeof compra.loja_id !== 'string') throw erro('compra precisa de "loja_id"');
  if (!Number.isSafeInteger(compra.valor_centavos) || compra.valor_centavos < 0) {
    throw erro(`valor_centavos precisa ser um inteiro entre 0 e ${Number.MAX_SAFE_INTEGER} (recebido: ${compra.valor_centavos})`);
  }
  if (compra.tipo_vendedor !== 'loja' && compra.tipo_vendedor !== 'parceiro') {
    throw erro(`tipo_vendedor precisa ser "loja" ou "parceiro" (recebido: ${compra.tipo_vendedor})`);
  }
  validarListas(dados, ['programas', 'cartoes', 'lojas', 'ofertas']);
}

/** Confere que dados.<nome> é uma lista (e dados.cambio, se vier). */
export function validarListas(dados, nomes) {
  for (const nome of nomes) {
    if (!dados || !Array.isArray(dados[nome])) throw erro(`dados.${nome} precisa ser uma lista`);
  }
  if (dados.cambio !== undefined && !Array.isArray(dados.cambio)) throw erro('dados.cambio precisa ser uma lista');
}

/** Pontos por real → inteiro × 10.000 (BigInt). null se não for número. */
export function pprEscalado(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  const s = Math.round(n * ESCALA_PPR);
  if (Math.abs(s - n * ESCALA_PPR) > 1e-6) throw erro(`pontos por real com mais de 4 casas decimais: ${n}`);
  return BigInt(s);
}

function porId(lista) {
  const mapa = new Map();
  for (const item of lista) if (!mapa.has(item.id)) mapa.set(item.id, item);
  return mapa;
}

function montarContexto(perfil, compra, dados, hoje) {
  const loja = porId(dados.lojas).get(compra.loja_id);
  if (!loja) throw erro(`loja "${compra.loja_id}" não existe nos dados`);
  return { ...contextoBase(perfil, dados, hoje, compra.valor_centavos), compra, loja };
}

/**
 * O que toda conta usa: programas, cartões do perfil, milheiro, cotação e o
 * valor pago em centavos inteiros (BigInt em ctx.valor).
 */
export function contextoBase(perfil, dados, hoje, valorCentavos) {
  const programas = porId(dados.programas);
  const cartoesPorId = porId(dados.cartoes);

  const programasDoPerfil = new Map();
  for (const p of perfil.programas) {
    if (p && typeof p.programa_id === 'string' && !programasDoPerfil.has(p.programa_id)) {
      programasDoPerfil.set(p.programa_id, p);
    }
  }
  // Cartões do perfil que existem nos dados, sem repetir.
  const ids = [...new Set(perfil.cartoes)].filter((id) => cartoesPorId.has(id));
  const cartoes = ids.map((id) => cartoesPorId.get(id));
  const milheiroDoPerfil = perfil.valor_milheiro_brl ?? {};
  const registroCotacao = (dados.cambio ?? []).find((c) => c.id === ID_COTACAO_DOLAR) ?? null;

  return {
    hoje,
    dataHoje: soData(hoje),
    valor: BigInt(valorCentavos),
    programas,
    cartoesPorId,
    cartoes,
    programasDoPerfil,
    nomePrograma: (id) => programas.get(id)?.nome ?? id,
    nomeCartao: (id) => cartoesPorId.get(id)?.nome ?? id,
    /** Valor do milheiro em centavos: o do perfil vence o dos dados. null se desconhecido. */
    milheiro(id) {
      if (Object.hasOwn(milheiroDoPerfil, id)) return { centavos: milheiroDoPerfil[id], doPerfil: true };
      const v = programas.get(id)?.valor_milheiro_brl;
      return Number.isSafeInteger(v) ? { centavos: v, doPerfil: false } : null;
    },
    /** Cotação do dólar (reais × 10.000): a do perfil vence a dos dados. null se desconhecida. */
    cotacao() {
      if (perfil.cotacao_dolar !== undefined) return { x10000: perfil.cotacao_dolar, doPerfil: true, registro: null };
      const v = registroCotacao?.reais_por_dolar;
      return Number.isSafeInteger(v) && v > 0 ? { x10000: v, doPerfil: false, registro: registroCotacao } : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Oferta

/**
 * A oferta entra no ranking hoje? Mesma regra da calculadora (ativa ou
 * vencendo logo, e conferida há no máximo 30 dias; ver ciclo.js). Usada
 * também por "Onde rende mais" (oportunidades.js).
 */
export function ofertaValeHoje(oferta, dataHoje) {
  return situacaoDaOferta(oferta, dataHoje).no_ranking;
}

/** Ofertas da loja que entram no ranking hoje (ativas ou vencendo logo; ver ciclo.js). */
function ofertasQueValem(ctx) {
  return ctx.ofertas
    .filter((o) => o.loja_id === ctx.compra.loja_id)
    .filter((o) => ctx.programasDoPerfil.has(o.programa_id))
    .filter((o) => ofertaValeHoje(o, ctx.dataHoje));
}

/** O produto está no escopo da oferta? Se não, diz por quê. */
function avaliarEscopo(oferta, compra) {
  const cat = compra.categoria;
  if (cat && (oferta.categorias_excluidas ?? []).includes(cat)) {
    return { dentro: false, motivo: `Produto da categoria "${cat}", excluída da oferta,` };
  }
  if (oferta.escopo === 'vendido_e_entregue_pela_loja' && compra.tipo_vendedor !== 'loja') {
    return { dentro: false, motivo: 'Item de parceiro' };
  }
  if (oferta.escopo === 'categorias_selecionadas') {
    if (!cat) return { dentro: false, motivo: 'Produto sem categoria informada', semCategoria: true };
    if (!(oferta.categorias_incluidas ?? []).includes(cat)) {
      return { dentro: false, motivo: `Produto da categoria "${cat}", fora da oferta,` };
    }
  }
  return { dentro: true };
}

/** O clube do programa conta para esta oferta? */
export function avaliarClube(oferta, doPerfil, hoje) {
  const exigidas = oferta.clube_ativo_ha_horas;
  if (!doPerfil || doPerfil.clube_ativo !== true) return { cumpre: false, falta: 'assinar', exigidas };
  if (exigidas === A_CONFIRMAR) return { cumpre: true, horasAConfirmar: true };
  if (!exigidas) return { cumpre: true };
  const desde = doPerfil.clube_ativo_desde;
  if (!desde) return { cumpre: false, falta: 'data', exigidas };
  if (horasGarantidasDesde(desde, hoje) >= exigidas) return { cumpre: true };
  return { cumpre: false, falta: 'tempo', exigidas, desde };
}

function exigeClube(regra) {
  return regra.condicao?.clube_ativo === true;
}

function cartaoExigido(regra) {
  return regra.condicao?.cartao_id ?? null;
}

function regraVale(regra, clubeCumpre, cartaoId) {
  if (exigeClube(regra) && !clubeCumpre) return false;
  const c = cartaoExigido(regra);
  return !c || c === cartaoId;
}

function especificidade(regra) {
  return (exigeClube(regra) ? 1 : 0) + (cartaoExigido(regra) ? 1 : 0);
}

/** A regra mais específica que vale; empate → mais pontos; empate → a primeira da lista. */
export function escolherRegra(regras, clubeCumpre, cartaoId) {
  let melhor = null;
  for (const regra of regras) {
    if (!regraVale(regra, clubeCumpre, cartaoId)) continue;
    if (
      !melhor ||
      especificidade(regra) > especificidade(melhor) ||
      (especificidade(regra) === especificidade(melhor) && regra.pontos_por_real > melhor.pontos_por_real)
    ) {
      melhor = regra;
    }
  }
  return melhor;
}

function descreverCondicao(regra, ctx, nomeProg) {
  const partes = [];
  if (exigeClube(regra)) partes.push(`clube ${nomeProg} ativo`);
  if (cartaoExigido(regra)) partes.push(`cartão ${ctx.nomeCartao(cartaoExigido(regra))}`);
  return partes.length ? partes.join(' + ') : 'sem exigência';
}

function textoClubeQueFalta(clube, nomeProg) {
  const horas = clube.exigidas && clube.exigidas !== A_CONFIRMAR ? ` pelo menos ${clube.exigidas} horas antes da compra` : '';
  if (clube.falta === 'assinar') return `assinasse o clube ${nomeProg}${horas}`;
  if (clube.falta === 'data') return `confirmasse que o seu clube ${nomeProg} está ativo há pelo menos ${clube.exigidas} horas (informe desde quando)`;
  return `estivesse com o clube ${nomeProg} ativo há pelo menos ${clube.exigidas} horas na hora da compra (ele está ativo desde ${formatarData(clube.desde)})`;
}

/** "O que você ganharia se…": faixas melhores que a atual, cuja condição o perfil não cumpre. */
function hipoteses(ctx, oferta, regraAtual, clube, cartao, pontosAtuaisEsc, nomeProg) {
  const atual = regraAtual?.pontos_por_real ?? 0;
  const donos = new Set(ctx.cartoes.map((c) => c.id));
  const milheiro = ctx.milheiro(oferta.programa_id);
  // Cartões que a pessoa não tem e que alguma faixa pede. (Se ela já tem o
  // cartão, esse caminho aparece como outro jeito de comprar.)
  const outrosCartoes = [...new Set(oferta.regras.map(cartaoExigido))]
    .filter((id) => id && id !== cartao?.id && !donos.has(id));
  const lista = [];
  const vistas = new Set();
  // Cada cenário: e se assinasse o clube? e se tivesse outro cartão? Vale a
  // faixa que o motor escolheria nesse cenário, sem repetir faixa.
  for (const supoeClube of clube.cumpre ? [false] : [false, true]) {
    for (const outro of [null, ...outrosCartoes]) {
      if (!supoeClube && !outro) continue;
      const regra = escolherRegra(oferta.regras, clube.cumpre || supoeClube, outro ?? cartao?.id ?? null);
      if (!regra || regra.pontos_por_real <= atual || vistas.has(regra)) continue;
      vistas.add(regra);
      const faltas = [];
      if (supoeClube && exigeClube(regra)) faltas.push(textoClubeQueFalta(clube, nomeProg));
      if (outro && cartaoExigido(regra) === outro) faltas.push(`tivesse e usasse o cartão ${ctx.nomeCartao(outro)}`);
      if (faltas.length) lista.push(montarHipotese(ctx, regra, oferta.regras.indexOf(regra), faltas, pontosAtuaisEsc, milheiro));
    }
  }
  return lista
    .sort((a, b) => b.pontos_por_real - a.pontos_por_real || a.indice - b.indice)
    .map(({ indice, ...resto }) => resto);
}

function montarHipotese(ctx, regra, indice, faltas, pontosAtuaisEsc, milheiro) {
  const esc = pprEscalado(regra.pontos_por_real) * ctx.valor;
  const valor = milheiro ? esc * BigInt(milheiro.centavos) : null;
  const emReais = valor === null ? '' : ` (${formatarValor(valor)})`;
  return {
    indice,
    condicoes: faltas,
    pontos_por_real: regra.pontos_por_real,
    pontos_do_programa: pontosParaNumero(esc),
    valor_estimado_em_reais: valor === null ? null : { bilionesimos_de_centavo: valor, texto: formatarValor(valor) },
    texto:
      `Se você ${faltas.join(' e ')}: ${pontosPorReal(regra.pontos_por_real)} = ` +
      `${formatarPontos(esc)} pontos do programa${emReais}, em vez de ${formatarPontos(pontosAtuaisEsc)}. ` +
      'Isso não está somado ao resultado acima.',
  };
}

// ---------------------------------------------------------------------------
// Peças comuns

/** Lista de avisos que também guarda as datas de verificação dos dados usados. */
export function novosAvisos() {
  const avisos = [];
  avisos.conferidos = [];
  return avisos;
}

/**
 * Anota a data de verificação do registro (vai para `conferido_em` na saída)
 * e avisa se o dado está antigo.
 */
export function avisarDadoAntigo(ctx, registro, rotulo, avisos) {
  if (!registro?.verificado_em) return;
  const dias = diasEntre(registro.verificado_em, ctx.dataHoje);
  const antigo = dias > DIAS_DADO_ANTIGO;
  if (!avisos.conferidos.some((c) => c.rotulo === rotulo)) {
    const fonte = typeof registro.fonte_url === 'string' && registro.fonte_url.startsWith('https://') ? registro.fonte_url : null;
    avisos.conferidos.push({ rotulo, verificado_em: registro.verificado_em, dias, antigo, fonte_url: fonte });
  }
  if (antigo) avisos.push(`Dado verificado há mais de ${DIAS_DADO_ANTIGO} dias (${dias} dias): ${rotulo}.`);
}

/** Pontos do cartão: { esc, programaId }. */
export function pontosDoCartao(ctx, cartao, avisos, passos, condicoes) {
  if (!cartao) {
    passos.push('Sem cartão de crédito do seu perfil: 0 pontos de cartão.');
    return { esc: 0n, programaId: null };
  }
  condicoes.push(`Pagar com o cartão ${cartao.nome}.`);
  avisarDadoAntigo(ctx, cartao, `cartão ${cartao.nome}`, avisos);
  const confirmado = cartao.status !== A_CONFIRMAR;
  const ppr = confirmado ? pprEscalado(cartao.pontos_por_real) : null;
  const ppd = confirmado && ppr === null ? pprEscalado(cartao.pontos_por_dolar) : null;
  if (ppr === null && ppd !== null) return pontosDoCartaoEmDolar(ctx, cartao, ppd, avisos, passos);
  if (ppr === null) {
    avisos.push(`Os pontos por real do cartão ${cartao.nome} não estão confirmados; não entram no cálculo.`);
    passos.push(`Pontos do cartão ${cartao.nome}: não confirmados, contamos 0.`);
    return { esc: 0n, programaId: cartao.programa_id };
  }
  const esc = ppr * ctx.valor;
  passos.push(
    `Pontos do cartão ${cartao.nome}: ${formatarCentavos(ctx.valor)} × ${formatarNumero(cartao.pontos_por_real)} = ` +
    `${formatarPontos(esc)} pontos no programa ${ctx.nomePrograma(cartao.programa_id)}.`,
  );
  return { esc, programaId: cartao.programa_id };
}

/** Pontos de um cartão que só informa pontos por dólar. */
function pontosDoCartaoEmDolar(ctx, cartao, ppdEsc, avisos, passos) {
  const cot = ctx.cotacao();
  if (!cot) {
    avisos.push(`O cartão ${cartao.nome} rende pontos por dólar, e falta a cotação do dólar; informe quanto está o dólar em "O que a conta supôs" ou em "Meu perfil".`);
    passos.push(`Pontos do cartão ${cartao.nome}: falta a cotação do dólar, contamos 0.`);
    return { esc: 0n, programaId: cartao.programa_id, faltaCotacao: true };
  }
  if (cot.registro) avisarDadoAntigo(ctx, cot.registro, 'cotação do dólar', avisos);
  // pontos × 1.000.000 = centavos × (ppd × 10.000) × 10.000 ÷ (cotação × 10.000)
  const esc = (ctx.valor * ppdEsc * BigInt(ESCALA_COTACAO)) / BigInt(cot.x10000);
  const origem = cot.doPerfil
    ? 'valor que você informou'
    : `dólar oficial do Banco Central, a PTAX${cot.registro?.data_referencia && cot.registro.data_referencia !== A_CONFIRMAR ? ` de ${formatarData(cot.registro.data_referencia)}` : ''}`;
  avisos.push(
    `O cartão ${cartao.nome} rende pontos por dólar. Usamos o dólar a ${formatarCotacao(cot.x10000)} (${origem}). ` +
    'O banco converte com o dólar dele, que costuma ser um pouco mais alto, então os pontos que caem podem ficar um pouco abaixo deste número.',
  );
  passos.push(
    `Pontos do cartão ${cartao.nome}: ${formatarCentavos(ctx.valor)} ÷ ${formatarCotacao(cot.x10000)} por dólar × ` +
    `${formatarNumero(cartao.pontos_por_dolar)} pontos por dólar = ${formatarPontos(esc)} pontos no programa ${ctx.nomePrograma(cartao.programa_id)}.`,
  );
  return { esc, programaId: cartao.programa_id };
}

/** Valor estimado em bilionésimos de centavo, ou null se falta o milheiro de algum programa com pontos. */
export function estimarValor(ctx, partes, avisos, passos) {
  const porPrograma = new Map();
  for (const { programaId, esc } of partes) {
    if (esc > 0n) porPrograma.set(programaId, (porPrograma.get(programaId) ?? 0n) + esc);
  }
  if (!porPrograma.size) {
    passos.push('Valor estimado: R$ 0,00, porque não há pontos.');
    return 0n;
  }
  let total = 0n;
  const linhas = [];
  const faltando = [];
  for (const [programaId, esc] of porPrograma) {
    const nome = ctx.nomePrograma(programaId);
    const m = ctx.milheiro(programaId);
    if (!m) {
      faltando.push(nome);
      continue;
    }
    const prog = m.doPerfil ? null : ctx.programas.get(programaId);
    avisarDadoAntigo(ctx, prog ? { ...prog, fonte_url: prog.valor_milheiro_fonte_url ?? prog.fonte_url } : null, `valor do milheiro ${nome}`, avisos);
    const v = esc * BigInt(m.centavos);
    total += v;
    linhas.push(
      `${formatarPontos(esc)} pontos ${nome} × ${formatarCentavos(m.centavos)} por milheiro` +
      `${m.doPerfil ? ' (valor que você informou)' : ''} ÷ 1.000 = ${formatarValor(v)}`,
    );
  }
  if (faltando.length) {
    for (const nome of faltando) {
      avisos.push(`O programa ${nome} não tem valor de milheiro confirmado; não dá para estimar em reais. Você pode informar o seu.`);
    }
    passos.push(`Valor estimado: não dá para calcular, porque falta o valor do milheiro de ${faltando.join(' e ')}.`);
    return null;
  }
  passos.push(`Valor estimado (milheiro é quanto valem 1.000 pontos): ${linhas.join('; ')}.`);
  if (linhas.length > 1) passos.push(`Valor total estimado: ${formatarValor(total)}.`);
  return total;
}

/**
 * Valor só das partes com milheiro conhecido (piso do valor), para ordenar.
 * null quando nenhuma parte com pontos tem milheiro. Não aparece na tela.
 */
function valorConhecido(ctx, partes) {
  let total = null;
  for (const { programaId, esc } of partes) {
    if (esc <= 0n) continue;
    const m = ctx.milheiro(programaId);
    if (m) total = (total ?? 0n) + esc * BigInt(m.centavos);
  }
  return total;
}

/** "na Magalu", "no Mercado Livre", "nas Casas Bahia" (campo opcional `artigo` da loja). */
export function naLoja(loja) {
  const artigo = { a: 'na', o: 'no', as: 'nas', os: 'nos' }[loja?.artigo] ?? 'na';
  return `${artigo} ${loja?.nome ?? loja}`;
}

function descreverCompra(ctx) {
  const quem = ctx.compra.tipo_vendedor === 'loja' ? 'vendida e entregue pela própria loja' : 'de um vendedor parceiro';
  return `Compra de ${formatarCentavos(ctx.valor)} ${naLoja(ctx.loja)}, ${quem}.`;
}

// ---------------------------------------------------------------------------
// Jeitos de comprar

function jeitoComOferta(ctx, oferta, cartao) {
  const avisos = novosAvisos();
  const condicoes = [];
  const passos = [descreverCompra(ctx)];
  const nomeProg = ctx.nomePrograma(oferta.programa_id);
  const escopo = avaliarEscopo(oferta, ctx.compra);
  const clube = avaliarClube(oferta, ctx.programasDoPerfil.get(oferta.programa_id), ctx.hoje);
  const temRegraDeClube = oferta.regras.some(exigeClube);

  // 1. Validade. Regra padrão (a de sempre do programa) não tem data de fim.
  const regraPadrao = oferta.vigencia === 'regra_padrao';
  if (oferta.inicio === A_CONFIRMAR && !regraPadrao) avisos.push('A data de início da oferta não está confirmada.');
  if (regraPadrao) {
    // nada a avisar: vale até o programa mudar a regra, e a gente reconfere toda semana.
  } else if (oferta.fim === A_CONFIRMAR) {
    avisos.push('A data de fim da oferta não está confirmada; confira antes de comprar.');
  } else {
    const dias = diasEntre(ctx.dataHoje, oferta.fim);
    if (dias <= DIAS_ALERTA_VENCIMENTO) avisos.push(`A oferta vence ${quandoVence(dias)} (${formatarData(oferta.fim)}).`);
  }
  avisarDadoAntigo(ctx, oferta, `oferta ${nomeProg} ${naLoja(ctx.loja)}`, avisos);

  // 2. Pontos do programa
  let regra = null;
  let dependeDaCategoria = false;
  let ppr;
  if (escopo.dentro) {
    regra = escolherRegra(oferta.regras, clube.cumpre, cartao?.id ?? null);
    ppr = regra ? regra.pontos_por_real : 0;
    passos.push(
      regra
        ? `Oferta ${nomeProg} ${naLoja(ctx.loja)}: vale a faixa "${descreverCondicao(regra, ctx, nomeProg)}", com ${pontosPorReal(ppr)}.`
        : `Oferta ${nomeProg} ${naLoja(ctx.loja)}: nenhuma faixa vale para você agora, então 0 ponto por real.`,
    );
    if (regra && exigeClube(regra)) condicoes.push(`Estar com o clube ${nomeProg} ativo na hora da compra.`);
    if (oferta.escopo === 'vendido_e_entregue_pela_loja') {
      condicoes.push('Comprar produto vendido e entregue pela própria loja (não de parceiro).');
    } else if (oferta.escopo === 'categorias_selecionadas') {
      condicoes.push(`Produto de uma das categorias da oferta: ${oferta.categorias_incluidas.join(', ')}.`);
    }
    // A tela não pergunta a categoria do produto. Se a oferta exclui
    // categorias e a compra não diz qual é, a pessoa precisa ver a lista,
    // e o resultado avisa quanto renderia se o produto estivesse fora.
    const excluidas = oferta.categorias_excluidas ?? [];
    if (excluidas.length && !ctx.compra.categoria) {
      dependeDaCategoria = true;
      condicoes.push(`Conferir se o produto não é de uma categoria fora da oferta: ${excluidas.join(', ')}.`);
      const fora = oferta.pontos_fora_do_escopo_por_real;
      avisos.push(
        `A oferta não vale para: ${excluidas.join(', ')}. ` +
        (typeof fora === 'number'
          ? `Se o seu produto for de uma dessas categorias, ele rende só ${pontosPorReal(fora)}, e o número acima não vale.`
          : 'Se o seu produto for de uma dessas categorias, ele fica fora da oferta, e o número acima não vale.'),
      );
    }
    if (clube.horasAConfirmar && temRegraDeClube) {
      avisos.push('Não está confirmado há quanto tempo o clube precisa estar ativo antes da compra.');
    }
  } else {
    const fora = oferta.pontos_fora_do_escopo_por_real;
    ppr = typeof fora === 'number' ? fora : 0;
    if (typeof fora === 'number') {
      avisos.push(`${escopo.motivo} rende só ${pontosPorReal(fora)}.`);
    } else {
      avisos.push(`${escopo.motivo} fica fora da oferta, e os pontos fora da oferta não estão confirmados; contamos 0.`);
    }
    if (escopo.semCategoria) {
      dependeDaCategoria = true;
      const melhorFaixa = Math.max(...oferta.regras.map((r) => r.pontos_por_real));
      avisos.push(
        `Esta oferta só vale para produtos de: ${(oferta.categorias_incluidas ?? []).join(', ')}. ` +
        `Como não sabemos a categoria do seu produto, contamos só os pontos de fora da oferta. Se ele for de uma delas, a oferta dá até ${pontosPorReal(melhorFaixa)}; confira na loja.`,
      );
    }
    passos.push(`Oferta ${nomeProg} ${naLoja(ctx.loja)}: este produto fica fora da oferta, então vale ${pontosPorReal(ppr)}.`);
  }
  let progEsc = pprEscalado(ppr) * ctx.valor;
  passos.push(`Pontos do programa: ${formatarCentavos(ctx.valor)} × ${formatarNumero(ppr)} = ${formatarPontos(progEsc)} pontos.`);

  // 3. Cupom
  if (oferta.exige_cupom === true) {
    if (ctx.compra.cupom_aplicado === true) passos.push(`Cupom ${oferta.cupom} aplicado.`);
    else condicoes.push(`Aplicar o cupom ${oferta.cupom} na compra.`);
  } else if (oferta.exige_cupom === A_CONFIRMAR) {
    avisos.push('Não está confirmado se a oferta exige cupom.');
  }

  // 4. Pontos do cartão e soma
  const cart = pontosDoCartao(ctx, cartao, avisos, passos, condicoes);
  let cartEsc = cart.esc;
  if (cartao && cartEsc > 0n) {
    if (oferta.acumula_com_cartao === true) {
      passos.push(
        `A oferta soma com os pontos do cartão: ${formatarPontos(progEsc)} + ${formatarPontos(cartEsc)} = ` +
        `${formatarPontos(progEsc + cartEsc)} pontos.`,
      );
    } else {
      avisos.push(
        oferta.acumula_com_cartao === false
          ? 'Esta oferta não soma com os pontos do cartão; vale o maior dos dois.'
          : 'Não está confirmado se os pontos do cartão somam com a oferta; por isso contamos só o maior dos dois.',
      );
      if (progEsc >= cartEsc) {
        passos.push(`Sem somar, vale o maior: ${formatarPontos(progEsc)} pontos da oferta (o cartão daria ${formatarPontos(cartEsc)}).`);
        cartEsc = 0n;
      } else {
        passos.push(`Sem somar, vale o maior: ${formatarPontos(cartEsc)} pontos do cartão (a oferta daria ${formatarPontos(progEsc)}).`);
        progEsc = 0n;
      }
    }
  }

  // 5. Valor
  const partes = [{ programaId: oferta.programa_id, esc: progEsc }, { programaId: cart.programaId, esc: cartEsc }];
  const valorEsc = estimarValor(ctx, partes, avisos, passos);
  const pisoEsc = valorConhecido(ctx, partes);
  avisarDadoAntigo(ctx, ctx.programas.get(oferta.programa_id), `programa ${nomeProg}`, avisos);

  const prazo = oferta.credito_prazo_dias;
  return {
    tipo: 'oferta',
    oferta,
    situacao: situacaoDaOferta(oferta, ctx.dataHoje),
    dependeDaCategoria,
    faltaCotacao: cart.faltaCotacao === true,
    programaId: oferta.programa_id,
    cartao,
    progEsc,
    cartEsc,
    valorEsc,
    pisoEsc,
    condicoes,
    avisos,
    passos,
    validade: {
      inicio: oferta.inicio,
      fim: oferta.fim,
      regra_padrao: regraPadrao,
      texto: regraPadrao
        ? (oferta.inicio === A_CONFIRMAR
          ? 'Regra de sempre do programa, sem data de fim publicada.'
          : `Regra de sempre do programa, a partir de ${formatarData(oferta.inicio)}, sem data de fim publicada.`)
        : (oferta.inicio === A_CONFIRMAR ? 'Início não confirmado' : `De ${formatarData(oferta.inicio)}`) +
          (oferta.fim === A_CONFIRMAR ? ', fim não confirmado.' : ` até ${formatarData(oferta.fim)}.`),
    },
    destaques: Array.isArray(oferta.destaques) ? [...oferta.destaques] : [],
    prazo: Number.isInteger(prazo)
      ? { dias: prazo, texto: `Os pontos da oferta caem em até ${prazo} dias, segundo a oferta.` }
      : { dias: null, texto: 'Prazo de crédito dos pontos da oferta não confirmado.' },
    hipoteses: escopo.dentro ? hipoteses(ctx, oferta, regra, clube, cartao, pprEscalado(ppr) * ctx.valor, nomeProg) : [],
  };
}

function jeitoSemOferta(ctx, cartao) {
  const avisos = novosAvisos();
  const condicoes = [];
  const passos = [descreverCompra(ctx), 'Sem oferta da loja: só os pontos do cartão.'];
  const cart = pontosDoCartao(ctx, cartao, avisos, passos, condicoes);
  const partes = [{ programaId: cart.programaId, esc: cart.esc }];
  const valorEsc = estimarValor(ctx, partes, avisos, passos);
  const pisoEsc = valorConhecido(ctx, partes);
  if (cartao) avisarDadoAntigo(ctx, ctx.programas.get(cartao.programa_id), `programa ${ctx.nomePrograma(cartao.programa_id)}`, avisos);
  return {
    tipo: 'sem_oferta',
    oferta: null,
    dependeDaCategoria: false,
    faltaCotacao: cart.faltaCotacao === true,
    programaId: cartao ? cartao.programa_id : null,
    cartao,
    progEsc: 0n,
    cartEsc: cart.esc,
    valorEsc,
    pisoEsc,
    condicoes,
    avisos,
    passos,
    validade: null,
    destaques: [],
    prazo: cartao ? { dias: null, texto: 'Prazo de crédito do cartão não informado nos dados.' } : null,
    hipoteses: [],
  };
}

// ---------------------------------------------------------------------------
// Ordem e saída

// Ordem: mais reais primeiro (pontos de programas diferentes valem diferente,
// então só o valor em reais compara de forma justa). Quando falta o milheiro de
// uma parte, conta o valor das partes conhecidas (um piso). Sem nenhuma parte
// com valor vai depois. Empate → valor completo antes do piso → mais pontos.
// Quem não rende ponto nenhum fica sempre por último.
function comparar(a, b) {
  const ta = a.progEsc + a.cartEsc;
  const tb = b.progEsc + b.cartEsc;
  if ((ta === 0n) !== (tb === 0n)) return ta === 0n ? 1 : -1;
  if (a.pisoEsc !== b.pisoEsc) {
    if (a.pisoEsc === null) return 1;
    if (b.pisoEsc === null) return -1;
    return a.pisoEsc > b.pisoEsc ? -1 : 1;
  }
  if ((a.valorEsc === null) !== (b.valorEsc === null)) return a.valorEsc === null ? 1 : -1;
  if (ta !== tb) return ta > tb ? -1 : 1;
  if (a.tipo !== b.tipo) return a.tipo === 'oferta' ? -1 : 1;
  const chave = (j) => [j.programaId ?? '', j.cartao?.id ?? '', j.oferta?.id ?? ''];
  const ka = chave(a);
  const kb = chave(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

function paraSaida(ctx, j) {
  const total = j.progEsc + j.cartEsc;
  return {
    tipo: j.tipo,
    oferta_id: j.oferta?.id ?? null,
    programa: j.programaId ? { id: j.programaId, nome: ctx.nomePrograma(j.programaId) } : null,
    cartao: j.cartao ? { id: j.cartao.id, nome: j.cartao.nome } : null,
    pontos_do_programa: pontosParaNumero(j.progEsc),
    pontos_do_cartao: pontosParaNumero(j.cartEsc),
    total_pontos: pontosParaNumero(total),
    total_pontos_texto: formatarPontos(total),
    // Total exato, em pontos × ESCALA_PONTOS (BigInt), para quem precisa comparar sem float (alertas).
    total_pontos_escalado: total,
    valor_estimado_em_reais:
      j.valorEsc === null ? null : { bilionesimos_de_centavo: j.valorEsc, texto: formatarValor(j.valorEsc) },
    condicoes_a_cumprir: j.condicoes,
    validade_da_oferta: j.validade,
    situacao_da_oferta: j.situacao ?? null,
    destaques_da_oferta: j.destaques,
    prazo_de_credito: j.prazo,
    avisos: [...new Set(j.avisos)],
    conferido_em: j.avisos.conferidos,
    tem_dado_antigo: j.avisos.conferidos.some((c) => c.antigo),
    o_que_voce_ganharia_se: j.hipoteses,
    depende_da_categoria: j.dependeDaCategoria,
    falta_cotacao_do_dolar: j.faltaCotacao,
    // Piso do valor (só partes com milheiro conhecido), usado na ordem. Não exibir.
    valor_para_ordenar: j.pisoEsc,
    explicacao: j.passos,
  };
}

/**
 * Lista os jeitos de comprar, do melhor ao pior (mais reais; sem valor conhecido vai
 * depois; empate → mais pontos).
 *
 * @param {object} perfil  { programas: [{programa_id, clube_ativo, clube_ativo_desde}], cartoes: [cartao_id], valor_milheiro_brl?: {programa_id: centavos}, cotacao_dolar?: reais × 10.000 }
 * @param {object} compra  { loja_id, valor_centavos, tipo_vendedor: "loja"|"parceiro", categoria?, cupom_aplicado? }
 *                         ou, para abastecer, { tipo: "combustivel", ... } (ver calcularAbastecimento em combustivel.js)
 * @param {object} dados   { programas, cartoes, lojas, ofertas, cambio? }
 * @param {string} hoje    "AAAA-MM-DD" (ou "AAAA-MM-DDTHH:MM")
 */
export function calcularJeitosDeComprar(perfil, compra, dados, hoje) {
  // Abastecimento tem conta própria (combustivel.js); a lista sai no mesmo formato de "jeitos".
  if (compra?.tipo === 'combustivel') return calcularAbastecimento(perfil, compra, dados, hoje).jeitos;
  if (compra && compra.tipo !== undefined && compra.tipo !== 'loja') {
    throw erro(`tipo de compra precisa ser "loja" ou "combustivel" (recebido: ${compra.tipo})`);
  }
  validarEntrada(perfil, compra, dados, hoje);
  const ctx = { ...montarContexto(perfil, compra, dados, hoje), ofertas: dados.ofertas };
  const opcoesDeCartao = ctx.cartoes.length ? ctx.cartoes : [null];
  const jeitos = [];
  for (const oferta of ofertasQueValem(ctx)) {
    for (const cartao of opcoesDeCartao) jeitos.push(jeitoComOferta(ctx, oferta, cartao));
  }
  for (const cartao of opcoesDeCartao) jeitos.push(jeitoSemOferta(ctx, cartao));
  return jeitos.sort(comparar).map((j) => paraSaida(ctx, j));
}

export { ESCALA_PONTOS };
