// Abastecimento: quanto rende abastecer em cada rede de postos.
//
// Mesmas regras do resto do motor (CLAUDE.md): funções puras, sem DOM, sem
// rede, sem ler a data do sistema. Dinheiro em centavos inteiros e contas em
// BigInt. Aqui entram duas medidas novas, também inteiras:
//   - litros em MILILITROS (40 litros = 40000)
//   - preço do litro em MILÉSIMOS DE REAL (R$ 6,299 = 6299), porque a bomba
//     mostra três casas. O preço é digitado pela pessoa na hora e não fica
//     guardado em lugar nenhum: o site não cadastra preço de combustível.
//
// A pessoa informa litros OU reais. Com o preço do litro, dá para passar de
// um para o outro; sem ele, só valem as regras na mesma medida que ela usou.
// Toda conta que divide corta para baixo (conservador), como no dólar.
//   pontos por real:  pontos = pontos_por_real × reais
//   pontos por litro: pontos = pontos_por_litro × litros
//   reais a partir de litros: centavos = mililitros × preço (milésimos) ÷ 10.000
//   litros a partir de reais: mililitros = centavos × 10.000 ÷ preço (milésimos)

import {
  avisarDadoAntigo, contextoBase, erro, estimarValor, novosAvisos, pontosDoCartao, pprEscalado,
  validarListas, validarPerfil,
} from './calcular.js';
import { diasEntre, lerDataHora } from './datas.js';
import { formatarCentavos, formatarData, formatarNumero, formatarPontos, formatarValor, pontosParaNumero } from './formatar.js';

// Constantes locais (não importadas de calcular.js): este módulo e o
// calcular.js se importam, e um valor importado lido fora de função ainda
// não existiria.
const CONFIRMAR = 'A_CONFIRMAR';
const SEM_DATA = 'sem_data';
const DIAS_AVISO = 7;
const ESCALA_VALOR = 1_000_000_000n;

/** Combustíveis que o modelo de dados conhece, com o nome para a tela. */
export const COMBUSTIVEIS = Object.freeze({
  gasolina_comum: 'Gasolina comum',
  gasolina_aditivada: 'Gasolina aditivada ou premium',
  etanol_comum: 'Etanol comum',
  etanol_aditivado: 'Etanol aditivado ou premium',
  diesel_s10_comum: 'Diesel S10 comum',
  diesel_s10_aditivado: 'Diesel S10 aditivado ou premium',
  diesel_s500: 'Diesel S500',
  gnv: 'GNV (gás natural veicular)',
});

/** Limites da entrada: bem acima de qualquer abastecimento de verdade, longe do limite do número inteiro. */
export const LITROS_MAXIMOS_ML = 99_999_000; // 99.999 litros
export const PRECO_MAXIMO_MILESIMOS = 99_999; // R$ 99,999 o litro

// ---------------------------------------------------------------------------
// Entrada

function inteiroPositivo(v) {
  return Number.isSafeInteger(v) && v > 0;
}

