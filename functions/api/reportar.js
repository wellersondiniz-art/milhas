// Cloudflare Pages Function: POST /api/reportar
// (botão "Essa informação está errada?" de cada resultado).
//
// Roda no mesmo endereço do site, então a CSP continua com connect-src 'self'.
// A lógica fica em servidor/reportar/ (testada com node --test); aqui só se
// liga o pedido às peças da Cloudflare. Configuração no README, seção
// "Avisos de erro (reportes)":
//   - GITHUB_TOKEN    segredo: fine-grained token, Issues: Read and write,
//                     só no repositório privado de reportes;
//   - REPORTES_REPO   variável: "dono/nome" do repositório privado;
//   - REPORTES_LIMITE vínculo (binding) com um namespace do Workers KV.
// Sem qualquer um deles, responde 503 e não grava nada.

import { clienteGithub } from '../../servidor/reportar/github.js';
import { responder, tratarReporte } from '../../servidor/reportar/pedido.js';

const ARQUIVOS = ['lojas', 'ofertas', 'programas', 'cartoes'];

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
  return tratarReporte(request, {
    kv: env.REPORTES_LIMITE ?? null,
    chaveDoResumo: env.GITHUB_TOKEN ?? '',
    github: clienteGithub({ token: env.GITHUB_TOKEN, repo: env.REPORTES_REPO }),
    buscarDados: leitorDeDados(env, request),
    agora: () => new Date(),
  });
}

export function onRequest() {
  return responder(405, { ok: false, mensagem: 'Use o formulário do site.' }, { Allow: 'POST' });
}
