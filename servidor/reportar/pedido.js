// Recebe o POST do formulário "Essa informação está errada?" e, se tudo
// estiver certo, abre uma issue no repositório privado de reportes.
//
// Toda a validação acontece aqui, no servidor; a da página é só para ajudar
// quem digita. Ordem das travas (a mais barata primeiro):
//   1. configuração completa (token, repositório e KV), senão 503;
//   2. o pedido vem do próprio site (Origin), senão 403;
//   3. JSON de até 8 KB, senão 415/413/400;
//   4. armadilhas para robô: campo escondido preenchido ou envio rápido
//      demais. Responde "ok" sem fazer nada, para o robô não aprender;
//   5. limite: 5 reportes por hora por pessoa e 50 por dia no total;
//   6. validação contra os dados do site (regras.js), senão 422;
//   7. cria a issue (e, se houver e-mail, o comentário à parte).
//
// O IP só serve para o limite: vira um resumo HMAC que fica no KV por uma
// hora e nunca vai para a issue. O texto da pessoa nunca vai para o log.

import {
  comentarioDoEmail, dataEmSaoPaulo, LIMITES, montarIssue, validarReporte,
} from './regras.js';
import { consumir, podeEnviar, resumoDoIp } from './limite.js';

export const MENSAGENS = Object.freeze({
  enviado: 'Recebemos o seu aviso. Obrigado! A gente confere e corrige.',
  foraDoAr: 'O envio de avisos está fora do ar agora. Tente mais tarde.',
  origem: 'Envie pelo formulário do próprio site.',
  formato: 'O formulário chegou num formato que não entendemos. Recarregue a página e tente de novo.',
  grande: 'O aviso ficou grande demais. Encurte o texto e tente de novo.',
  limitePessoa: 'Você já mandou vários avisos na última hora. Obrigado! Tente de novo mais tarde.',
  limiteDia: 'Recebemos muitos avisos hoje. Tente de novo amanhã.',
  invalido: 'Falta arrumar alguns campos.',
  github: 'Não conseguimos registrar o seu aviso agora. Tente de novo em alguns minutos.',
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

/** Lê o corpo sem passar do limite de bytes. null se passar. */
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

/**
 * @param {Request} request
 * @param {object} deps
 * @param {object|null} deps.kv           KV com get/put (limite)
 * @param {string} deps.chaveDoResumo     chave secreta do HMAC do IP
 * @param {() => Promise<object>} deps.buscarDados   { lojas, ofertas, programas, cartoes }
 * @param {object|null} deps.github       { criarIssue({title,body,labels}), comentar(numero, body) }
 * @param {() => Date} deps.agora
 */
export async function tratarReporte(request, deps) {
  if (request.method !== 'POST') return responder(405, { ok: false, mensagem: MENSAGENS.formato }, { Allow: 'POST' });
  if (!deps.kv || !deps.github || !deps.chaveDoResumo) return responder(503, { ok: false, mensagem: MENSAGENS.foraDoAr });
  if (!mesmaOrigem(request)) return responder(403, { ok: false, mensagem: MENSAGENS.origem });
  if (!/^application\/json(;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    return responder(415, { ok: false, mensagem: MENSAGENS.formato });
  }
  const texto = await lerComLimite(request, LIMITES.corpoBytes);
  if (texto === null) return responder(413, { ok: false, mensagem: MENSAGENS.grande });
  let entrada;
  try { entrada = JSON.parse(texto); } catch { return responder(400, { ok: false, mensagem: MENSAGENS.formato }); }
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return responder(400, { ok: false, mensagem: MENSAGENS.formato });
  }

  // Armadilhas: quem cai recebe "ok" e nada acontece.
  const tempo = Number(entrada.tempo_no_formulario_ms);
  if ((typeof entrada.site === 'string' && entrada.site !== '') || !Number.isFinite(tempo) || tempo < LIMITES.tempoMinimoMs) {
    return responder(200, { ok: true, mensagem: MENSAGENS.enviado });
  }

  const agora = deps.agora();
  const hoje = dataEmSaoPaulo(agora);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'sem-ip';
  const resumo = await resumoDoIp(ip, deps.chaveDoResumo);
  const limite = await podeEnviar(deps.kv, resumo, agora, hoje);
  if (!limite.ok) {
    return responder(429, { ok: false, mensagem: limite.motivo === 'pessoa' ? MENSAGENS.limitePessoa : MENSAGENS.limiteDia }, { 'Retry-After': String(limite.esperarSegundos) });
  }

  let dados;
  try { dados = await deps.buscarDados(); } catch { return responder(503, { ok: false, mensagem: MENSAGENS.foraDoAr }); }

  const validacao = validarReporte(entrada, dados);
  if (!validacao.ok) return responder(422, { ok: false, mensagem: MENSAGENS.invalido, erros: validacao.erros });

  // Conta antes de chamar o GitHub: quem insiste num erro também gasta o limite.
  await consumir(deps.kv, limite);

  const issue = montarIssue(validacao.reporte, hoje);
  let criada;
  try {
    criada = await deps.github.criarIssue(issue);
  } catch (erro) {
    console.error(`reportar: GitHub recusou a issue (${erro?.status ?? 'sem status'})`);
    return responder(502, { ok: false, mensagem: MENSAGENS.github });
  }
  if (validacao.reporte.email) {
    try {
      await deps.github.comentar(criada.number, comentarioDoEmail(validacao.reporte.email));
    } catch (erro) {
      // A issue já existe; sem o comentário, só não dá para responder.
      console.error(`reportar: GitHub recusou o comentário (${erro?.status ?? 'sem status'})`);
    }
  }
  return responder(201, { ok: true, mensagem: MENSAGENS.enviado });
}
