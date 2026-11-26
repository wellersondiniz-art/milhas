// Motor das viagens: transferência de pontos com bônus, pontos ao comprar
// passagem e pontos ao reservar hotel.
//
// Mesmas regras do resto do motor (CLAUDE.md): funções puras, sem DOM, sem
// rede, sem ler o relógio. Dinheiro em centavos inteiros; as contas usam
// BigInt com escala fixa e só a exibição arredonda:
//   - pontos × 1.000.000                       (ESCALA_PONTOS)
//   - valor em bilionésimos de centavo         (ESCALA_VALOR)
//   - pontos por unidade de moeda × 10.000     (aceita até 4 casas: 12,5; 6,25)
//   - cotação × 10.000                         (R$ 6,4413 = 64413)
// O "milheiro" (quanto valem 1.000 pontos) circula em bilionésimos de centavo,
// porque o do ALL Accor vem em euro (1.000 pontos = 20 euros) e vira real
// pela cotação: 20 × 6,4413 = R$ 128,826, que não cabe em centavos inteiros.

import { diasEntre, lerDataHora } from './datas.js';
import {
  ESCALA_PONTOS, ESCALA_VALOR, formatarCentavos, formatarCotacao, formatarData, formatarNumero, formatarPontos, formatarValor,
} from './formatar.js';

export const A_CONFIRMAR = 'A_CONFIRMAR';
export const ID_DOLAR = 'usd-brl';
export const ID_EURO = 'eur-brl';
/** Dado verificado há mais que isso ganha aviso (mesmo prazo do resto do site). */
export const DIAS_DADO_ANTIGO = 14;

const ESCALA_UNIDADE = 10_000n;
const ESCALA_COTACAO = 10_000n;
const MIL = 1000n;
const NOME_MOEDA = { BRL: 'real', USD: 'dólar', EUR: 'euro' };
const SIMBOLO = { USD: 'US$', EUR: '€' };

function erro(msg) {
  return new Error(`motor das viagens: ${msg}`);
}

/** Número com até 4 casas → BigInt × 10.000. null se não for número. */
function escalar4(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  const s = Math.round(n * 10_000);
  if (Math.abs(s - n * 10_000) > 1e-6) throw erro(`número com mais de 4 casas decimais: ${n}`);
  return BigInt(s);
}

function inteiroPositivo(v) {
  return Number.isSafeInteger(v) && v > 0;
}

function lista(dados, nome) {
  const v = dados?.[nome];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw erro(`dados.${nome} precisa ser uma lista`);
  return v;
}

function porId(itens) {
  const mapa = new Map();
  for (const item of itens) if (!mapa.has(item.id)) mapa.set(item.id, item);
  return mapa;
}

/** Vale hoje? Início e fim A_CONFIRMAR não tiram do ar (entram com aviso). */
function valeHoje(registro, hoje) {
  if (registro.inicio && registro.inicio !== A_CONFIRMAR && registro.inicio > hoje) return false;
  if (registro.fim && registro.fim !== A_CONFIRMAR && registro.fim < hoje) return false;
  return true;
}

function avisarAntigo(registro, rotulo, hoje, avisos) {
  if (typeof registro?.verificado_em !== 'string') return;
  const dias = diasEntre(registro.verificado_em, hoje);
  if (dias > DIAS_DADO_ANTIGO) avisos.push(`Dado conferido há ${dias} dias (${rotulo}): confira na fonte antes de decidir.`);
}

/** Valor (bilionésimos de centavo) de `esc` pontos com milheiro `milheiroBil` (bilionésimos por 1.000 pontos). */
function valorDe(esc, milheiroBil) {
  return (esc * milheiroBil) / (MIL * ESCALA_PONTOS);
}

// ---------------------------------------------------------------------------
// Contexto comum: nomes, milheiros e cotações

/**
 * @param {object|null} perfil  { cartoes, valor_milheiro_brl, cotacao_dolar } (pode faltar)
 * @param {object} cotacoesDaTela { USD?, EUR? } em reais × 10.000, digitadas na tela
 */
