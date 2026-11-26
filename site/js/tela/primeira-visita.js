// Primeira visita e "vale a pena?": funções puras que a tela usa para
//  - sugerir exemplos de um toque (resultado sem digitar nada);
//  - dizer, em palavras, o que a conta supôs (padrões) e o que dá para mudar;
//  - aplicar o "ajuste rápido" ao perfil, sem passar pela tela Meu perfil;
//  - separar os jeitos que valem a pena mostrar dos que só repetem "0 ponto";
//  - achar o milheiro e a cotação que a conta usou.
// Nenhuma conta de pontos acontece aqui: isso é com o motor.

import { A_CONFIRMAR, ID_COTACAO_DOLAR, formatarCentavos, formatarCotacao, formatarData } from '../motor/index.js';
import { VERSAO_ATUAL, cotacaoValida, ehVazio } from '../perfil/formato.js';

/** Valor dos exemplos de um toque: R$ 1.000,00. */
export const VALOR_EXEMPLO_CENTAVOS = 100000;
/** Quantos jeitos com pontos aparecem abertos (o resto fica em "ver mais"). */
export const JEITOS_ABERTOS = 3;

function ofertaValeHoje(oferta, hoje) {
  if (oferta.status === A_CONFIRMAR) return false;
  if (oferta.inicio !== A_CONFIRMAR && oferta.inicio > hoje) return false;
  if (oferta.fim !== A_CONFIRMAR && oferta.fim < hoje) return false;
  return true;
}

/** Ids das lojas com alguma oferta valendo hoje ("AAAA-MM-DD"). */
export function lojasComOferta(ofertas, hoje) {
  return new Set((ofertas ?? []).filter((o) => ofertaValeHoje(o, hoje)).map((o) => o.loja_id));
}

/**
 * Exemplos de um toque para a primeira tela. Lojas com oferta valendo hoje
 * vêm primeiro; depois, a ordem do cadastro. Sem ofertas ainda (carregando),
 * usa só a ordem do cadastro.
 */
export function exemplosRapidos(lojas, ofertas, hoje, quantos = 3) {
  const comOferta = ofertas ? lojasComOferta(ofertas, hoje) : new Set();
  const ordem = [...lojas].sort((a, b) => Number(comOferta.has(b.id)) - Number(comOferta.has(a.id)));
  return ordem.slice(0, quantos).map((loja) => ({
    loja,
    valor_centavos: VALOR_EXEMPLO_CENTAVOS,
    temOferta: comOferta.has(loja.id),
    texto: `${loja.nome} · ${formatarCentavos(VALOR_EXEMPLO_CENTAVOS)}`,
  }));
}

// ---------------------------------------------------------------------------
// Milheiro e cotação usados na conta (mesma regra do motor: o do perfil vence)

export function milheiroDe(programaId, perfil, dados) {
  const doPerfil = perfil?.valor_milheiro_brl ?? {};
  if (Object.hasOwn(doPerfil, programaId) && Number.isSafeInteger(doPerfil[programaId])) {
    return { centavos: doPerfil[programaId], doPerfil: true };
  }
  const programa = dados.programas.find((p) => p.id === programaId);
  const v = programa?.valor_milheiro_brl;
  return Number.isSafeInteger(v) ? { centavos: v, doPerfil: false, estimativa: programa.valor_milheiro_origem === 'estimativa_editavel' } : null;
}

export function cotacaoDe(perfil, dados) {
  if (cotacaoValida(perfil?.cotacao_dolar)) return { x10000: perfil.cotacao_dolar, doPerfil: true, registro: null };
  const registro = (dados.cambio ?? []).find((c) => c.id === ID_COTACAO_DOLAR) ?? null;
  const v = registro?.reais_por_dolar;
  return Number.isSafeInteger(v) && v > 0 ? { x10000: v, doPerfil: false, registro } : null;
}

function rendePorDolar(cartao) {
  return typeof cartao.pontos_por_real !== 'number' && typeof cartao.pontos_por_dolar === 'number' && cartao.status !== A_CONFIRMAR;
}

// ---------------------------------------------------------------------------
// O que a conta supôs