function validarAbastecimento(perfil, ab, dados, hoje) {
  lerDataHora(hoje);
  validarPerfil(perfil);
  if (!ab || typeof ab !== 'object') throw erro('abastecimento precisa ser um objeto');
  if (ab.tipo !== undefined && ab.tipo !== 'combustivel') throw erro(`tipo precisa ser "combustivel" (recebido: ${ab.tipo})`);
  if (!Object.hasOwn(COMBUSTIVEIS, ab.combustivel)) {
    throw erro(`combustivel precisa ser um de ${Object.keys(COMBUSTIVEIS).join(', ')} (recebido: ${ab.combustivel})`);
  }
  if (ab.rede_id !== undefined && ab.rede_id !== null && typeof ab.rede_id !== 'string') throw erro('rede_id precisa ser texto');
  const temLitros = ab.litros_ml !== undefined && ab.litros_ml !== null;
  const temReais = ab.valor_centavos !== undefined && ab.valor_centavos !== null;
  if (temLitros === temReais) throw erro('informe litros_ml OU valor_centavos (um dos dois)');
  if (temLitros && !(inteiroPositivo(ab.litros_ml) && ab.litros_ml <= LITROS_MAXIMOS_ML)) {
    throw erro(`litros_ml precisa ser um inteiro entre 1 e ${LITROS_MAXIMOS_ML} (recebido: ${ab.litros_ml})`);
  }
  if (temReais && !(inteiroPositivo(ab.valor_centavos))) {
    throw erro(`valor_centavos precisa ser um inteiro entre 1 e ${Number.MAX_SAFE_INTEGER} (recebido: ${ab.valor_centavos})`);
  }
  const temPreco = ab.preco_litro_milesimos !== undefined && ab.preco_litro_milesimos !== null;
  if (temPreco && !(inteiroPositivo(ab.preco_litro_milesimos) && ab.preco_litro_milesimos <= PRECO_MAXIMO_MILESIMOS)) {
    throw erro(`preco_litro_milesimos precisa ser um inteiro entre 1 e ${PRECO_MAXIMO_MILESIMOS} (recebido: ${ab.preco_litro_milesimos})`);
  }
  validarListas(dados, ['programas', 'cartoes', 'redes_postos', 'regras_postos']);
  if (ab.rede_id && !dados.redes_postos.some((r) => r.id === ab.rede_id)) throw erro(`rede "${ab.rede_id}" não existe nos dados`);
}

// ---------------------------------------------------------------------------
// Medidas (frações exatas em BigInt: n ÷ d)

/** Reais (em centavos) e litros (em mililitros) do abastecimento. null = não dá para saber sem o preço. */
function medidas(ab) {
  const preco = ab.preco_litro_milesimos ? BigInt(ab.preco_litro_milesimos) : null;
  if (ab.valor_centavos) {
    const c = BigInt(ab.valor_centavos);
    return { informado: 'reais', preco, reais: { n: c, d: 1n }, litros: preco ? { n: c * 10_000n, d: preco } : null };
  }
  const ml = BigInt(ab.litros_ml);
  return { informado: 'litros', preco, litros: { n: ml, d: 1n }, reais: preco ? { n: ml * preco, d: 10_000n } : null };
}

function exata(f) {
  return f.n % f.d === 0n;
}

/** Fração de centavos → "R$ 251,96" (arredonda só aqui, na exibição). */
function textoReais(f) {
  return formatarValor((f.n * ESCALA_VALOR) / f.d);
}

/** Fração de mililitros → "40 litros" / "39,99 litros" (até 2 casas, meio para cima). */
function textoLitros(f) {
  const centesimos = (f.n * 100n * 2n + f.d * 1000n) / (f.d * 1000n * 2n);
  const decimal = `${centesimos / 100n}.${(centesimos % 100n).toString().padStart(2, '0')}`;
  return `${formatarNumero(decimal)} ${centesimos === 100n ? 'litro' : 'litros'}`;
}

/** Milésimos de real → "R$ 6,299". */
export function formatarPrecoLitro(milesimos) {
  const v = BigInt(milesimos);
  return `R$ ${v / 1000n},${(v % 1000n).toString().padStart(3, '0')}`;
}

/** Mililitros (inteiro) → "40 litros". */
export function formatarLitros(ml) {
  return textoLitros({ n: BigInt(ml), d: 1n });
}

/** "Gasolina comum" → "gasolina comum"; siglas ("GNV") ficam como estão. */
function nomeNoMeioDaFrase(nome) {
  return /^[A-Z]{2}/.test(nome) ? nome : nome[0].toLowerCase() + nome.slice(1);
}

