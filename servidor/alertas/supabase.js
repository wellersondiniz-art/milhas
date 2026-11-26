// Acesso às tabelas dos alertas pela API REST do Supabase (PostgREST).
//
// Só o servidor chama isto: as tabelas têm RLS forçada, nenhuma política e
// nenhum grant para anon/authenticated (supabase/migrations/). A chave é uma
// chave secreta do Supabase (sb_secret_...) lida do ambiente do servidor
// (SUPABASE_SECRET_KEY) e vai só no cabeçalho "apikey", como pede a
// documentação das chaves novas. Use chaves separadas para a Cloudflare e para
// o GitHub Actions: dá para revogar uma sem parar a outra.
//
// Erros nunca levam o corpo da resposta para o log (pode ter e-mail).

export class ErroDoBanco extends Error {
  constructor(operacao, status) {
    super(`Supabase: ${operacao} falhou (status ${status})`);
    this.status = status;
  }
}

const PAGINA = 500;

/**
 * @param {object} o
 * @param {string} o.url    SUPABASE_URL, ex.: https://abcd.supabase.co
 * @param {string} o.chave  SUPABASE_SECRET_KEY
 * @param {typeof fetch} [o.fetch]
 */
export function repositorioSupabase({ url, chave, fetch: buscar = globalThis.fetch }) {
  if (!url || !chave || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url.replace(/\/$/, ''))) return null;
  const base = `${url.replace(/\/$/, '')}/rest/v1`;

  async function pedir(operacao, caminho, { method = 'GET', corpo, prefer, extras = {} } = {}) {
    const resposta = await buscar(`${base}/${caminho}`, {
      method,
      headers: {
        apikey: chave,
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
        ...extras,
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    if (!resposta.ok) throw new ErroDoBanco(operacao, resposta.status);
    if (resposta.status === 204) return null;
    const texto = await resposta.text();
    return texto ? JSON.parse(texto) : null;
  }
  const eq = (v) => `eq.${encodeURIComponent(v)}`;
  const primeiro = (linhas) => (Array.isArray(linhas) && linhas.length ? linhas[0] : null);

  return {
    async inscricaoPorEmail(email) {
      return primeiro(await pedir('ler inscrição', `alertas_inscricoes?select=*&email=${eq(email)}`));
    },
    async inscricaoPorId(id) {
      return primeiro(await pedir('ler inscrição', `alertas_inscricoes?select=*&id=${eq(id)}`));
    },
    async inscricaoPorToken(tokenHash) {
      return primeiro(await pedir('ler inscrição', `alertas_inscricoes?select=*&token_hash=${eq(tokenHash)}`));
    },
    async criarInscricao(campos) {
      return primeiro(await pedir('criar inscrição', 'alertas_inscricoes', { method: 'POST', corpo: campos, prefer: 'return=representation' }));
    },
    async atualizarInscricao(id, campos) {
      await pedir('atualizar inscrição', `alertas_inscricoes?id=${eq(id)}`, { method: 'PATCH', corpo: campos, prefer: 'return=minimal' });
    },
    async apagarInscricao(id) {
      await pedir('apagar inscrição', `alertas_inscricoes?id=${eq(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
    },
    async apagarNaoConfirmadasVencidas(agora) {
      const linhas = await pedir('apagar pedidos vencidos',
        `alertas_inscricoes?confirmado_em=is.null&token_expira_em=lt.${encodeURIComponent(agora.toISOString())}&select=id`,
        { method: 'DELETE', prefer: 'return=representation' });
      return Array.isArray(linhas) ? linhas.length : 0;
    },
    async alertasDe(inscricaoId) {
      return await pedir('ler alertas', `alertas_email?select=*&inscricao_id=${eq(inscricaoId)}&order=criado_em`) ?? [];
    },
    async criarAlerta(campos) {
      return primeiro(await pedir('criar alerta', 'alertas_email', { method: 'POST', corpo: campos, prefer: 'return=representation' }));
    },
    async atualizarAlerta(id, campos) {
      await pedir('atualizar alerta', `alertas_email?id=${eq(id)}`, { method: 'PATCH', corpo: campos, prefer: 'return=minimal' });
    },
    /** Inscrições confirmadas, cada uma com os seus alertas, em páginas. */
    async *inscricoesConfirmadas() {
      for (let inicio = 0; ; inicio += PAGINA) {
        const linhas = await pedir('listar inscrições',
          'alertas_inscricoes?select=id,email,perfil,alertas_recentes,alertas_email(*)&confirmado_em=not.is.null&order=id',
          { extras: { 'Range-Unit': 'items', Range: `${inicio}-${inicio + PAGINA - 1}` } }) ?? [];
        for (const linha of linhas) yield { ...linha, alertas: linha.alertas_email ?? [] };
        if (linhas.length < PAGINA) return;
      }
    },
    async registrarEnvio(registro) {
      await pedir('registrar envio', 'alertas_envios', { method: 'POST', corpo: registro, prefer: 'return=minimal' });
    },
  };
}
