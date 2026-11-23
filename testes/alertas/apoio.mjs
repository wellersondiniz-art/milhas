// Peças falsas para testar os alertas sem Supabase e sem Resend.
import { readFileSync } from 'node:fs';

export function dadosDeTeste() {
  const ler = (nome) => JSON.parse(readFileSync(new URL(`../navegador/dados-de-teste/${nome}.json`, import.meta.url), 'utf8'));
  return { programas: ler('programas'), cartoes: ler('cartoes'), lojas: ler('lojas'), ofertas: ler('ofertas'), cambio: ler('cambio') };
}

export const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
export const URL_SITE = 'https://milhas.exemplo';

/** Mesmo contrato de servidor/alertas/supabase.js, guardado em memória. */
export function repoEmMemoria() {
  const inscricoes = new Map();
  const alertas = new Map();
  const log = [];
  let seq = 0;
  const uuid = () => `a0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const copia = (x) => (x ? structuredClone(x) : null);
  return {
    inscricoes, alertas, log,
    async inscricaoPorEmail(email) { return copia([...inscricoes.values()].find((i) => i.email === email)); },
    async inscricaoPorId(id) { return copia(inscricoes.get(id)); },
    async inscricaoPorToken(hash) { return copia([...inscricoes.values()].find((i) => i.token_hash === hash)); },
    async criarInscricao(campos) {
      if ([...inscricoes.values()].some((i) => i.email === campos.email)) return null;
      const linha = {
        id: uuid(), perfil: null, confirmado_em: null, token_hash: null, token_expira_em: null, pendente: null,
        confirmacoes_recentes: [], alertas_recentes: [], ...campos,
      };
      inscricoes.set(linha.id, linha);
      return copia(linha);
    },
    async atualizarInscricao(id, campos) { Object.assign(inscricoes.get(id), structuredClone(campos)); },
    async apagarInscricao(id) {
      inscricoes.delete(id);
      for (const [aid, a] of alertas) if (a.inscricao_id === id) alertas.delete(aid);
    },
    async apagarNaoConfirmadasVencidas(agora) {
      let n = 0;
      for (const [id, i] of inscricoes) {
        if (!i.confirmado_em && i.token_expira_em && new Date(i.token_expira_em) < agora) { await this.apagarInscricao(id); n += 1; }
      }
      return n;
    },
    async alertasDe(inscricaoId) { return [...alertas.values()].filter((a) => a.inscricao_id === inscricaoId).map(copia); },
    async criarAlerta(campos) {
      const linha = { id: uuid(), ultimo_aviso_chave: null, ultimo_aviso_em: null, ...campos };
      alertas.set(linha.id, linha);
      return copia(linha);
    },
    async atualizarAlerta(id, campos) { Object.assign(alertas.get(id), structuredClone(campos)); },
    async *inscricoesConfirmadas() {
      for (const i of inscricoes.values()) {
        if (i.confirmado_em) yield { ...copia(i), alertas: await this.alertasDe(i.id) };
      }
    },
    async registrarEnvio(registro) { log.push(structuredClone(registro)); },
  };
}

/** Correio falso: guarda o que seria enviado. `falhar` faz o próximo envio dar erro. */
export function correioFalso() {
  const enviados = [];
  return {
    enviados,
    falhar: false,
    async enviar(email) {
      if (this.falhar) { const e = new Error('falhou'); e.status = 500; throw e; }
      enviados.push(email);
      return true;
    },
  };
}

/** Pega o token do link de confirmação de um e-mail enviado. */
export function tokenDoEmail(email) {
  return /confirmar\?t=([A-Za-z0-9_-]{43})/.exec(email.texto)[1];
}

/** Pega id e assinatura do link de cancelar. */
export function cancelarDoEmail(email) {
  const m = /cancelar\?i=([0-9a-f-]{36})&a=([A-Za-z0-9_-]{43})/.exec(email.texto);
  return { i: m[1], a: m[2] };
}

export const PERFIL_COM_CLUBE = {
  versao: 2,
  programas: [{ programa_id: 'programa-alfa', clube_ativo: true, clube_ativo_desde: '2026-10-01' }],
  cartoes: ['cartao-alfa'],
  valor_milheiro_brl: { 'programa-alfa': 2500 },
};