function descreverAbastecimento(m, nomeCombustivel) {
  const comb = nomeNoMeioDaFrase(nomeCombustivel);
  if (m.informado === 'reais') {
    const base = `Abastecimento de ${textoReais(m.reais)} de ${comb}`;
    if (!m.litros) return `${base}.`;
    return `${base} a ${formatarPrecoLitro(m.preco)} o litro: ${exata(m.litros) ? '' : 'cerca de '}${textoLitros(m.litros)}.`;
  }
  const base = `Abastecimento de ${textoLitros(m.litros)} de ${comb}`;
  if (!m.reais) return `${base}.`;
  return `${base} a ${formatarPrecoLitro(m.preco)} o litro: ${exata(m.reais) ? '' : 'cerca de '}${textoReais(m.reais)}.`;
}

// ---------------------------------------------------------------------------
// Regras

function regraConfirmada(regra) {
  return regra.status !== CONFIRMAR && regra.unidade !== CONFIRMAR && regra.pontos_por_unidade !== CONFIRMAR;
}

function regraValeHoje(regra, dataHoje) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(regra.inicio) && regra.inicio > dataHoje) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(regra.fim) && regra.fim < dataHoje) return false;
  return true;
}

function valeParaCombustivel(regra, combustivel) {
  return regra.combustiveis === CONFIRMAR || regra.combustiveis.includes(combustivel);
}

/** Dá para pagar com cartão de crédito e ainda ganhar os pontos do programa? */
function aceitaCartao(regra) {
  return Array.isArray(regra.formas_de_pagamento)
    && regra.formas_de_pagamento.some((f) => f === 'app_cartao_cadastrado' || f === 'cpf_no_caixa');
}

function textoForma(forma, app) {
  const doApp = app ? `pelo app ${app}` : 'pelo app do posto';
  if (forma === 'app_cartao_cadastrado') return `pagar ${doApp} com um cartão de crédito cadastrado nele`;
  if (forma === 'app_pix') return `pagar ${doApp} com Pix`;
  if (forma === 'app_meio_a_confirmar') return `pagar ${doApp}`;
  return 'pagar no caixa ou na maquininha do posto informando o seu CPF';
}

function textoUnidade(regra) {
  const n = regra.pontos_por_unidade;
  return `${formatarNumero(n)} ${n === 1 ? 'ponto' : 'pontos'} por ${regra.unidade}`;
}

function textoBloco(regra) {
  const b = BigInt(regra.pontua_a_cada);
  return regra.unidade === 'real' ? formatarCentavos(b) : textoLitros({ n: b, d: 1n });
}

/**
 * Pontos do programa pela regra. Devolve { esc, passo } ou null quando falta o
 * preço do litro para converter a medida.
 */
function pontosDaRegra(regra, m) {
  const qt = regra.unidade === 'real' ? m.reais : m.litros;
  if (!qt) return null;
  const ppu = pprEscalado(regra.pontos_por_unidade);
  // pontos × 1.000.000 = (pontos/unidade × 10.000) × centavos            (real)
  //                    = (pontos/unidade × 10.000) × mililitros ÷ 10      (litro)
  const kDen = regra.unidade === 'real' ? 1n : 10n;
  const texto = (f) => (regra.unidade === 'real' ? textoReais(f) : textoLitros(f));
  if (regra.pontua_a_cada) {
    const b = BigInt(regra.pontua_a_cada);
    const blocos = qt.n / (qt.d * b);
    const usado = { n: blocos * b, d: 1n };
    const esc = (ppu * usado.n) / kDen;
    return {
      esc,
      passo: `A regra conta a cada ${textoBloco(regra)} completo: ${texto(qt)} têm ${blocos} ${blocos === 1n ? 'bloco' : 'blocos'}, ` +
        `ou seja ${texto(usado)}; ${texto(usado)} × ${textoUnidade(regra)} = ${formatarPontos(esc)} pontos.`,
    };
  }
  const esc = (ppu * qt.n) / (qt.d * kDen);
  return { esc, passo: `${texto(qt)} × ${textoUnidade(regra)} = ${formatarPontos(esc)} pontos.` };
}

