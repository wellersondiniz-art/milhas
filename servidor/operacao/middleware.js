// Rede de proteção de todas as funções do servidor (functions/api/*).
//
// Roda antes de cada função (functions/_middleware.js). Se a função lançar um
// erro que ninguém tratou, devolve uma resposta genérica (sem detalhe técnico
// para quem está do outro lado) e registra o erro limpo de dado pessoal. Se a
// função responder 5xx por conta própria, registra só a rota e o status.
//
// O 503 "desligado até configurar" das funções novas não é erro: não é gravado
// no banco, para não encher a tabela antes de cada serviço ser ligado.

import { gravadorSupabase, registrarErro } from './registro.js';

const CABECALHOS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/** Nome do módulo a partir do caminho: /api/alertas/inscrever → "alertas". */
export function origemDaRota(url) {
  try {
    const partes = new URL(String(url)).pathname.split('/').filter(Boolean);
    const nome = partes[0] === 'api' ? partes[1] : partes[0];
    return /^[a-z][a-z0-9-]{0,30}$/.test(nome ?? '') ? nome : 'site';
  } catch {
    return 'site';
  }
}

export function respostaDeErro() {
  return new Response(JSON.stringify({ ok: false, mensagem: 'Algo deu errado do nosso lado. Tente de novo em alguns minutos.' }), {
    status: 500,
    headers: CABECALHOS,
  });
}

/**
 * @param {{ request: Request, env: object, next: () => Promise<Response>, waitUntil?: (p: Promise<unknown>) => void }} contexto
 * @param {{ log?: (linha: string) => void, fetch?: typeof fetch }} [opcoes]
 */
export async function protegerFuncao(contexto, opcoes = {}) {
  const { request, env = {}, next } = contexto;
  const esperar = typeof contexto.waitUntil === 'function' ? (p) => contexto.waitUntil(p) : () => {};
  const gravar = gravadorSupabase({ url: env.SUPABASE_URL, chave: env.SUPABASE_SECRET_KEY, fetch: opcoes.fetch });
  const origem = origemDaRota(request.url);
  try {
    const resposta = await next();
    if (resposta.status >= 500 && resposta.status !== 503) {
      esperar(registrarErro({ origem, url: request.url, status: resposta.status }, { log: opcoes.log, gravar }));
    }
    return resposta;
  } catch (erro) {
    esperar(registrarErro({ origem, url: request.url, status: 500, erro }, { log: opcoes.log, gravar }));
    return respostaDeErro();
  }
}