function montarContexto(perfil, dados, hoje, cotacoesDaTela = {}) {
  lerDataHora(hoje);
  const programas = porId(lista(dados, 'programas'));
  const viagens = lista(dados, 'viagens');
  const milheiroDoPerfil = perfil?.valor_milheiro_brl ?? {};
  for (const [id, v] of Object.entries(milheiroDoPerfil)) {
    if (!Number.isSafeInteger(v) || v < 0) throw erro(`valor_milheiro_brl de "${id}" precisa ser centavos inteiros >= 0`);
  }
  for (const [moeda, v] of Object.entries(cotacoesDaTela ?? {})) {
    if (v !== undefined && v !== null && !inteiroPositivo(v)) throw erro(`cotação de ${moeda} precisa ser inteiro > 0 (reais × 10.000)`);
  }
  if (perfil?.cotacao_dolar !== undefined && !inteiroPositivo(perfil.cotacao_dolar)) {
    throw erro('cotacao_dolar do perfil precisa ser inteiro > 0 (reais × 10.000)');
  }
  const dolar = lista(dados, 'cambio').find((c) => c.id === ID_DOLAR) ?? null;
  const euro = lista(dados, 'cotacoes').find((c) => c.id === ID_EURO) ?? null;

  const ctx = {
    hoje,
    programas,
    nomePrograma: (id) => programas.get(id)?.nome ?? id,
    /**
     * Cotação de uma moeda em reais × 10.000 (BigInt) e de onde veio.
     * Ordem: o que a pessoa digitou na tela > perfil (dólar) > dados. null se ninguém sabe.
     */
    cotacao(moeda) {
      if (moeda === 'BRL') return { x10000: ESCALA_COTACAO, origem: null };
      const daTela = cotacoesDaTela?.[moeda];
      if (inteiroPositivo(daTela)) return { x10000: BigInt(daTela), origem: 'o valor que você digitou' };
      if (moeda === 'USD') {
        if (perfil?.cotacao_dolar !== undefined) return { x10000: BigInt(perfil.cotacao_dolar), origem: 'o valor do seu perfil' };
        if (inteiroPositivo(dolar?.reais_por_dolar)) {
          return { x10000: BigInt(dolar.reais_por_dolar), origem: textoPtax(dolar.data_referencia), registro: dolar };
        }
      }
      if (moeda === 'EUR' && inteiroPositivo(euro?.reais_por_unidade)) {
        return { x10000: BigInt(euro.reais_por_unidade), origem: textoPtax(euro.data_referencia), registro: euro };
      }
      return null;
    },
    /**
     * Milheiro do programa em bilionésimos de centavo por 1.000 pontos.
     * Ordem: perfil > programas.json > valor oficial em outra moeda (viagens.json, ex.: ALL em euro).
     */
    milheiro(id) {
      if (Object.hasOwn(milheiroDoPerfil, id)) {
        return { bil: BigInt(milheiroDoPerfil[id]) * ESCALA_VALOR, texto: `${formatarCentavos(milheiroDoPerfil[id])} (o valor do seu perfil)` };
      }
      const p = programas.get(id);
      if (Number.isSafeInteger(p?.valor_milheiro_brl)) {
        const tipo = p.valor_milheiro_origem === 'estimativa_editavel' ? 'estimativa' : 'valor confirmado';
        return { bil: BigInt(p.valor_milheiro_brl) * ESCALA_VALOR, texto: `${formatarCentavos(p.valor_milheiro_brl)} (${tipo})` };
      }
      const oficial = viagens.find((r) => r.programa_id === id && r.valor_do_ponto)?.valor_do_ponto;
      if (oficial) {
        const cot = ctx.cotacao(oficial.moeda);
        if (!cot) return null;
        const bil = (BigInt(oficial.centimos_por_mil) * cot.x10000 * ESCALA_VALOR) / ESCALA_COTACAO;
        return {
          bil,
          desconto_em: oficial.moeda,
          texto: `${formatarValor(bil)} (1.000 pontos = ${SIMBOLO[oficial.moeda]} ${formatarNumero(oficial.centimos_por_mil / 100)} em desconto, ` +
            `com o ${NOME_MOEDA[oficial.moeda]} a ${formatarCotacao(Number(cot.x10000))}, ${cot.origem})`,
        };
      }
      return null;
    },
  };
  return ctx;
}

function textoPtax(data) {
  return data && data !== A_CONFIRMAR ? `PTAX de ${formatarData(data)}` : 'PTAX';
}

// ---------------------------------------------------------------------------
// Transferência de pontos com bônus

/** Campanha de bônus da rota que vale hoje (a de maior bônus, se houver mais de uma). */
function campanhaDeHoje(campanhas, rotaId, hoje) {
  const validas = campanhas.filter((c) => c.transferencia_id === rotaId && valeHoje(c, hoje));
  const maior = (c) => Math.max(...c.faixas.map((f) => (typeof f.bonus_percentual === 'number' ? f.bonus_percentual : -1)));
  return validas.sort((a, b) => maior(b) - maior(a) || a.id.localeCompare(b.id))[0] ?? null;
}

