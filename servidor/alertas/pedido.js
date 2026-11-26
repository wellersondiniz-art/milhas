// Camada HTTP dos alertas (Cloudflare Pages Functions em functions/api/alertas/).
//
//   POST /api/alertas/inscrever   JSON do formulário do site → sempre a mesma resposta
//   GET  /api/alertas/confirmar   página com o botão "Confirmar" (o GET não muda nada,
//                                 para o leitor de links do provedor de e-mail não confirmar sozinho)
//   POST /api/alertas/confirmar   aplica o pedido
//   GET  /api/alertas/cancelar    página com o botão "Cancelar alertas"
//   POST /api/alertas/cancelar    cancela; também atende o "cancelar em um clique"
//                                 do provedor de e-mail (List-Unsubscribe-Post)
//
// Toda validação acontece aqui, no servidor. Nada de e-mail no log.

import { LIMITES, validarInscricao } from './regras.js';
import { cancelar, confirmar, inscrever } from './fluxo.js';
import { escaparHtml, NOME_DO_SITE } from './emails.js';
import { TOKEN, UUID } from './tokens.js';

export const MENSAGENS = Object.freeze({
  recebido: 'Pronto! Se o e-mail estiver certo, chega nele um link para confirmar o alerta. Sem a confirmação, não mandamos nada.',
  foraDoAr: 'Os alertas por e-mail ainda não estão funcionando. Tente mais tarde.',
  origem: 'Envie pelo formulário do próprio site.',
  formato: 'O formulário chegou num formato que não entendemos. Recarregue a página e tente de novo.',
  grande: 'O pedido ficou grande demais.',
  invalido: 'Falta arrumar alguns campos.',
  muitosDoMesmoLugar: 'Chegaram muitos pedidos da sua conexão hoje. Tente de novo amanhã.',
  muitosNoDia: 'Os alertas receberam muitos pedidos hoje. Tente de novo amanhã.',
});

const CABECALHOS_JSON = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
});

export function responderJson(status, corpo, extras = {}) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CABECALHOS_JSON, ...extras } });
}

// ---------------------------------------------------------------------------
// Páginas de confirmar e cancelar (HTML sem script, estilo com hash na CSP)

const ESTILO = 'body{margin:0;background:#fbf7ee;color:#1d2a20;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
  + 'main{max-width:34rem;margin:0 auto;padding:2rem 1rem}h1{font-size:1.5rem;line-height:1.2}'
  + 'button{font:inherit;min-height:44px;padding:.6rem 1.2rem;border:0;border-radius:.6rem;background:#1f6b3a;color:#fff;cursor:pointer}'
  + 'button:focus-visible,a:focus-visible{outline:3px solid #b35c00;outline-offset:2px}a{color:#1f6b3a}'
  + '@media (prefers-color-scheme:dark){body{background:#14201a;color:#eef3ea}a{color:#8fd4a5}button{background:#2f8a50}}';

let hashDoEstilo = null;
async function cspDaPagina() {
  if (!hashDoEstilo) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ESTILO)));
    hashDoEstilo = btoa(String.fromCharCode(...bytes));
  }
  return `default-src 'none'; style-src 'sha256-${hashDoEstilo}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
}

/** Página HTML. `partes` já vem escapada (montada só com escaparHtml). */
export async function responderPagina(status, titulo, partes) {
  const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex">'
    + `<title>${escaparHtml(titulo)} | ${NOME_DO_SITE}</title><style>${ESTILO}</style></head>`
    + `<body><main><h1>${escaparHtml(titulo)}</h1>${partes.join('')}`
    + `<p><a href="/">Voltar para o ${NOME_DO_SITE}</a></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': await cspDaPagina(),
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
    },
  });
}
const par = (texto) => `<p>${escaparHtml(texto)}</p>`;
function formulario(acao, campos, botao) {
  const ocultos = Object.entries(campos)
    .map(([nome, valor]) => `<input type="hidden" name="${escaparHtml(nome)}" value="${escaparHtml(valor)}">`).join('');
  return `<form method="post" action="${escaparHtml(acao)}">${ocultos}<button type="submit">${escaparHtml(botao)}</button></form>`;
}

// ---------------------------------------------------------------------------
// Peças comuns

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

/** Campos de formulário (application/x-www-form-urlencoded), com limite. */
async function lerFormulario(request) {
  if (!/^application\/x-www-form-urlencoded(;|$)/i.test(request.headers.get('Content-Type') ?? '')) return new URLSearchParams();
  const texto = await lerComLimite(request, 2048);
  return new URLSearchParams(texto ?? '');
}