function textoValidadeRegra(regra) {
  if (regra.inicio === SEM_DATA && regra.fim === SEM_DATA) return 'Regra fixa do programa: o regulamento não traz data para acabar.';
  const inicio = regra.inicio === CONFIRMAR ? 'Início não confirmado' : regra.inicio === SEM_DATA ? 'Sem data de início' : `De ${formatarData(regra.inicio)}`;
  const fim = regra.fim === CONFIRMAR ? ', fim não confirmado.' : regra.fim === SEM_DATA ? ', sem data para acabar.' : ` até ${formatarData(regra.fim)}.`;
  return inicio + fim;
}

function prazoDeCredito(regra) {
  const p = regra.credito_prazo;
  if (p === CONFIRMAR) return { dias: null, tipo: null, texto: 'Prazo para os pontos caírem na conta não confirmado.' };
  const dias = `${p.dias} ${p.dias === 1 ? 'dia' : 'dias'}${p.tipo === 'uteis' ? (p.dias === 1 ? ' útil' : ' úteis') : ''}`;
  return { dias: p.dias, tipo: p.tipo, texto: `Os pontos do programa caem na conta em até ${dias}, segundo o regulamento.` };
}

function validadeDosPontos(regra) {
  const m = regra.validade_dos_pontos_meses;
  if (m === CONFIRMAR) return { meses: null, texto: 'Validade dos pontos não confirmada.' };
  return { meses: m, texto: `Os pontos valem ${m} ${m === 1 ? 'mês' : 'meses'} depois de creditados.` };
}

// ---------------------------------------------------------------------------
// Jeitos de abastecer