/** A última campanha que já terminou e a próxima que ainda vai começar (para dar contexto). */
function outrasCampanhas(campanhas, rotaId, hoje) {
  const daRota = campanhas.filter((c) => c.transferencia_id === rotaId);
  const passadas = daRota.filter((c) => c.fim !== A_CONFIRMAR && c.fim < hoje).sort((a, b) => b.fim.localeCompare(a.fim));
  const futuras = daRota.filter((c) => c.inicio !== A_CONFIRMAR && c.inicio > hoje).sort((a, b) => a.inicio.localeCompare(b.inicio));
  return { ultima: passadas[0] ?? null, proxima: futuras[0] ?? null };
}

/** Faixa da campanha: a primeira (vale para todos) ou, com `maior`, a de maior bônus confirmado. */
function escolherFaixa(campanha, faixa) {
  const confirmadas = campanha.faixas.filter((f) => typeof f.bonus_percentual === 'number');
  if (faixa === 'maior' && confirmadas.length) {
    return confirmadas.reduce((a, b) => (b.bonus_percentual > a.bonus_percentual ? b : a));
  }
  return campanha.faixas[0];
}

function faixaTexto(campanha) {
  return campanha.faixas
    .map((f) => `${typeof f.bonus_percentual === 'number' ? `${f.bonus_percentual}%` : 'bônus a confirmar'} para ${f.quem.charAt(0).toLowerCase()}${f.quem.slice(1)}`)
    .join('; ');
}

function validarEntradaTransferencia(entrada) {
  if (!entrada || typeof entrada.origem_id !== 'string') throw erro('falta "origem_id"');
  if (!Number.isSafeInteger(entrada.pontos) || entrada.pontos < 0) throw erro(`"pontos" precisa ser inteiro >= 0 (recebido: ${entrada.pontos})`);
  if (entrada.faixa !== undefined && entrada.faixa !== 'todos' && entrada.faixa !== 'maior') throw erro('"faixa" é "todos" ou "maior"');
  if (entrada.custo_milheiro_origem !== undefined && entrada.custo_milheiro_origem !== null
    && (!Number.isSafeInteger(entrada.custo_milheiro_origem) || entrada.custo_milheiro_origem < 0)) {
    throw erro('"custo_milheiro_origem" precisa ser centavos inteiros >= 0');
  }
  for (const [id, v] of Object.entries(entrada.bonus_manual ?? {})) {
    if (v !== null && v !== undefined && (!Number.isSafeInteger(v) || v < 0 || v > 1000)) {
      throw erro(`bônus digitado para "${id}" precisa ser inteiro entre 0 e 1000`);
    }
  }
}

/**
 * Uma rota: quantas milhas chegam, com qual bônus, quanto custa o milheiro no destino
 * e se vale a pena perto do valor estimado das milhas.
 */