/** Configuração completa? Sem ela, nada é gravado nem enviado. */
export function configurado(deps) {
  const segredoBom = (s) => typeof s === 'string' && s.length >= 32;
  return Boolean(deps.repo && deps.correio && segredoBom(deps.segredo) && segredoBom(deps.segredoIp) && deps.urlSite);
}

/**
 * Resumo do IP para o contador: HMAC-SHA-256 com IP_SEGREDO (um segredo só
 * para isso, separado do que assina os links). O IP não é guardado.
 */
export async function resumoDoIp(ip, segredoIp) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredoIp), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`alertas-ip:${ip}`)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Conta o pedido por IP e no total do dia (no banco, de forma atômica).
 * @returns {Promise<null|'ip'|'total'>} o limite estourado, ou null.
 */
async function estourouLimite(request, deps, agora) {
  const dia = agora.toISOString().slice(0, 10);
  // Na Cloudflare, CF-Connecting-IP vem da própria rede (não dá para forjar).
  const ip = request.headers.get('CF-Connecting-IP') ?? 'sem-ip';
  const porIp = await deps.repo.contar(`ip:${await resumoDoIp(ip, deps.segredoIp)}:${dia}`, dia);
  if (porIp > LIMITES.pedidosPorIpPorDia) return 'ip';
  const total = await deps.repo.contar(`total:${dia}`, dia);
  if (total > LIMITES.pedidosPorDiaNoTotal) return 'total';
  return null;
}

// ---------------------------------------------------------------------------
// Inscrição

/**
 * @param {Request} request
 * @param {object} deps  { repo, correio, segredo, urlSite, buscarDados, agora }
 */
