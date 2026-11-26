// Cloudflare Pages: roda antes de toda função em functions/api/*.
// Captura erro não tratado, responde sem detalhe técnico e registra o erro
// sem dado pessoal (servidor/operacao/). site/_routes.json limita as funções
// a /api/*, então as páginas e os dados do site não passam por aqui.
//
// Configuração opcional (Cloudflare Pages → Settings → Variables and Secrets,
// ambiente Production), a mesma dos alertas:
//   SUPABASE_URL         variável
//   SUPABASE_SECRET_KEY  segredo
// Sem elas, o erro vai só para o log da Cloudflare (Real-time logs).
import { protegerFuncao } from '../servidor/operacao/middleware.js';

export function onRequest(contexto) {
  return protegerFuncao(contexto);
}