function calcularRota(rota, entrada, campanhas, ctx) {
  const avisos = [];
  const passos = [];
  const destino = ctx.programas.get(rota.destino_id);
  const nomeOrigem = ctx.nomePrograma(rota.origem_id);
  const nomeDestino = ctx.nomePrograma(rota.destino_id);
  const { ultima, proxima } = outrasCampanhas(campanhas, rota.id, ctx.hoje);
  const base = {
    rota, destino_id: rota.destino_id, nome_destino: nomeDestino, nome_origem: nomeOrigem,
    ultima_campanha: ultima, proxima_campanha: proxima, avisos, passos,
  };
  avisarAntigo(rota, `transferência ${nomeOrigem} → ${nomeDestino}`, ctx.hoje, avisos);

  if (rota.paridade === A_CONFIRMAR) {
    return { ...base, calculavel: false, motivo: `A ${nomeDestino} diz que aceita pontos da ${nomeOrigem}, mas a proporção ainda não foi conferida.` };
  }
  const po = BigInt(rota.paridade.pontos_origem);
  const pd = BigInt(rota.paridade.pontos_destino);
  const pontos = BigInt(entrada.pontos);

  // Blocos: a transferência anda em múltiplos e precisa fechar a proporção.
  let usados = pontos;
  if (inteiroPositivo(rota.multiplo_origem)) usados = (usados / BigInt(rota.multiplo_origem)) * BigInt(rota.multiplo_origem);
  else avisos.push(`A ${nomeOrigem} pode exigir blocos de pontos: o múltiplo desta transferência não está confirmado.`);
  usados = (usados / po) * po;
  const sobra = pontos - usados;
  const minimo = inteiroPositivo(rota.minimo_origem) ? BigInt(rota.minimo_origem) : null;
  const abaixoDoMinimo = minimo !== null && usados < minimo;
  if (rota.minimo_origem === A_CONFIRMAR) avisos.push('O mínimo de pontos desta transferência não está confirmado.');
  if (abaixoDoMinimo) {
    avisos.push(`O mínimo para transferir é ${formatarPontos(minimo * ESCALA_PONTOS)} pontos ${nomeOrigem}; faltam ${formatarPontos((minimo - usados) * ESCALA_PONTOS)}.`);
  }
  if (sobra > 0n) passos.push(`${formatarPontos(sobra * ESCALA_PONTOS)} pontos ficam na ${nomeOrigem}, porque a transferência anda em blocos.`);

  const milhasBase = (usados / po) * pd * ESCALA_PONTOS;
  const proporcao = po === pd ? '1 para 1' : `${formatarNumero(Number(po) / Number(pd))} pontos ${nomeOrigem} para 1 ${nomeDestino}`;
  passos.push(`${formatarPontos(usados * ESCALA_PONTOS)} pontos ${nomeOrigem}, na proporção ${proporcao}, viram ${formatarPontos(milhasBase)} pontos ${nomeDestino}.`);

  // Bônus: o que a pessoa digitou vence a campanha cadastrada.
  const campanha = campanhaDeHoje(campanhas, rota.id, ctx.hoje);
  const manual = entrada.bonus_manual?.[rota.destino_id];
  let bonus = 0;
  let bonusDe = 'nenhum';
  let faixa = null;
  if (Number.isSafeInteger(manual)) {
    bonus = manual;
    bonusDe = 'digitado';
    passos.push(`Bônus que você digitou: ${bonus}%.`);
  } else if (campanha) {
    faixa = escolherFaixa(campanha, entrada.faixa);
    if (typeof faixa.bonus_percentual === 'number') {
      bonus = faixa.bonus_percentual;
      bonusDe = 'campanha';
      passos.push(`Campanha de hoje: ${bonus}% de bônus (${faixa.quem.toLowerCase()}).`);
    } else {
      avisos.push('O bônus desta faixa da campanha não está confirmado; contamos sem bônus.');
    }
    if (campanha.exige_cadastro) avisos.push(`Para ganhar o bônus, cadastre-se na campanha da ${nomeDestino} antes de transferir.`);
    if (campanha.fim === A_CONFIRMAR) avisos.push('O fim da campanha não está confirmado.');
    else if (campanha.fim === ctx.hoje) avisos.push('A campanha termina hoje.');
    avisarAntigo(campanha, 'campanha de bônus', ctx.hoje, avisos);
  } else {
    passos.push('Sem campanha de bônus cadastrada para hoje: contamos 0% de bônus.');
  }

  let milhasBonus = (milhasBase * BigInt(bonus)) / 100n;
  let bonusLimitado = false;
  if (bonusDe === 'campanha' && inteiroPositivo(campanha.limite_bonus) && milhasBonus > BigInt(campanha.limite_bonus) * ESCALA_PONTOS) {
    milhasBonus = BigInt(campanha.limite_bonus) * ESCALA_PONTOS;
    bonusLimitado = true;
    avisos.push(`A campanha limita o bônus a ${formatarPontos(milhasBonus)} pontos por pessoa.`);
  }
  if (bonus > 0) passos.push(`Bônus: ${formatarPontos(milhasBase)} × ${bonus}% = ${formatarPontos(milhasBonus)}${bonusLimitado ? ' (no limite da campanha)' : ''}.`);
  const milhasTotal = milhasBase + milhasBonus;
  passos.push(`Total na ${nomeDestino}: ${formatarPontos(milhasTotal)}.`);

  // Dinheiro: quanto os pontos de origem valem (ou custaram) e quanto as milhas valem.
  const custoDigitado = Number.isSafeInteger(entrada.custo_milheiro_origem);
  const milheiroOrigem = custoDigitado
    ? { bil: BigInt(entrada.custo_milheiro_origem) * ESCALA_VALOR, texto: `${formatarCentavos(entrada.custo_milheiro_origem)} (o que você pagou)` }
    : ctx.milheiro(rota.origem_id);
  const milheiroDestino = ctx.milheiro(rota.destino_id);
  let custoTotal = null;
  let custoMilheiroDestino = null;
  let valorDestino = null;
  let ganho = null;
  if (milheiroOrigem) {
    custoTotal = (usados * milheiroOrigem.bil) / MIL;
    passos.push(`Os ${formatarPontos(usados * ESCALA_PONTOS)} pontos ${nomeOrigem} valem ${formatarValor(custoTotal)}, com o milheiro a ${milheiroOrigem.texto}.`);
    if (milhasTotal > 0n) {
      custoMilheiroDestino = (custoTotal * MIL * ESCALA_PONTOS) / milhasTotal;
      passos.push(`Cada 1.000 pontos ${nomeDestino} saem por ${formatarValor(custoMilheiroDestino)} (${formatarValor(custoTotal)} ÷ ${formatarPontos(milhasTotal)} × 1.000).`);
    }
  } else {
    avisos.push(`Não sabemos quanto valem os pontos ${nomeOrigem}: diga quanto pagou por 1.000 pontos para ver o custo do milheiro.`);
  }
  if (milheiroDestino) {
    valorDestino = valorDe(milhasTotal, milheiroDestino.bil);
    passos.push(`As milhas valem ${formatarValor(valorDestino)}, com o milheiro ${nomeDestino} a ${milheiroDestino.texto}.`);
    if (custoTotal !== null) ganho = valorDestino - custoTotal;
    if (milheiroDestino.desconto_em) {
      avisos.push(`Esse valor é o desconto que os pontos ${nomeDestino} dão na reserva. Só compensa se você vai usar: fora disso, eles não valem nada.`);
    }
  } else {
    avisos.push(`Ainda não há valor estimado para os pontos ${nomeDestino}; mostramos só a quantidade.`);
  }

  return {
    ...base,
    calculavel: true,
    abaixo_do_minimo: abaixoDoMinimo,
    campanha,
    faixa,
    bonus_percentual: bonus,
    bonus_de: bonusDe,
    bonus_limitado: bonusLimitado,
    pontos_usados: Number(usados),
    sobra: Number(sobra),
    milhas_base: milhasBase,
    milhas_bonus: milhasBonus,
    milhas_total: milhasTotal,
    custo_total: custoTotal,
    custo_milheiro_destino: custoMilheiroDestino,
    valor_destino: valorDestino,
    ganho,
    milheiro_destino_texto: milheiroDestino?.texto ?? null,
    so_desconto: Boolean(milheiroDestino?.desconto_em),
    tipo_destino: destino?.tipo ?? null,
  };
}

