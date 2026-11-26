// Recebe o POST /api/explicar e devolve a explicação em texto simples.
//
// Ordem das travas (a mais barata primeiro):
//   1. configuração completa (chave da API e KV), senão 503;
//   2. o pedido vem do próprio site (Origin), senão 403;
//   3. JSON de até 8 KB, senão 415/413/400;
//   4. ids, valor e pergunta válidos (entrada.js); pergunta com dado pessoal
//      é recusada e nem sai daqui (422);
//   5. limite por pessoa, por dia e teto de gasto do mês (limite.js), 429;
//   6. o servidor REFAZ a conta com o motor e os dados publicados; se o
//      melhor jeito não for o mesmo que a pessoa vê, pede para refazer (409);
//   7. chama o modelo (modelo.js), com reserva;
//   8. confere a resposta (saida.js). Se não passar, devolve um recado fixo.
//
// A pergunta e a resposta nunca vão para o log nem ficam guardadas aqui.

import { calcularJeitosDeComprar } from '../../site/js/motor/index.js';
import { ehVazio, limparPerfil, perfilDeTodos, perfilParaConta } from '../../site/js/perfil/formato.js';
import { LIMITES } from './config.js';
import { lerPedido } from './entrada.js';
import { montarFatos } from './fatos.js';
import { cabeNoTeto, podeExplicar, registrar, resumoDoIp } from './limite.js';
import { chamarComReserva } from './modelo.js';
import { estimarTokensDeEntrada, montarPedido } from './prompt.js';
import { conferirResposta, emBlocos, RECUSA_FIXA } from './saida.js';

export const MENSAGENS = Object.freeze({
  foraDoAr: 'O "explica pra mim" está fora do ar agora. O resultado acima continua valendo.',
  origem: 'Use o botão do próprio site.',
  formato: 'O pedido chegou num formato que não entendemos. Recarregue a página e tente de novo.',
  grande: 'A pergunta ficou grande demais. Encurte e tente de novo.',
  dadoPessoal: 'Tire da pergunta números de cartão, CPF, telefone ou e-mail. A gente não precisa deles para explicar.',
  limitePessoa: 'Você já usou todas as explicações de hoje. Amanhã tem mais. O resultado acima continua valendo.',
  limiteDia: 'Muita gente pediu explicação hoje e chegamos ao limite. Tente amanhã.',
  teto: 'O "explica pra mim" chegou ao limite deste mês. O resultado acima continua valendo.',
  mudou: 'Os dados mudaram desde a sua conta. Faça a conta de novo e peça a explicação outra vez.',
  falhou: 'Não consegui explicar agora. Tente de novo em alguns minutos. Enquanto isso, veja "Como calcular" em cada resultado.',
  naoConfere: 'Não consegui explicar este resultado com segurança. Veja "Como calcular" e "O que fazer antes de comprar" em cada resultado.',
});

const CABECALHOS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
});

export function responder(status, corpo, extras = {}) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CABECALHOS, ...extras } });
}

async function lerComLimite(request, limite) {
  const declarado = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declarado) && declarado > limite) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limite) return null;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function mesmaOrigem(request) {
  const origem = request.headers.get('Origin');
  if (!origem || origem !== new URL(request.url).origin) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  return !site || site === 'same-origin';
}

/** "AAAA-MM-DDTHH:MM" no horário de São Paulo (o motor usa data e hora locais). */
export function agoraEmSaoPaulo(data) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(data).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}

const erro = (status, chave, extras) => responder(status, { ok: false, mensagem: MENSAGENS[chave] }, extras);

/**
 * @param {Request} request
 * @param {object} deps
 * @param {string} deps.chave          ANTHROPIC_API_KEY (segredo da Cloudflare)
 * @param {object|null} deps.kv        KV com get/put
 * @param {() => Promise<object>} deps.buscarDados  { lojas, ofertas, programas, cartoes, cambio }
 * @param {() => Date} deps.agora
 * @param {number} deps.tetoNano       teto do mês em nanodólares
 * @param {number} deps.porDiaTotal
 * @param {typeof fetch} [deps.buscar]  para a API do modelo (trocado nos testes)
 * @param {(ms: number) => Promise<void>} [deps.esperar]
 * @param {(registro: object) => void} [deps.log]
 */
