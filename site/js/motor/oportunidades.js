// "O que mais rende": as ofertas que valem hoje, ordenadas pelos pontos por
// real, com o que cada uma cobre (todos os produtos, só os da loja, algumas
// categorias) e os produtos que a campanha cita pelo nome.
//
// Não há preço de produto aqui, de propósito: numa mesma oferta todo produto
// que entra rende a mesma taxa. O que muda de uma linha para outra é a loja,
// o programa e a categoria coberta.
//
// Funções puras, como o resto do motor (sem DOM, sem rede, sem relógio).
// Dinheiro e pontos em BigInt com as escalas de formatar.js:
//   pontos × 1.000.000 e valor em bilionésimos de centavo.

import { A_CONFIRMAR, avaliarClube, escolherRegra, ofertaValeHoje, pprEscalado } from './calcular.js';
import { diasEntre, lerDataHora, soData } from './datas.js';
import { formatarPontos, formatarValor, pontosParaNumero } from './formatar.js';

/** Base do "a cada R$ 100": 10.000 centavos. */
const CEM_REAIS = 10_000n;

const TEXTO_ESCOPO = {
  vendido_e_entregue_pela_loja: 'Produtos vendidos e entregues pela própria loja',
  todos_os_produtos: 'Todos os produtos',
};

function erro(msg) {
  return new Error(`ranking de oportunidades: ${msg}`);
}

function semCondicao(regra) {
  return regra.condicao?.clube_ativo !== true && !regra.condicao?.cartao_id;
}

function numeroDeCondicoes(regra) {
  return (regra.condicao?.clube_ativo === true ? 1 : 0) + (regra.condicao?.cartao_id ? 1 : 0);
}

/** A faixa de mais pontos; empate → a que pede menos; empate → a primeira. */
function faixaMaxima(regras) {
  let melhor = null;
  for (const r of regras) {
    if (!melhor || r.pontos_por_real > melhor.pontos_por_real ||
      (r.pontos_por_real === melhor.pontos_por_real && numeroDeCondicoes(r) < numeroDeCondicoes(melhor))) {
      melhor = r;
    }
  }
  return melhor;
}

/** Pontos por real sem clube e sem cartão específico (0 se a oferta não tem essa faixa). */
function semExigencia(regras) {
  return regras.filter(semCondicao).reduce((max, r) => Math.max(max, r.pontos_por_real), 0);
}

/** Melhor faixa para o perfil: clube que ele cumpre e o melhor dos cartões dele (ou nenhum). */
function paraOPerfil(oferta, perfil, hoje) {
  const doPerfil = perfil.programas.find((p) => p?.programa_id === oferta.programa_id);
  const clube = avaliarClube(oferta, doPerfil, hoje);
  let melhor = 0;
  for (const cartaoId of [null, ...perfil.cartoes]) {
    const regra = escolherRegra(oferta.regras, clube.cumpre, cartaoId);
    if (regra && regra.pontos_por_real > melhor) melhor = regra.pontos_por_real;
  }
  return melhor;
}

function textoAlvo(oferta) {
  let texto = oferta.escopo === 'categorias_selecionadas'
    ? `Só estas categorias: ${(oferta.categorias_incluidas ?? []).join(', ')}`
    : TEXTO_ESCOPO[oferta.escopo] ?? 'Produtos cobertos não confirmados';
  if (oferta.categorias_excluidas?.length) texto += `. Fora: ${oferta.categorias_excluidas.join(', ')}`;
  return `${texto}.`;
}

function milheiroDe(programa, perfil) {
  const doPerfil = perfil?.valor_milheiro_brl ?? {};
  if (Object.hasOwn(doPerfil, programa.id) && Number.isSafeInteger(doPerfil[programa.id])) return doPerfil[programa.id];
  return Number.isSafeInteger(programa.valor_milheiro_brl) ? programa.valor_milheiro_brl : null;
}

function aCadaCemReais(ppr, milheiro) {
  const esc = pprEscalado(ppr) * CEM_REAIS;
  const valor = milheiro === null ? null : esc * BigInt(milheiro);
  return {
    pontos: pontosParaNumero(esc),
    pontos_texto: formatarPontos(esc),
    valor_estimado_em_reais: valor === null ? null : { bilionesimos_de_centavo: valor, texto: formatarValor(valor) },
  };
}

