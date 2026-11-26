// Acesso do vigia e do painel de custos ao Supabase: só as duas funções da
// migração 20261124120000_operacao.sql. Nunca lê tabela com dado pessoal.
// Chave: SUPABASE_SECRET_KEY (sb_secret_...), a do GitHub Actions.

export function clienteOperacao({ url, chave, fetch: buscar = globalThis.fetch }) {
  const base = String(url ?? '').replace(/\/$/, '');
  if (!chave || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(base)) return null;
  async function rpc(nome, corpo = {}) {
    const resposta = await buscar(`${base}/rest/v1/rpc/${nome}`, {
      method: 'POST',
      headers: { apikey: chave, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo),
    });
    // Nunca leva o corpo da resposta para o log.
    if (!resposta.ok) throw new Error(`Supabase: ${nome} respondeu ${resposta.status}`);
    return resposta.json();
  }
  return {
    resumo: () => rpc('operacao_resumo'),
    limparErros: (dias) => rpc('operacao_limpar_erros', { dias }),
  };
}
