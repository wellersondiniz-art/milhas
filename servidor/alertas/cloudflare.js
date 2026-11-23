// Liga as peças dos alertas ao ambiente da Cloudflare Pages.
// Configuração (README, seção "Alertas por e-mail"), só no ambiente Production:
//   SUPABASE_URL          variável: https://<projeto>.supabase.co
//   SUPABASE_SECRET_KEY   segredo: chave secreta do Supabase (sb_secret_...) só para a Cloudflare
//   RESEND_API_KEY        segredo: chave do Resend com permissão só de envio
//   ALERTAS_REMETENTE     variável: ex. "Milhas da Vez <alertas@milhasdavez.com.br>"
//   ALERTAS_SEGREDO       segredo: 32+ caracteres aleatórios (assina os links de cancelar);
//                         o MESMO valor vai para o GitHub Actions
// Sem qualquer um deles, as rotas respondem 503 e nada é gravado nem enviado.

import { repositorioSupabase } from './supabase.js';
import { clienteResend } from './resend.js';

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

export function dependencias(env, request) {
  return {
    repo: repositorioSupabase({ url: env.SUPABASE_URL, chave: env.SUPABASE_SECRET_KEY }),
    correio: clienteResend({ chave: env.RESEND_API_KEY, remetente: env.ALERTAS_REMETENTE }),
    segredo: env.ALERTAS_SEGREDO ?? '',
    // Os links dos e-mails apontam para o endereço por onde a pessoa entrou.
    urlSite: new URL(request.url).origin,
    buscarDados: leitorDeDados(env, request),
    agora: () => new Date(),
  };
}
