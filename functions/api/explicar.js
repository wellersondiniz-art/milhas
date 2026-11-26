// Cloudflare Pages Function: POST /api/explicar (botão "Explica pra mim").
//
// A chave da API da Anthropic fica SÓ aqui, como segredo da Cloudflare: o
// navegador nunca fala com a Anthropic. Roda no mesmo endereço do site, então
// a CSP continua com connect-src 'self'. A lógica fica em servidor/explicar/
// (testada com node --test). Configuração no README, seção "Explica pra mim":
//   - ANTHROPIC_API_KEY        segredo;
//   - EXPLICAR_LIMITE          vínculo (binding) com um namespace do Workers KV;
//   - EXPLICAR_TETO_MENSAL_USD variável opcional (padrão: 5);
//   - EXPLICAR_POR_DIA_TOTAL   variável opcional (padrão: 200).
// Sem a chave ou sem o KV, responde 503 e não chama nada.

import { LIMITES, inteiroDoAmbiente, tetoEmNano } from '../../servidor/explicar/config.js';
import { responder, tratarExplicacao } from '../../servidor/explicar/pedido.js';

const ARQUIVOS = ['lojas', 'ofertas', 'programas', 'cartoes', 'cambio'];

/** Lê os dados publicados do próprio site (dist/dados/*.json). */
export function leitorDeDados(env, request) {
  return async () => {
    const listas = await Promise.all(ARQUIVOS.map(async (nome) => {
      const resposta = await env.ASSETS.fetch(new URL(`/dados/${nome}.json`, request.url));
      if (!resposta.ok) throw new Error(`dados/${nome}.json: ${resposta.status}`);
      const lista = await resposta.json();
      if (!Array.isArray(lista)) throw new Error(`dados/${nome}.json não é lista`);
      return lista;
    }));
    return Object.fromEntries(ARQUIVOS.map((nome, i) => [nome, listas[i]]));
  };
}

export function onRequestPost({ request, env }) {
  return tratarExplicacao(request, {
    chave: env.ANTHROPIC_API_KEY ?? '',
    kv: env.EXPLICAR_LIMITE ?? null,
    buscarDados: leitorDeDados(env, request),
    agora: () => new Date(),
    tetoNano: tetoEmNano(env.EXPLICAR_TETO_MENSAL_USD),
    porDiaTotal: inteiroDoAmbiente(env.EXPLICAR_POR_DIA_TOTAL, LIMITES.porDiaTotal),
    // Só o evento, o modelo e o status: nunca a pergunta, a resposta ou a chave.
    log: (registro) => console.log(JSON.stringify({ explicar: registro })),
  });
}

export function onRequest() {
  return responder(405, { ok: false, mensagem: 'Use o botão do site.' }, { Allow: 'POST' });
}