export async function tratarInscricao(request, deps) {
  if (request.method !== 'POST') return responderJson(405, { ok: false, mensagem: MENSAGENS.formato }, { Allow: 'POST' });
  if (!configurado(deps)) return responderJson(503, { ok: false, mensagem: MENSAGENS.foraDoAr });
  if (!mesmaOrigem(request)) return responderJson(403, { ok: false, mensagem: MENSAGENS.origem });
  if (!/^application\/json(;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    return responderJson(415, { ok: false, mensagem: MENSAGENS.formato });
  }
  const texto = await lerComLimite(request, LIMITES.corpoBytes);
  if (texto === null) return responderJson(413, { ok: false, mensagem: MENSAGENS.grande });
  let entrada;
  try { entrada = JSON.parse(texto); } catch { return responderJson(400, { ok: false, mensagem: MENSAGENS.formato }); }
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return responderJson(400, { ok: false, mensagem: MENSAGENS.formato });

  // Armadilhas contra robô: campo escondido preenchido ou envio rápido demais.
  // Quem cai recebe a mesma resposta de sucesso, e nada acontece.
  const tempo = Number(entrada.tempo_no_formulario_ms);
  if ((typeof entrada.site === 'string' && entrada.site !== '') || !Number.isFinite(tempo) || tempo < LIMITES.tempoMinimoMs) {
    return responderJson(202, { ok: true, mensagem: MENSAGENS.recebido });
  }

  let dados;
  try { dados = await deps.buscarDados(); } catch { return responderJson(503, { ok: false, mensagem: MENSAGENS.foraDoAr }); }
  const validacao = validarInscricao(entrada, dados);
  if (!validacao.ok) return responderJson(422, { ok: false, mensagem: MENSAGENS.invalido, erros: validacao.erros });

  // Limites por IP e no total do dia, contados antes de qualquer e-mail sair.
  // Sem eles, um script que troca o e-mail a cada pedido faria o site mandar
  // e-mail para desconhecidos e gastaria a cota do Resend.
  const agora = deps.agora();
  let estouro;
  try {
    estouro = await estourouLimite(request, deps, agora);
  } catch (erro) {
    console.error(`alertas: contador falhou (${erro?.status ?? 'sem status'})`);
    return responderJson(503, { ok: false, mensagem: MENSAGENS.foraDoAr });
  }
  if (estouro) {
    if (estouro === 'total') console.error('alertas: teto diário de pedidos atingido');
    await deps.repo.registrarEnvio({ tipo: 'confirmacao', resultado: 'limite', quantidade_alertas: 0 }).catch(() => {});
    return responderJson(429, { ok: false, mensagem: estouro === 'ip' ? MENSAGENS.muitosDoMesmoLugar : MENSAGENS.muitosNoDia }, { 'Retry-After': '3600' });
  }

  try {
    const { resultado } = await inscrever(validacao.pedido, { ...deps, dados, agora });
    if (resultado === 'erro_envio') console.error('alertas: o serviço de e-mail recusou a confirmação');
  } catch (erro) {
    console.error(`alertas: inscrição falhou (${erro?.status ?? 'sem status'})`);
    return responderJson(503, { ok: false, mensagem: MENSAGENS.foraDoAr });
  }
  // Mesma resposta para e-mail novo, já inscrito, já confirmado ou no limite.
  return responderJson(202, { ok: true, mensagem: MENSAGENS.recebido });
}

// ---------------------------------------------------------------------------
// Confirmar

const LINK_RUIM = ['Link vencido ou já usado', [
  par(`O link de confirmação vale uma vez só, por ${LIMITES.horasParaConfirmar} horas. Se precisar, peça o alerta de novo no site.`),
]];

export async function tratarConfirmar(request, deps) {
  const url = new URL(request.url);
  if (!configurado(deps)) return responderPagina(503, 'Fora do ar', [par(MENSAGENS.foraDoAr)]);
  if (request.method === 'GET' || request.method === 'HEAD') {
    const token = url.searchParams.get('t') ?? '';
    if (!TOKEN.test(token)) return responderPagina(400, ...LINK_RUIM);
    return responderPagina(200, 'Confirmar o alerta', [
      par('Falta um toque: confirme que quer receber o alerta neste e-mail.'),
      formulario('/api/alertas/confirmar', { t: token }, 'Confirmar o alerta'),
    ]);
  }
  if (request.method !== 'POST') return responderPagina(405, 'Use o link do e-mail', [par('Abra o link que chegou no seu e-mail.')]);
  const campos = await lerFormulario(request);
  let resultado;
  try {
    resultado = await confirmar(campos.get('t') ?? '', { repo: deps.repo, agora: deps.agora() });
  } catch (erro) {
    console.error(`alertas: confirmação falhou (${erro?.status ?? 'sem status'})`);
    return responderPagina(503, 'Fora do ar', [par('Não conseguimos confirmar agora. Tente de novo em alguns minutos.')]);
  }
  if (resultado.resultado === 'limite_de_alertas') {
    return responderPagina(409, 'Limite de alertas', [
      par(`Cada e-mail pode ter até ${LIMITES.alertasPorEmail} alertas. Cancele os alertas pelo link de um e-mail nosso e crie de novo os que quiser.`),
    ]);
  }
  if (resultado.resultado !== 'confirmado') return responderPagina(400, ...LINK_RUIM);
  return responderPagina(200, 'Alerta confirmado', [
    par('Pronto! Depois de cada atualização semanal das ofertas, a gente confere o seu alerta e manda um e-mail se a loja chegar no seu alvo.'),
    par('Mandamos no máximo 2 e-mails de alerta por semana. Todo e-mail tem o link para cancelar.'),
  ]);
}

// ---------------------------------------------------------------------------
// Cancelar

export async function tratarCancelar(request, deps) {
  const url = new URL(request.url);
  if (!configurado(deps)) return responderPagina(503, 'Fora do ar', [par(MENSAGENS.foraDoAr)]);
  const i = url.searchParams.get('i') ?? '';
  const a = url.searchParams.get('a') ?? '';
  if (request.method === 'GET' || request.method === 'HEAD') {
    if (!UUID.test(i) || !TOKEN.test(a)) return responderPagina(400, 'Link incompleto', [par('Abra o link de cancelar que chegou no seu e-mail.')]);
    return responderPagina(200, 'Cancelar os alertas', [
      par('Ao cancelar, apagamos o seu e-mail e todos os alertas dele. Você não recebe mais nada.'),
      formulario(`/api/alertas/cancelar?i=${encodeURIComponent(i)}&a=${encodeURIComponent(a)}`, {}, 'Cancelar e apagar meu e-mail'),
    ]);
  }
  if (request.method !== 'POST') return responderPagina(405, 'Use o link do e-mail', [par('Abra o link de cancelar que chegou no seu e-mail.')]);
  // POST do botão acima ou do "cancelar em um clique" do provedor: o id e a
  // assinatura vêm na URL; o corpo (List-Unsubscribe=One-Click) é ignorado.
  let resultado;
  try {
    resultado = await cancelar(i, a, { repo: deps.repo, segredo: deps.segredo });
  } catch (erro) {
    console.error(`alertas: cancelamento falhou (${erro?.status ?? 'sem status'})`);
    return responderPagina(503, 'Fora do ar', [par('Não conseguimos cancelar agora. Tente de novo em alguns minutos.')]);
  }
  if (resultado.resultado !== 'cancelado') return responderPagina(400, 'Link incompleto', [par('Abra o link de cancelar que chegou no seu e-mail.')]);
  return responderPagina(200, 'Alertas cancelados', [par('Pronto. Apagamos o seu e-mail e os alertas dele. Você não recebe mais nada.')]);
}