/**
 * Lista, em palavras, os padrões que a conta usou. Cada item diz se dá
 * para mudar no ajuste rápido (`ajuste`) ou só em Meu perfil (`perfil`).
 *
 * @param {object} p
 * @param {object} p.dados
 * @param {object} p.perfil      o perfil que foi para o motor
 * @param {boolean} p.semPerfil  a pessoa ainda não marcou nada
 * @param {object[]} p.jeitos    saída do motor
 */
export function premissasDaConta({ dados, perfil, semPerfil, jeitos }) {
  const lista = [];
  lista.push({ chave: 'vendedor', texto: 'Produto vendido e entregue pela própria loja, não por um vendedor parceiro.' });

  const cartoes = dados.cartoes.filter((c) => perfil.cartoes.includes(c.id));
  if (!cartoes.length) {
    lista.push({ chave: 'cartao', texto: 'Sem cartão de pontos: contamos só os pontos da oferta da loja.', onde: 'ajuste' });
  } else if (semPerfil) {
    lista.push({ chave: 'cartao', texto: `Todos os ${cartoes.length} cartões de pontos que conhecemos. Escolha o seu abaixo para ver só o que é seu.`, onde: 'ajuste' });
  } else if (cartoes.length === 1) {
    lista.push({ chave: 'cartao', texto: `Pagando com o cartão ${cartoes[0].nome}.`, onde: 'ajuste' });
  } else {
    lista.push({ chave: 'cartao', texto: `Os ${cartoes.length} cartões do seu perfil.`, onde: 'ajuste' });
  }

  const clubes = perfil.programas.filter((p) => p.clube_ativo).map((p) => dados.programas.find((x) => x.id === p.programa_id)?.nome ?? p.programa_id);
  lista.push(clubes.length
    ? { chave: 'clube', texto: `Com clube ativo: ${clubes.join(', ')}.`, onde: 'ajuste' }
    : { chave: 'clube', texto: 'Sem assinatura de clube de pontos.', onde: 'ajuste' });

  // Milheiro: só dos programas que deram pontos.
  const programas = new Set();
  for (const j of jeitos) {
    if (j.total_pontos > 0 && j.programa) programas.add(j.programa.id);
    if (j.pontos_do_cartao > 0 && j.cartao) {
      const c = dados.cartoes.find((x) => x.id === j.cartao.id);
      if (c) programas.add(c.programa_id);
    }
  }
  for (const id of programas) {
    const nome = dados.programas.find((p) => p.id === id)?.nome ?? id;
    const m = milheiroDe(id, perfil, dados);
    if (!m) {
      lista.push({ chave: `milheiro-${id}`, texto: `${nome}: ainda sem valor de milheiro confirmado, então mostramos só os pontos.`, onde: 'perfil' });
    } else if (m.doPerfil) {
      lista.push({ chave: `milheiro-${id}`, texto: `1.000 pontos ${nome} valem ${formatarCentavos(m.centavos)} (valor que você informou).`, onde: 'perfil' });
    } else {
      lista.push({ chave: `milheiro-${id}`, texto: `1.000 pontos ${nome} valem uns ${formatarCentavos(m.centavos)}${m.estimativa ? ' (estimativa média)' : ''}.`, onde: 'perfil' });
    }
  }

  if (cartoes.some(rendePorDolar)) {
    const cot = cotacaoDe(perfil, dados);
    if (!cot) {
      lista.push({ chave: 'dolar', texto: 'Falta a cotação do dólar: cartões que dão pontos por dólar contam 0 ponto até você informar.', onde: 'ajuste', falta: true });
    } else if (cot.doPerfil) {
      lista.push({ chave: 'dolar', texto: `Dólar a ${formatarCotacao(cot.x10000)} (valor que você informou).`, onde: 'ajuste' });
    } else {
      const ref = cot.registro?.data_referencia;
      const dia = ref && ref !== A_CONFIRMAR ? ` de ${formatarData(ref)}` : '';
      lista.push({ chave: 'dolar', texto: `Dólar a ${formatarCotacao(cot.x10000)} (PTAX do Banco Central${dia}).`, onde: 'ajuste' });
    }
  }
  return lista;
}

// ---------------------------------------------------------------------------
// Ajuste rápido → perfil

/** Qual opção do "Qual cartão?" está valendo: 'todos', 'nenhum', 'meus' ou o id. */
export function escolhaDeCartao(perfil, dados, semPerfil) {
  if (semPerfil) return 'todos';
  const ids = perfil.cartoes;
  if (!ids.length) return 'nenhum';
  if (ids.length === 1) return ids[0];
  if (ids.length === dados.cartoes.length && dados.cartoes.every((c) => ids.includes(c.id))) return 'todos';
  return 'meus';
}