function validar(dados, hoje, opcoes) {
  lerDataHora(hoje);
  for (const nome of ['programas', 'lojas', 'ofertas']) {
    if (!dados || !Array.isArray(dados[nome])) throw erro(`dados.${nome} precisa ser uma lista`);
  }
  const { perfil } = opcoes;
  if (perfil !== undefined && perfil !== null && (!Array.isArray(perfil.programas) || !Array.isArray(perfil.cartoes))) {
    throw erro('perfil precisa de "programas" e "cartoes" (listas)');
  }
}

function comparar(a, b) {
  return b.pontos_por_real_referencia - a.pontos_por_real_referencia ||
    b.maximo.pontos_por_real - a.maximo.pontos_por_real ||
    a.loja.nome.localeCompare(b.loja.nome, 'pt-BR') ||
    a.programa.nome.localeCompare(b.programa.nome, 'pt-BR') ||
    (a.oferta_id < b.oferta_id ? -1 : a.oferta_id > b.oferta_id ? 1 : 0);
}

/**
 * Ofertas que valem hoje, da que mais rende para a que menos rende.
 *
 * Sem perfil, a ordem é pelos pontos por real que qualquer pessoa ganha (sem
 * clube e sem cartão específico); empate → o máximo da oferta. Com perfil, a
 * ordem é pelos pontos por real que a pessoa ganha com o clube e os cartões dela.
 * Só pontos do programa da oferta: os do cartão valem em qualquer loja.
 *
 * @param {object} dados   { programas, lojas, ofertas }
 * @param {string} hoje    "AAAA-MM-DD" (ou "AAAA-MM-DDTHH:MM")
 * @param {object} opcoes  { loja_id?: string, perfil?: { programas, cartoes, valor_milheiro_brl? } }
 */
export function rankearOportunidades(dados, hoje, opcoes = {}) {
  validar(dados, hoje, opcoes);
  const { loja_id: lojaId = null, perfil = null } = opcoes;
  const dataHoje = soData(hoje);
  const lojas = new Map(dados.lojas.map((l) => [l.id, l]));
  const programas = new Map(dados.programas.map((p) => [p.id, p]));

  const lista = [];
  for (const oferta of dados.ofertas) {
    if (lojaId !== null && oferta.loja_id !== lojaId) continue;
    if (oferta.status === A_CONFIRMAR || !ofertaValeHoje(oferta, dataHoje)) continue;
    const loja = lojas.get(oferta.loja_id);
    const programa = programas.get(oferta.programa_id);
    if (!loja || !programa || !oferta.regras?.length) continue;

    const maxima = faixaMaxima(oferta.regras);
    const qualquerPessoa = semExigencia(oferta.regras);
    const paraVoce = perfil ? paraOPerfil(oferta, perfil, hoje) : null;
    const referencia = paraVoce ?? qualquerPessoa;
    const fora = oferta.pontos_fora_do_escopo_por_real;

    lista.push({
      oferta_id: oferta.id,
      loja: { id: loja.id, nome: loja.nome },
      programa: { id: programa.id, nome: programa.nome },
      pontos_por_real_referencia: referencia,
      pontos_por_real_sem_exigencia: qualquerPessoa,
      pontos_por_real_para_voce: paraVoce,
      maximo: {
        pontos_por_real: maxima.pontos_por_real,
        pede_clube: maxima.condicao?.clube_ativo === true,
        pede_cartao_id: maxima.condicao?.cartao_id ?? null,
      },
      a_cada_100_reais: aCadaCemReais(referencia, milheiroDe(programa, perfil)),
      alvo: {
        escopo: oferta.escopo,
        categorias_incluidas: oferta.categorias_incluidas ?? [],
        categorias_excluidas: oferta.categorias_excluidas ?? [],
        texto: textoAlvo(oferta),
      },
      pontos_fora_do_escopo_por_real: typeof fora === 'number' ? fora : null,
      produtos_em_campanha: (oferta.produtos_em_campanha ?? []).map(({ nome, link }) => ({ nome, link })),
      fim: oferta.fim,
      vence_em_dias: oferta.fim === A_CONFIRMAR ? null : diasEntre(dataHoje, oferta.fim),
      link_oferta: oferta.link_oferta === A_CONFIRMAR ? null : oferta.link_oferta,
      fonte_url: oferta.fonte_url,
      verificado_em: oferta.verificado_em,
    });
  }
  return lista.sort(comparar);
}