/**
 * Para onde mandar os pontos de um programa: todas as rotas que saem dele,
 * da que rende mais para a que rende menos.
 *
 * @param {{ origem_id: string, pontos: number, destino_id?: string, faixa?: 'todos'|'maior',
 *           custo_milheiro_origem?: number|null, bonus_manual?: Record<string, number|null>,
 *           cotacoes?: { USD?: number, EUR?: number } }} entrada
 * @param {object|null} perfil  usa só valor_milheiro_brl e cotacao_dolar
 */
export function calcularTransferencias(entrada, perfil, dados, hoje) {
  validarEntradaTransferencia(entrada);
  const ctx = montarContexto(perfil, dados, hoje, entrada.cotacoes);
  if (!ctx.programas.has(entrada.origem_id)) throw erro(`programa "${entrada.origem_id}" não existe nos dados`);
  const campanhas = lista(dados, 'bonus-transferencia');
  const rotas = lista(dados, 'transferencias')
    .filter((r) => r.origem_id === entrada.origem_id)
    .filter((r) => !entrada.destino_id || r.destino_id === entrada.destino_id);
  const opcoes = rotas.map((r) => calcularRota(r, entrada, campanhas, ctx));
  opcoes.sort(ordemDasRotas);
  return { origem_id: entrada.origem_id, nome_origem: ctx.nomePrograma(entrada.origem_id), pontos: entrada.pontos, opcoes };
}

function ordemDasRotas(a, b) {
  // Calculável e acima do mínimo primeiro; depois mais valor; depois mais milhas; empate pelo id.
  // Pontos que só valem como desconto num lugar (ALL Accor em hotel Accor) vêm depois
  // das milhas que servem para qualquer passagem: valem muito, mas só para quem vai usar.
  const nota = (o) => (!o.calculavel ? 3 : o.abaixo_do_minimo ? 2 : o.so_desconto ? 1 : 0);
  if (nota(a) !== nota(b)) return nota(a) - nota(b);
  if (a.calculavel && b.calculavel) {
    if (a.valor_destino !== null && b.valor_destino !== null && a.valor_destino !== b.valor_destino) return a.valor_destino > b.valor_destino ? -1 : 1;
    if ((a.valor_destino === null) !== (b.valor_destino === null)) return a.valor_destino === null ? 1 : -1;
    if (a.milhas_total !== b.milhas_total) return a.milhas_total > b.milhas_total ? -1 : 1;
  }
  return a.rota.id.localeCompare(b.rota.id);
}

