// Tabelas do plano pago (supabase/migrations/20261124000001_plano_pago.sql)
// pela API REST do Supabase. Só o servidor usa, com a chave secreta
// (SUPABASE_SECRET_KEY). Erros nunca levam o corpo da resposta para o log.

import { ErroDoBanco } from '../alertas/supabase.js';

export function repositorioDoPlano({ url, chave, fetch: buscar = globalThis.fetch }) {
  if (!url || !chave || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url.replace(/\/$/, ''))) return null;
  const base = `${url.replace(/\/$/, '')}/rest/v1`;

  async function pedir(operacao, caminho, { method = 'GET', corpo, prefer, aceitarConflito = false } = {}) {
    const resposta = await buscar(`${base}/${caminho}`, {
      method,
      headers: {
        apikey: chave,
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    if (aceitarConflito && resposta.status === 409) return { conflito: true };
    if (!resposta.ok) throw new ErroDoBanco(operacao, resposta.status);
    if (resposta.status === 204) return null;
    const texto = await resposta.text();
    return texto ? JSON.parse(texto) : null;
  }
  const eq = (v) => `eq.${encodeURIComponent(v)}`;

  return {
    async eventoJaProcessado(id) {
      const linhas = await pedir('ler evento', `plano_eventos?select=stripe_evento_id&stripe_evento_id=${eq(id)}`);
      return Array.isArray(linhas) && linhas.length > 0;
    },
    /** @returns {Promise<boolean>} false se outro processamento gravou antes */
    async registrarEvento(evento) {
      const r = await pedir('registrar evento', 'plano_eventos', { method: 'POST', corpo: evento, prefer: 'return=minimal', aceitarConflito: true });
      return !r?.conflito;
    },
    async assinaturaPorStripeId(id) {
      const linhas = await pedir('ler assinatura', `plano_assinaturas?select=*&stripe_assinatura_id=${eq(id)}`);
      return Array.isArray(linhas) && linhas.length ? linhas[0] : null;
    },
    /** Insere ou atualiza pela chave stripe_assinatura_id. */
    async gravarAssinatura(linha) {
      await pedir('gravar assinatura', 'plano_assinaturas?on_conflict=stripe_assinatura_id', {
        method: 'POST', corpo: linha, prefer: 'resolution=merge-duplicates,return=minimal',
      });
    },
  };
}