export async function tratarExplicacao(request, deps) {
  if (request.method !== 'POST') return erro(405, 'formato', { Allow: 'POST' });
  if (!deps.chave || !deps.kv) return erro(503, 'foraDoAr');
  if (!mesmaOrigem(request)) return erro(403, 'origem');
  if (!/^application\/json(;|$)/i.test(request.headers.get('Content-Type') ?? '')) return erro(415, 'formato');
  const corpo = await lerComLimite(request, LIMITES.corpoBytes);
  if (corpo === null) return erro(413, 'grande');
  let json;
  try { json = JSON.parse(corpo); } catch { return erro(400, 'formato'); }

  let dados;
  try { dados = await deps.buscarDados(); } catch { return erro(503, 'foraDoAr'); }

  const lido = lerPedido(json, dados);
  if (!lido.ok) return erro(lido.erro === 'dadoPessoal' ? 422 : lido.erro === 'grande' ? 413 : 400, lido.erro);
  const { pedido } = lido;

  const agora = deps.agora();
  const hojeHora = agoraEmSaoPaulo(agora);
  const hoje = hojeHora.slice(0, 10);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'sem-ip';
  const resumo = await resumoDoIp(ip, deps.chave);
  const limite = await podeExplicar(deps.kv, {
    resumo, hoje, porPessoa: LIMITES.porPessoaPorDia, porDia: deps.porDiaTotal, tetoNano: deps.tetoNano,
  });
  if (!limite.ok) {
    const chave = { pessoa: 'limitePessoa', dia: 'limiteDia', teto: 'teto' }[limite.motivo];
    return erro(429, chave, { 'Retry-After': '3600' });
  }

  // 6. Refaz a conta: o modelo só recebe o que o NOSSO motor calculou.
  const perfilLimpo = pedido.perfil ? limparPerfil(pedido.perfil, dados) : null;
  const semPerfil = ehVazio(perfilLimpo);
  const perfil = semPerfil ? perfilDeTodos(dados, perfilLimpo?.cotacao_dolar) : perfilParaConta(perfilLimpo);
  let jeitos;
  try {
    jeitos = calcularJeitosDeComprar(
      perfil, { loja_id: pedido.loja.id, valor_centavos: pedido.valor_centavos, tipo_vendedor: 'loja' }, dados, hojeHora,
    );
  } catch {
    return erro(400, 'formato');
  }
  const [melhor] = jeitos;
  if (!melhor || melhor.total_pontos_texto !== pedido.conferir.total_pontos_texto
    || melhor.oferta_id !== pedido.conferir.oferta_id) {
    return erro(409, 'mudou');
  }

  const fatos = montarFatos(jeitos, { loja: pedido.loja, valor_centavos: pedido.valor_centavos, semPerfil, hoje: hojeHora }, dados);
  const log = deps.log ?? (() => {});
  const chamada = await chamarComReserva({
    pedidoPara: (modelo) => montarPedido(modelo, fatos.texto, pedido.pergunta),
    tokensDeEntrada: estimarTokensDeEntrada,
    chave: deps.chave,
    cabe: (custo) => cabeNoTeto(limite.lido, 0, custo),
    buscar: deps.buscar,
    esperar: deps.esperar,
    log,
  });
  await registrar(deps.kv, limite.lido, chamada.gasto);

  if (!chamada.ok) {
    if (chamada.motivo === 'recusa') return responder(200, { ok: true, blocos: emBlocos(RECUSA_FIXA), fixa: true });
    if (chamada.motivo === 'teto') return erro(429, 'teto', { 'Retry-After': '86400' });
    return erro(503, 'falhou');
  }
  const conferida = conferirResposta(chamada.texto, fatos);
  if (!conferida.ok) {
    log({ evento: 'resposta_barrada', motivo: conferida.motivo, modelo: chamada.modelo });
    return responder(200, { ok: true, blocos: emBlocos(MENSAGENS.naoConfere), fixa: true });
  }
  return responder(200, { ok: true, blocos: emBlocos(conferida.texto), fixa: false });
}