/** Campanhas de bônus que valem hoje, com a rota e o maior bônus, da maior para a menor. */
export function campanhasDeHoje(dados, hoje) {
  lerDataHora(hoje);
  const rotas = porId(lista(dados, 'transferencias'));
  const programas = porId(lista(dados, 'programas'));
  const nome = (id) => programas.get(id)?.nome ?? id;
  return lista(dados, 'bonus-transferencia')
    .filter((c) => valeHoje(c, hoje) && rotas.has(c.transferencia_id) && rotas.get(c.transferencia_id).paridade !== A_CONFIRMAR)
    .map((c) => {
      const rota = rotas.get(c.transferencia_id);
      const numeros = c.faixas.map((f) => f.bonus_percentual).filter((v) => typeof v === 'number');
      return {
        campanha: c,
        rota,
        nome_origem: nome(rota.origem_id),
        nome_destino: nome(rota.destino_id),
        maior_bonus: numeros.length ? Math.max(...numeros) : null,
        faixas_texto: faixaTexto(c),
        termina_hoje: c.fim === hoje,
      };
    })
    .sort((a, b) => (b.maior_bonus ?? -1) - (a.maior_bonus ?? -1) || a.campanha.id.localeCompare(b.campanha.id));
}

/** Programas que mandam pontos para algum lugar (para a lista "De onde saem os pontos"). */
export function origensDeTransferencia(dados) {
  const programas = porId(lista(dados, 'programas'));
  const ids = [...new Set(lista(dados, 'transferencias').map((t) => t.origem_id))];
  return ids.map((id) => ({ id, nome: programas.get(id)?.nome ?? id })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Passagem e hotel

function validarEntradaViagem(entrada) {
  if (!entrada || (entrada.tipo !== 'passagem' && entrada.tipo !== 'hotel')) throw erro('"tipo" é "passagem" ou "hotel"');
  if (!Number.isSafeInteger(entrada.valor_centavos) || entrada.valor_centavos < 0) throw erro('"valor_centavos" precisa ser inteiro >= 0');
  const taxas = entrada.taxas_centavos ?? 0;
  if (!Number.isSafeInteger(taxas) || taxas < 0) throw erro('"taxas_centavos" precisa ser inteiro >= 0');
  if (entrada.tipo === 'passagem' && entrada.trechos !== 'nacional_e_america_do_sul' && entrada.trechos !== 'fora_da_america_do_sul') {
    throw erro('passagem precisa de "trechos": nacional_e_america_do_sul ou fora_da_america_do_sul');
  }
}

/** Perguntas (tarifa, marca do hotel) das regras que sobraram, com a resposta padrão = a primeira nos dados. */
export function perguntasDasRegras(regras) {
  const perguntas = new Map();
  for (const r of regras) {
    if (!r.escolha) continue;
    const { pergunta_id: id, pergunta, resposta_id: rid, resposta } = r.escolha;
    if (!perguntas.has(id)) perguntas.set(id, { pergunta_id: id, pergunta, respostas: [] });
    const p = perguntas.get(id);
    if (!p.respostas.some((x) => x.id === rid)) p.respostas.push({ id: rid, texto: resposta });
  }
  return [...perguntas.values()];
}

/** Regras de viagem que podem valer para a compra (antes das perguntas). */
export function regrasDaCompra(dados, { tipo, trechos, vendedor }, hoje) {
  return lista(dados, 'viagens')
    .filter((r) => r.tipo === tipo)
    .filter((r) => r.status !== A_CONFIRMAR)
    .filter((r) => valeHoje(r, hoje))
    .filter((r) => tipo === 'hotel' || !trechos || r.trechos === 'todos' || r.trechos === trechos)
    .filter((r) => !vendedor || r.vendedor === vendedor);
}

/** Lojas/companhias de um tipo, na ordem dos dados, sem repetir. */
export function vendedores(dados, tipo) {
  return [...new Set(lista(dados, 'viagens').filter((r) => r.tipo === tipo).map((r) => r.vendedor))];
}

/** Pontos do programa da viagem: { esc, nivel, cotacao } ou { esc: null } se falta cotação/nível. */
function pontosDaRegra(regra, entrada, ctx, avisos, passos) {
  const pedido = entrada.niveis?.[regra.programa_id];
  let nivel = regra.niveis.find((n) => n.id === pedido);
  if (!nivel) {
    nivel = regra.niveis[0];
    if (regra.niveis.length > 1) {
      avisos.push(`Contamos a categoria ${nivel.nome.replace(/ \(inicial\)$/, '')}, a inicial. Se você tem categoria mais alta, informe em "Sua categoria nos programas" e veja quanto sobe.`);
    }
  }
  const nome = ctx.nomePrograma(regra.programa_id);
  const ppu = escalar4(nivel.pontos);
  if (ppu === null) {
    avisos.push(`Os pontos da categoria ${nivel.nome} não estão confirmados; ficam fora da conta.`);
    return { esc: null, nivel };
  }
  const cot = ctx.cotacao(regra.moeda);
  if (!cot) {
    avisos.push(`A ${regra.vendedor} conta em ${NOME_MOEDA[regra.moeda]}, e falta a cotação. Digite a cotação para ver os pontos.`);
    return { esc: null, nivel };
  }
  // pontos × 1.000.000 = centavos × (pontos × 10.000) × 10.000 ÷ (cotação × 10.000 × a_cada)
  const esc = (BigInt(entrada.valor_centavos) * ppu * ESCALA_COTACAO * ESCALA_PONTOS) / (cot.x10000 * BigInt(regra.a_cada) * ESCALA_UNIDADE * 100n);
  const porQuanto = regra.a_cada === 1 ? `por ${NOME_MOEDA[regra.moeda]}` : `a cada ${regra.a_cada} ${NOME_MOEDA[regra.moeda]}s`;
  if (regra.moeda === 'BRL') {
    passos.push(`${nome}, categoria ${nivel.nome}: ${formatarCentavos(entrada.valor_centavos)} × ${formatarNumero(nivel.pontos)} ${porQuanto} = ${formatarPontos(esc)} pontos.`);
  } else {
    const emMoeda = (BigInt(entrada.valor_centavos) * ESCALA_COTACAO) / cot.x10000;
    passos.push(
      `${formatarCentavos(entrada.valor_centavos)} ÷ ${formatarCotacao(Number(cot.x10000))} (${cot.origem}) = ${SIMBOLO[regra.moeda]} ${formatarCentavos(Number(emMoeda)).replace(/^R\$ /, '')}.`,
      `${nome}, categoria ${nivel.nome}: ${formatarNumero(nivel.pontos)} pontos ${porQuanto} = ${formatarPontos(esc)} pontos.`,
    );
    avisos.push(`A conta usa o ${NOME_MOEDA[regra.moeda]} a ${formatarCotacao(Number(cot.x10000))} (${cot.origem}); o programa usa a cotação dele, então os pontos podem variar um pouco.`);
  }
  if (inteiroPositivo(regra.teto_por_trecho) && esc > BigInt(regra.teto_por_trecho) * ESCALA_PONTOS) {
    avisos.push(`O programa limita a ${formatarPontos(BigInt(regra.teto_por_trecho) * ESCALA_PONTOS)} pontos por trecho: se for um trecho só, você recebe no máximo isso.`);
  }
  return { esc, nivel };
}

/** O melhor cartão do perfil para pagar a compra inteira (tarifa + taxas). */
function melhorCartao(perfil, dados, totalCentavos, ctx) {
  const cartoes = porId(lista(dados, 'cartoes'));
  const ids = [...new Set(perfil?.cartoes ?? [])].filter((id) => cartoes.has(id));
  let melhor = null;
  for (const id of ids) {
    const c = cartoes.get(id);
    if (c.status === A_CONFIRMAR) continue;
    const ppr = escalar4(c.pontos_por_real);
    const ppd = ppr === null ? escalar4(c.pontos_por_dolar) : null;
    let esc = null;
    let conta = '';
    if (ppr !== null) {
      esc = ppr * BigInt(totalCentavos);
      conta = `${formatarCentavos(totalCentavos)} × ${formatarNumero(c.pontos_por_real)} pontos por real`;
    } else if (ppd !== null) {
      const cot = ctx.cotacao('USD');
      if (!cot) continue;
      esc = (BigInt(totalCentavos) * ppd * ESCALA_COTACAO) / cot.x10000;
      conta = `${formatarCentavos(totalCentavos)} ÷ ${formatarCotacao(Number(cot.x10000))} × ${formatarNumero(c.pontos_por_dolar)} pontos por dólar`;
    }
    if (esc === null) continue;
    const m = ctx.milheiro(c.programa_id);
    const valor = m ? valorDe(esc, m.bil) : null;
    const candidato = { cartao: c, nome_programa: ctx.nomePrograma(c.programa_id), esc, valor, conta };
    const vence = !melhor
      || (valor !== null && (melhor.valor === null || valor > melhor.valor))
      || (valor === null && melhor.valor === null && esc > melhor.esc);
    if (vence) melhor = candidato;
  }
  return melhor;
}

/**
 * Quanto rende uma passagem ou um hotel, por programa, somando o cartão do perfil.
 *
 * @param {{ tipo: 'passagem'|'hotel', valor_centavos: number, taxas_centavos?: number,
 *           trechos?: string, vendedor?: string, respostas?: Record<string,string>,
 *           niveis?: Record<string,string>, cotacoes?: { USD?: number, EUR?: number } }} entrada
 *   valor_centavos = o que o programa conta (tarifa ou diária sem taxas);
 *   taxas_centavos = o resto que vai no cartão (só o cartão pontua sobre isso).
 * @param {object|null} perfil  { cartoes, valor_milheiro_brl, cotacao_dolar }
 */
export function calcularViagem(entrada, perfil, dados, hoje) {
  validarEntradaViagem(entrada);
  const ctx = montarContexto(perfil, dados, hoje, entrada.cotacoes);
  const candidatas = regrasDaCompra(dados, entrada, hoje);
  // A ordem das respostas vem de todas as regras do tipo (a primeira é o padrão),
  // não só das que sobraram pelo trecho: assim o padrão não muda ao trocar de trecho.
  const daMesmaCompra = regrasDaCompra(dados, { ...entrada, trechos: undefined }, hoje);
  const existentes = new Set(candidatas.filter((r) => r.escolha).map((r) => `${r.escolha.pergunta_id}\0${r.escolha.resposta_id}`));
  const perguntas = perguntasDasRegras(daMesmaCompra)
    .map((p) => ({ ...p, respostas: p.respostas.filter((x) => existentes.has(`${p.pergunta_id}\0${x.id}`)) }))
    .filter((p) => p.respostas.length);
  const respostas = {};
  for (const p of perguntas) {
    const pedida = entrada.respostas?.[p.pergunta_id];
    respostas[p.pergunta_id] = p.respostas.some((r) => r.id === pedida) ? pedida : p.respostas[0].id;
  }
  const regras = candidatas.filter((r) => !r.escolha || respostas[r.escolha.pergunta_id] === r.escolha.resposta_id);
  const total = entrada.valor_centavos + (entrada.taxas_centavos ?? 0);
  const cartao = melhorCartao(perfil, dados, total, ctx);

  const jeitos = regras.map((regra) => {
    const avisos = [];
    const passos = [];
    avisarAntigo(regra, `${regra.vendedor}`, hoje, avisos);
    if (regra.fim && regra.fim !== A_CONFIRMAR) {
      const dias = diasEntre(hoje, regra.fim);
      if (dias <= 7) avisos.push(`Esta regra vale até ${formatarData(regra.fim)}.`);
    }
    const { esc, nivel } = pontosDaRegra(regra, entrada, ctx, avisos, passos);
    const m = ctx.milheiro(regra.programa_id);
    const valor = esc !== null && m ? valorDe(esc, m.bil) : null;
    if (esc !== null && m) passos.push(`Valor estimado: ${formatarPontos(esc)} pontos × ${m.texto} por 1.000 = ${formatarValor(valor)}.`);
    if (esc !== null && !m) avisos.push(`Ainda não há valor estimado para os pontos ${ctx.nomePrograma(regra.programa_id)}; mostramos só a quantidade.`);
    let valorCartao = null;
    if (cartao) {
      passos.push(`Cartão ${cartao.cartao.nome}: ${cartao.conta} = ${formatarPontos(cartao.esc)} pontos ${cartao.nome_programa}.`);
      valorCartao = cartao.valor;
    }
    const totalValor = valor !== null && (!cartao || valorCartao !== null) ? valor + (valorCartao ?? 0n) : null;
    return {
      regra,
      nome_programa: ctx.nomePrograma(regra.programa_id),
      nivel,
      pontos: esc,
      valor,
      cartao,
      valor_total: totalValor,
      avisos,
      passos,
    };
  });
  jeitos.sort((a, b) => {
    if (a.valor_total !== null && b.valor_total !== null && a.valor_total !== b.valor_total) return a.valor_total > b.valor_total ? -1 : 1;
    if ((a.valor_total === null) !== (b.valor_total === null)) return a.valor_total === null ? 1 : -1;
    if ((a.pontos ?? -1n) !== (b.pontos ?? -1n)) return (a.pontos ?? -1n) > (b.pontos ?? -1n) ? -1 : 1;
    return a.regra.id.localeCompare(b.regra.id);
  });
  return { jeitos, perguntas, respostas, cartao, sem_cartao_no_perfil: !(perfil?.cartoes?.length) };
}

/** Níveis de cada programa que aparece nas regras de viagem (para o seletor "Sua categoria"). */
export function niveisPorPrograma(dados) {
  const programas = porId(lista(dados, 'programas'));
  const mapa = new Map();
  for (const r of lista(dados, 'viagens')) {
    if (r.niveis.length < 2) continue;
    if (!mapa.has(r.programa_id)) mapa.set(r.programa_id, { programa_id: r.programa_id, nome: programas.get(r.programa_id)?.nome ?? r.programa_id, niveis: [] });
    const item = mapa.get(r.programa_id);
    for (const n of r.niveis) if (!item.niveis.some((x) => x.id === n.id)) item.niveis.push({ id: n.id, nome: n.nome });
  }
  return [...mapa.values()];
}