/**
 * Aplica o ajuste rápido a um perfil (ou a nenhum) e devolve o perfil novo,
 * no formato da versão atual. Sem perfil, parte de "todos os programas, sem
 * clube": assim as ofertas de todos os programas continuam na conta.
 *
 * @param {object|null} atual   perfil salvo (formato v2) ou null
 * @param {object} dados        { programas, cartoes }
 * @param {object} ajuste       { cartao?: 'todos'|'nenhum'|'meus'|id, clube?: { programa_id, ativo, desde? }, cotacao_dolar?: number|null }
 */
export function perfilComAjuste(atual, dados, ajuste) {
  const base = ehVazio(atual)
    ? { programas: dados.programas.map((p) => ({ programa_id: p.id, clube_ativo: false })), cartoes: dados.cartoes.map((c) => c.id) }
    : { programas: atual.programas.map((p) => ({ ...p })), cartoes: [...atual.cartoes] };
  const novo = {
    versao: VERSAO_ATUAL,
    programas: base.programas,
    cartoes: base.cartoes,
    valor_milheiro_brl: { ...(atual?.valor_milheiro_brl ?? {}) },
  };
  if (cotacaoValida(atual?.cotacao_dolar)) novo.cotacao_dolar = atual.cotacao_dolar;

  if (ajuste.cartao !== undefined && ajuste.cartao !== 'meus') {
    if (ajuste.cartao === 'todos') novo.cartoes = dados.cartoes.map((c) => c.id);
    else if (ajuste.cartao === 'nenhum') novo.cartoes = [];
    else if (dados.cartoes.some((c) => c.id === ajuste.cartao)) {
      novo.cartoes = [ajuste.cartao];
      // O programa do cartão entra no perfil, para os pontos dele valerem.
      const programa = dados.cartoes.find((c) => c.id === ajuste.cartao).programa_id;
      if (!novo.programas.some((p) => p.programa_id === programa)) novo.programas.push({ programa_id: programa, clube_ativo: false });
    }
  }

  if (ajuste.clube) {
    const { programa_id: id, ativo, desde } = ajuste.clube;
    let item = novo.programas.find((p) => p.programa_id === id);
    if (!item && dados.programas.some((p) => p.id === id)) {
      item = { programa_id: id, clube_ativo: false };
      novo.programas.push(item);
    }
    if (item) {
      item.clube_ativo = ativo === true;
      if (item.clube_ativo && typeof desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(desde)) item.clube_ativo_desde = desde;
      else delete item.clube_ativo_desde;
    }
  }

  if (Object.hasOwn(ajuste, 'cotacao_dolar')) {
    if (cotacaoValida(ajuste.cotacao_dolar)) novo.cotacao_dolar = ajuste.cotacao_dolar;
    else delete novo.cotacao_dolar;
  }
  return novo;
}

/** Programas com oferta valendo hoje nesta loja: são os clubes que importam no ajuste rápido. */
export function programasComOfertaNaLoja(dados, lojaId, hoje) {
  const ids = new Set(dados.ofertas.filter((o) => o.loja_id === lojaId && ofertaValeHoje(o, hoje)).map((o) => o.programa_id));
  return dados.programas.filter((p) => ids.has(p.id));
}

// ---------------------------------------------------------------------------
// Quais jeitos mostrar

/**
 * Separa a lista do motor em: os que aparecem abertos, os que ficam em
 * "ver mais" e os que não rendem nada (agrupados numa linha só, para a
 * tela não virar uma pilha de "0 ponto").
 * O melhor jeito aparece sempre, mesmo com 0 ponto.
 */
export function separarJeitos(jeitos, abertos = JEITOS_ABERTOS) {
  const [melhor, ...resto] = jeitos;
  if (!melhor) return { melhor: null, abertos: [], recolhidos: [], semPontos: [] };
  const comPontos = resto.filter((j) => j.total_pontos > 0);
  const semPontos = resto.filter((j) => !(j.total_pontos > 0));
  return {
    melhor,
    abertos: comPontos.slice(0, Math.max(0, abertos - 1)),
    recolhidos: comPontos.slice(Math.max(0, abertos - 1)),
    semPontos,
  };
}