function jeitoDaRegra(ctx, regra, rede, cartao, m) {
  const avisos = novosAvisos();
  const condicoes = [];
  const passos = [descreverAbastecimento(m, ctx.nomeCombustivel)];
  const nomeProg = ctx.nomePrograma(regra.programa_id);

  if (regra.inicio === CONFIRMAR) avisos.push('A data de início desta regra não está confirmada.');
  if (regra.fim === CONFIRMAR) {
    avisos.push('A data de fim desta regra não está confirmada; confira no app antes de abastecer.');
  } else if (regra.fim !== SEM_DATA) {
    const dias = diasEntre(ctx.dataHoje, regra.fim);
    const quando = dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`;
    if (dias <= DIAS_AVISO) avisos.push(`Esta regra vence ${quando} (${formatarData(regra.fim)}).`);
  }
  if (regra.combustiveis === CONFIRMAR) {
    avisos.push(`Não está confirmado quais combustíveis pontuam no ${nomeProg}; confira no app antes de abastecer.`);
  }
  avisarDadoAntigo(ctx, regra, `regra ${nomeProg} nos postos ${rede.nome}`, avisos);

  const prog = pontosDaRegra(regra, m);
  passos.push(`${nomeProg} nos postos ${rede.nome}: ${textoUnidade(regra)}.`, prog.passo);
  const formas = Array.isArray(regra.formas_de_pagamento) ? regra.formas_de_pagamento : [];
  if (formas.length) {
    condicoes.push(`Para ganhar os pontos ${nomeProg}: ${formas.map((f) => textoForma(f, regra.nome_do_app)).join(' ou ')}.`);
  } else {
    avisos.push(`Não está confirmado como pagar para ganhar os pontos ${nomeProg}; confira no app.`);
  }

  let cart = { esc: 0n, programaId: null };
  if (cartao) {
    cart = pontosDoCartao(ctx, cartao, avisos, passos, condicoes);
    if (formas.includes('cpf_no_caixa') && !formas.includes('app_cartao_cadastrado')) {
      condicoes.push('Para somar os pontos do cartão, pague no caixa ou na maquininha com o cartão de crédito.');
    }
  } else if (ctx.cartoes.length && !ctx.temReais) {
    avisos.push('Sem o preço do litro não dá para saber quanto você vai pagar, então os pontos do cartão ficam de fora.');
  } else if (ctx.cartoes.length) {
    const motivo = formas.length
      ? `Não está confirmado se dá para pagar com cartão de crédito ${formas.includes('app_pix') ? 'neste jeito' : `pelo app${regra.nome_do_app ? ` ${regra.nome_do_app}` : ''}`}`
      : 'Não está confirmado como pagar';
    avisos.push(`${motivo}; por isso não somamos os pontos do seu cartão aqui.`);
    passos.push('Pontos do cartão: não somados, porque a forma de pagamento não está confirmada.');
  }
  if (cart.esc > 0n) {
    passos.push(`Somando: ${formatarPontos(prog.esc)} pontos ${nomeProg} + ${formatarPontos(cart.esc)} pontos do cartão = ${formatarPontos(prog.esc + cart.esc)} pontos.`);
  }

  const valorEsc = estimarValor(
    ctx,
    [{ programaId: regra.programa_id, esc: prog.esc }, { programaId: cart.programaId, esc: cart.esc }],
    avisos,
    passos,
  );
  avisarDadoAntigo(ctx, ctx.programas.get(regra.programa_id), `programa ${nomeProg}`, avisos);
  avisarDadoAntigo(ctx, rede, `rede ${rede.nome}`, avisos);

  return {
    tipo: 'combustivel',
    regra,
    rede,
    programaId: regra.programa_id,
    cartao,
    progEsc: prog.esc,
    cartEsc: cart.esc,
    valorEsc,
    condicoes,
    avisos,
    passos,
    validade: { inicio: regra.inicio, fim: regra.fim, texto: textoValidadeRegra(regra) },
    prazo: prazoDeCredito(regra),
    validadePontos: validadeDosPontos(regra),
  };
}

function jeitoSoCartao(ctx, cartao, rede, m) {
  const avisos = novosAvisos();
  const condicoes = [];
  const onde = rede ? `nos postos ${rede.nome}` : 'em qualquer posto';
  const passos = [descreverAbastecimento(m, ctx.nomeCombustivel), `Sem programa do posto: só os pontos do cartão, ${onde}.`];
  const cart = pontosDoCartao(ctx, cartao, avisos, passos, condicoes);
  const valorEsc = estimarValor(ctx, [{ programaId: cart.programaId, esc: cart.esc }], avisos, passos);
  if (cartao) avisarDadoAntigo(ctx, ctx.programas.get(cartao.programa_id), `programa ${ctx.nomePrograma(cartao.programa_id)}`, avisos);
  return {
    tipo: 'combustivel_so_cartao',
    regra: null,
    rede: rede ?? null,
    programaId: cartao ? cartao.programa_id : null,
    cartao,
    progEsc: 0n,
    cartEsc: cart.esc,
    valorEsc,
    condicoes,
    avisos,
    passos,
    validade: null,
    prazo: cartao ? { dias: null, tipo: null, texto: 'Prazo de crédito do cartão não informado nos dados.' } : null,
    validadePontos: null,
  };
}

/**
 * Cartão que não soma nenhum ponto (pontos não confirmados, falta a cotação)
 * só repetiria o mesmo jeito. Fica só quem soma; se nenhum soma, fica o
 * primeiro, para a tela mostrar o porquê.
 */
function soOsQueSomam(lista) {
  const somam = lista.filter((j) => j.cartEsc > 0n);
  return somam.length ? somam : lista.slice(0, 1);
}

// ---------------------------------------------------------------------------
// Ordem e saída

function comparar(a, b) {
  const ta = a.progEsc + a.cartEsc;
  const tb = b.progEsc + b.cartEsc;
  if (ta !== tb) return ta > tb ? -1 : 1;
  if (a.valorEsc !== b.valorEsc) {
    if (a.valorEsc === null) return 1;
    if (b.valorEsc === null) return -1;
    return a.valorEsc > b.valorEsc ? -1 : 1;
  }
  if (a.tipo !== b.tipo) return a.tipo === 'combustivel' ? -1 : 1;
  const chave = (j) => [j.rede?.id ?? '', j.programaId ?? '', j.cartao?.id ?? '', j.regra?.id ?? ''];
  const ka = chave(a);
  const kb = chave(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

function paraSaida(ctx, j) {
  const total = j.progEsc + j.cartEsc;
  return {
    tipo: j.tipo,
    regra_id: j.regra?.id ?? null,
    rede: j.rede ? { id: j.rede.id, nome: j.rede.nome } : null,
    programa: j.programaId ? { id: j.programaId, nome: ctx.nomePrograma(j.programaId) } : null,
    programa_do_posto: j.regra ? { id: j.regra.programa_id, nome: ctx.nomePrograma(j.regra.programa_id) } : null,
    cartao: j.cartao ? { id: j.cartao.id, nome: j.cartao.nome } : null,
    combustivel: { id: ctx.combustivel, nome: ctx.nomeCombustivel },
    pontos_do_programa: pontosParaNumero(j.progEsc),
    pontos_do_cartao: pontosParaNumero(j.cartEsc),
    total_pontos: pontosParaNumero(total),
    total_pontos_texto: formatarPontos(total),
    valor_estimado_em_reais:
      j.valorEsc === null ? null : { bilionesimos_de_centavo: j.valorEsc, texto: formatarValor(j.valorEsc) },
    condicoes_a_cumprir: j.condicoes,
    validade_da_regra: j.validade,
    prazo_de_credito: j.prazo,
    validade_dos_pontos: j.validadePontos,
    avisos: [...new Set(j.avisos)],
    conferido_em: j.avisos.conferidos,
    tem_dado_antigo: j.avisos.conferidos.some((c) => c.antigo),
    o_que_voce_ganharia_se: [],
    fonte_url: j.regra?.fonte_url ?? null,
    explicacao: j.passos,
  };
}

function resumoDoAbastecimento(m, ab) {
  return {
    combustivel: { id: ab.combustivel, nome: COMBUSTIVEIS[ab.combustivel] },
    informado: m.informado,
    litros_texto: m.litros ? textoLitros(m.litros) : null,
    reais_texto: m.reais ? textoReais(m.reais) : null,
    preco_litro_texto: m.preco ? formatarPrecoLitro(m.preco) : null,
    litros_aproximados: Boolean(m.litros && !exata(m.litros)),
    reais_aproximados: Boolean(m.reais && !exata(m.reais)),
  };
}

/**
 * Quanto rende abastecer. Funciona com litros ou com reais; o preço do litro
 * é opcional e só serve para converter uma medida na outra.
 *
 * @param {object} perfil  o mesmo de calcularJeitosDeComprar
 * @param {object} abastecimento  { combustivel, litros_ml? | valor_centavos?, preco_litro_milesimos?, rede_id? (sem = todas as redes), tipo?: "combustivel" }
 * @param {object} dados   { programas, cartoes, redes_postos, regras_postos, cambio? }
 * @param {string} hoje    "AAAA-MM-DD" (ou "AAAA-MM-DDTHH:MM")
 * @returns {{
 *   jeitos: object[],            do melhor ao pior (mais pontos; empate → mais reais)
 *   abastecimento: object,       o que foi informado, já em texto
 *   falta_preco: object[],       regras que contam na outra medida: informe o preço do litro
 *   fora_do_perfil: object[],    regras de programas que a pessoa não marcou no perfil
 *   a_confirmar: object[],       regras sem pontos confirmados (fora do cálculo)
 *   outro_combustivel: object[], regras da rede que não pontuam este combustível
 * }}
 */
export function calcularAbastecimento(perfil, abastecimento, dados, hoje) {
  validarAbastecimento(perfil, abastecimento, dados, hoje);
  const m = medidas(abastecimento);
  // Cartão de crédito pontua em reais: sem reais (litros sem preço), não dá para contar.
  const valorCentavos = m.reais ? m.reais.n / m.reais.d : 0n;
  const ctx = {
    ...contextoBase(perfil, dados, hoje, valorCentavos),
    combustivel: abastecimento.combustivel,
    nomeCombustivel: COMBUSTIVEIS[abastecimento.combustivel],
    temReais: Boolean(m.reais),
  };
  const redes = new Map(dados.redes_postos.map((r) => [r.id, r]));
  const redeEscolhida = abastecimento.rede_id ? redes.get(abastecimento.rede_id) : null;
  const opcoesDeCartao = ctx.cartoes.length ? ctx.cartoes : [null];

  const jeitos = [];
  const faltaPreco = [];
  const foraDoPerfil = [];
  const aConfirmar = [];
  const outroCombustivel = [];
  const item = (regra, rede, texto, extra = {}) => ({
    regra_id: regra.id,
    rede: { id: rede.id, nome: rede.nome },
    programa: { id: regra.programa_id, nome: ctx.nomePrograma(regra.programa_id) },
    texto,
    fonte_url: regra.fonte_url,
    ...extra,
  });

  for (const regra of dados.regras_postos) {
    const rede = redes.get(regra.rede_id);
    if (!rede || (redeEscolhida && rede.id !== redeEscolhida.id)) continue;
    if (!regraValeHoje(regra, ctx.dataHoje)) continue;
    const nomeProg = ctx.nomePrograma(regra.programa_id);
    if (!regraConfirmada(regra)) {
      aConfirmar.push(item(regra, rede,
        `${nomeProg} nos postos ${rede.nome}: ainda não confirmamos quantos pontos dá por abastecimento (conferido em ${formatarData(regra.verificado_em)}).`));
      continue;
    }
    if (!valeParaCombustivel(regra, ctx.combustivel)) {
      outroCombustivel.push(item(regra, rede,
        `${nomeProg} nos postos ${rede.nome}: esta regra não vale para ${nomeNoMeioDaFrase(ctx.nomeCombustivel)}.`));
      continue;
    }
    if (!(regra.unidade === 'real' ? m.reais : m.litros)) {
      const falta = m.informado === 'litros' ? 'em reais' : 'em litros';
      faltaPreco.push(item(regra, rede,
        `${nomeProg} nos postos ${rede.nome} conta ${textoUnidade(regra)}. Para calcular ${falta}, informe o preço do litro.`));
      continue;
    }
    if (!ctx.programasDoPerfil.has(regra.programa_id)) {
      const prog = pontosDaRegra(regra, m);
      if (prog.esc > 0n) {
        foraDoPerfil.push(item(regra, rede,
          `Se você participasse do ${nomeProg} e abastecesse nos postos ${rede.nome}, ganharia ${formatarPontos(prog.esc)} pontos ${nomeProg} neste abastecimento.`,
          { total_pontos: pontosParaNumero(prog.esc), total_pontos_texto: formatarPontos(prog.esc) }));
      }
      continue;
    }
    const cartoes = aceitaCartao(regra) && ctx.temReais && ctx.cartoes.length ? ctx.cartoes : [null];
    jeitos.push(...soOsQueSomam(cartoes.map((cartao) => jeitoDaRegra(ctx, regra, rede, cartao, m))));
  }
  // Sem programa de posto: o cartão rende em qualquer posto (precisa dos reais).
  if (m.reais) jeitos.push(...soOsQueSomam(opcoesDeCartao.map((cartao) => jeitoSoCartao(ctx, cartao, redeEscolhida, m))));

  return {
    jeitos: jeitos.sort(comparar).map((j) => paraSaida(ctx, j)),
    abastecimento: resumoDoAbastecimento(m, abastecimento),
    falta_preco: faltaPreco,
    fora_do_perfil: foraDoPerfil.sort((a, b) => b.total_pontos - a.total_pontos || (a.regra_id < b.regra_id ? -1 : 1)),
    a_confirmar: aConfirmar,
    outro_combustivel: outroCombustivel,
  };
}