/**
 * Por que esses jeitos dão 0 ponto, numa frase. Junta os nomes dos cartões e
 * aponta a causa mais comum (falta do dólar).
 */
export function fraseSemPontos(semPontos, faltaDolar) {
  if (!semPontos.length) return '';
  const nomes = [...new Set(semPontos.map((j) => j.cartao?.nome).filter(Boolean))];
  let quem = 'Os outros jeitos';
  if (nomes.length === 1) quem = `O cartão ${nomes[0]}`;
  else if (nomes.length > 1 && nomes.length <= 3) quem = `Os ${nomes.length} cartões ${nomes.join(', ')}`;
  else if (nomes.length > 3) quem = `Os outros ${nomes.length} cartões`;
  const por = faltaDolar
    ? 'porque eles dão pontos por dólar e falta a cotação do dólar (informe no ajuste acima)'
    : 'com o que sabemos hoje (pontos ainda não confirmados ou sem oferta)';
  return `${quem} não ${nomes.length === 1 ? 'rende' : 'rendem'} pontos nesta compra, ${por}.`;
}

/** Cartão sugerido para a conta da anuidade: o do melhor jeito, senão o primeiro do perfil, senão o primeiro com anuidade. */
export function cartaoSugerido(jeitos, perfil, dados) {
  const doMelhor = jeitos.find((j) => j.cartao && j.total_pontos > 0)?.cartao?.id;
  if (doMelhor) return doMelhor;
  const doPerfil = perfil.cartoes.find((id) => dados.cartoes.some((c) => c.id === id));
  if (doPerfil) return doPerfil;
  return dados.cartoes.find((c) => Number.isSafeInteger(c.anuidade_brl))?.id ?? dados.cartoes[0]?.id ?? null;
}

/** Porcentagem digitada ("5", "5,5", "12,25") → × 100 (500, 550, 1225). null se vazia ou inválida. */
export function lerPorcento(texto) {
  const t = String(texto ?? '').trim().replace('%', '').trim();
  if (!t) return null;
  const m = /^(\d{1,3})(?:[,.](\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  return v <= 10000 ? v : null;
}

/**
 * Texto da resposta "a anuidade compensa?". Sem gasto informado, a pergunta
 * útil vira "a partir de quanto por mês compensa?".
 *
 * @param {object} r                saída de calcularAnuidade
 * @param {boolean} gastoInformado
 * @returns {{ principal: string, detalhes: string[] }}
 */
export function textoAnuidade(r, gastoInformado) {
  const detalhes = [];
  if (r.anuidade_centavos === 0) {
    return { principal: `O cartão ${r.cartao.nome} não tem anuidade no nosso cadastro: qualquer ponto que ele der é lucro.`, detalhes: r.avisos };
  }
  let principal;
  if (!gastoInformado) {
    if (r.gasto_mensal_de_empate_centavos !== null) {
      principal =
        `Para os pontos pagarem a anuidade de ${formatarCentavos(r.anuidade_centavos)}, ` +
        `você precisa gastar pelo menos ${formatarCentavos(r.gasto_mensal_de_empate_centavos)} por mês no ${r.cartao.nome}. Diga o seu gasto para ver a conta.`;
    } else if (r.anuidade_centavos !== null && r.situacao !== 'sem_conta') {
      principal = `Com esse valor de milheiro, nenhum gasto faz os pontos do ${r.cartao.nome} pagarem a anuidade de ${formatarCentavos(r.anuidade_centavos)}.`;
    } else {
      principal = `Ainda não dá para fazer a conta da anuidade do ${r.cartao.nome}:`;
    }
  } else {
    principal = r.veredito;
    if (r.pontos_por_ano) detalhes.push(`Pontos por ano: ${r.pontos_por_ano.texto}.`);
    if (r.valor_dos_pontos) detalhes.push(`Valor desses pontos: uns ${r.valor_dos_pontos.texto}.`);
    if (r.anuidade_centavos !== null) detalhes.push(`Anuidade: ${formatarCentavos(r.anuidade_centavos)}.`);
    if (r.cashback_alternativo) detalhes.push(`O cartão sem anuidade devolveria ${r.cashback_alternativo.texto}.`);
  }
  return { principal, detalhes: [...detalhes, ...r.avisos.filter((a) => !principal.includes(a))] };
}
