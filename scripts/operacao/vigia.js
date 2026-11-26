#!/usr/bin/env node
// Vigia diário da operação (GitHub Actions, todo dia às 9h de Brasília).
//
// Cada conferência tem uma "chave" e vira um alerta próprio (issue no GitHub,
// ver alerta.js). Quando o problema some, o alerta fecha sozinho.
//
//   ofertas-paradas   a conferência mais recente em dados/ofertas.json tem
//                     mais de OFERTAS_PRAZO_DIAS dias (padrão 8: semanal + 1 dia).
//   ofertas-pr-parado um pull request de ofertas (branch ofertas/AAAA-MM-DD)
//                     está aberto há mais de 3 dias: a atualização foi
//                     aprovada, mas não entrou no ar.
//   robos-com-falha   a última execução de algum robô na main falhou
//                     (alertas, backup, custos, testes, ...). O monitor de
//                     disponibilidade e o backup têm alerta próprio e ficam de fora.
//   erros-servidor    nas últimas 24 h houve erro 500 nas funções do servidor,
//                     ou 20 erros ou mais de qualquer tipo (precisa do Supabase).
//
// Também apaga do banco os erros com mais de 30 dias.
// Nada aqui lê ou escreve dado pessoal.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hojeEmBrasilia } from '../validar-dados.js';
import { abrirAlerta, clienteGitHub, fecharAlerta } from './alerta.js';
import { clienteOperacao } from './supabase.js';

const RAIZ = new URL('../../', import.meta.url);
const DIA_MS = 86_400_000;
export const PRAZO_PADRAO_DIAS = 8;
export const PR_PARADO_DIAS = 3;
export const LIMITE_ERROS_24H = 20;

/** Dias entre duas datas AAAA-MM-DD (b - a). */
export function diasEntre(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA_MS);
}

export function prazoDoAmbiente(valor) {
  const n = Number.parseInt(valor ?? '', 10);
  return Number.isSafeInteger(n) && n >= 1 && n <= 60 ? n : PRAZO_PADRAO_DIAS;
}

/**
 * Ofertas paradas? Usa a data de verificação mais recente entre as ofertas.
 * Sem nenhuma oferta com data, não acusa (a operação ainda não começou).
 */
export function conferirOfertas(ofertas, hoje, prazoDias = PRAZO_PADRAO_DIAS) {
  const datas = (Array.isArray(ofertas) ? ofertas : [])
    .map((o) => o?.verificado_em)
    .filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= hoje)
    .sort();
  if (datas.length === 0) return { chave: 'ofertas-paradas', problema: false, resumo: 'nenhuma oferta com data de verificação ainda' };
  const ultima = datas[datas.length - 1];
  const dias = diasEntre(ultima, hoje);
  const problema = dias > prazoDias;
  return {
    chave: 'ofertas-paradas',
    problema,
    resumo: `última conferência de ofertas em ${ultima} (${dias} dia(s) atrás; prazo ${prazoDias})`,
    titulo: `Ofertas sem atualização há ${dias} dias`,
    corpo: [
      `A atualização semanal das ofertas está parada: a conferência mais recente em dados/ofertas.json é de ${ultima}, ${dias} dias atrás (o prazo é ${prazoDias} dias).`,
      '',
      'O que fazer: rode a atualização semanal (npm run coletar, extrair, propor e aprovar) e faça o merge do pull request.',
      'Se um passo falhou, a seção "Atualização de ofertas falhou ou parou" de docs/operacao.md diz o que olhar.',
      '',
      'Este alerta fecha sozinho no dia seguinte ao merge.',
    ].join('\n'),
  };
}

/** Pull requests de ofertas abertos há mais de PR_PARADO_DIAS dias. */
export function conferirPrsDeOfertas(prs, agora) {
  const parados = (prs ?? [])
    .filter((p) => typeof p?.head?.ref === 'string' && p.head.ref.startsWith('ofertas/'))
    .filter((p) => agora.getTime() - Date.parse(p.created_at) > PR_PARADO_DIAS * DIA_MS);
  return {
    chave: 'ofertas-pr-parado',
    problema: parados.length > 0,
    resumo: parados.length ? `${parados.length} pull request(s) de ofertas parado(s)` : 'nenhum pull request de ofertas parado',
    titulo: 'Atualização de ofertas aprovada, mas sem merge',
    corpo: [
      `Há pull request de ofertas aberto há mais de ${PR_PARADO_DIAS} dias. A atualização foi aprovada, mas ainda não está no ar:`,
      '',
      ...parados.map((p) => `- #${p.number} (${p.head.ref})`),
      '',
      'O que fazer: abra o pull request, veja se os testes passaram e faça o merge. Se os testes falharam, a proposta tem um erro: rode de novo a semana.',
    ].join('\n'),
  };
}

const FALHAS = new Set(['failure', 'timed_out', 'startup_failure']);

/** Último resultado de cada robô (workflow) na main; acusa os que falharam. */
export function conferirRobos(execucoes, ignorar = ['vigia', 'disponibilidade', 'backup']) {
  const ultima = new Map();
  for (const e of execucoes ?? []) {
    if (e?.status !== 'completed' || ignorar.includes(e.name)) continue;
    const atual = ultima.get(e.workflow_id);
    if (!atual || Date.parse(e.created_at) > Date.parse(atual.created_at)) ultima.set(e.workflow_id, e);
  }
  const falharam = [...ultima.values()].filter((e) => FALHAS.has(e.conclusion)).sort((a, b) => a.name.localeCompare(b.name));
  return {
    chave: 'robos-com-falha',
    problema: falharam.length > 0,
    resumo: falharam.length ? `robô(s) com falha: ${falharam.map((e) => e.name).join(', ')}` : `${ultima.size} robô(s) conferido(s), nenhum com falha`,
    titulo: `Robô com falha: ${falharam.map((e) => e.name).join(', ')}`,
    corpo: [
      'A última execução destes robôs na main falhou:',
      '',
      ...falharam.map((e) => `- ${e.name}: ${e.html_url}`),
      '',
      'O que fazer: abra o link, veja o passo em vermelho e siga a seção do robô em docs/operacao.md. Depois de corrigir, rode o robô de novo (Actions → nome do robô → Run workflow).',
    ].join('\n'),
  };
}

/** Erros do servidor nas últimas 24 h (de operacao_resumo()). null = Supabase não configurado. */
export function conferirErros(resumo) {
  if (!resumo) return { chave: 'erros-servidor', problema: false, desligado: true, resumo: 'Supabase não configurado: erros só no log da Cloudflare' };
  const total = Number(resumo.erros_24h) || 0;
  const graves = Number(resumo.erros_500_24h) || 0;
  return {
    chave: 'erros-servidor',
    problema: graves > 0 || total >= LIMITE_ERROS_24H,
    resumo: `${total} erro(s) nas últimas 24 h (${graves} erro(s) 500)`,
    titulo: `Erros no servidor: ${total} nas últimas 24 h`,
    corpo: [
      `Nas últimas 24 horas as funções do site registraram ${total} erro(s), ${graves} deles sem tratamento (status 500).`,
      '',
      'O que fazer: no Supabase, abra Table Editor → operacao_erros e veja a rota, o tipo e a mensagem (não há dado pessoal ali).',
      'A seção "Erros no servidor" de docs/operacao.md explica como ler.',
    ].join('\n'),
  };
}

/** Abre ou fecha o alerta de cada conferência. Conferência desligada não mexe em nada. */
export async function aplicarAlertas(gh, conferencias, { dono, link } = {}) {
  const feito = [];
  for (const c of conferencias) {
    if (c.desligado) continue;
    if (c.problema) {
      const corpo = link ? `${c.corpo}\n\nExecução do vigia: ${link}\n` : `${c.corpo}\n`;
      feito.push([c.chave, await abrirAlerta(gh, { chave: c.chave, titulo: c.titulo, corpo, dono })]);
    } else {
      feito.push([c.chave, await fecharAlerta(gh, { chave: c.chave })]);
    }
  }
  return feito;
}

/** Lê o GitHub (PRs abertos e execuções na main). Separado para teste. */
export async function lerGitHub({ token, repositorio, fetch: buscar = globalThis.fetch }) {
  const cabecalhos = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  const pedir = async (caminho) => {
    const r = await buscar(`https://api.github.com/repos/${repositorio}${caminho}`, { headers: cabecalhos });
    if (!r.ok) throw new Error(`GitHub: ${caminho.split('?')[0]} respondeu ${r.status}`);
    return r.json();
  };
  const [prs, execucoes] = await Promise.all([
    pedir('/pulls?state=open&per_page=100'),
    pedir('/actions/runs?branch=main&per_page=100&exclude_pull_requests=true'),
  ]);
  return { prs, execucoes: execucoes.workflow_runs ?? [] };
}

/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const agora = new Date();
    const hoje = hojeEmBrasilia(agora);
    const ofertas = JSON.parse(await readFile(new URL('dados/ofertas.json', RAIZ), 'utf8'));
    const conferencias = [conferirOfertas(ofertas, hoje, prazoDoAmbiente(process.env.OFERTAS_PRAZO_DIAS))];

    const token = process.env.GITHUB_TOKEN;
    const repositorio = process.env.GITHUB_REPOSITORY;
    if (token && repositorio) {
      const { prs, execucoes } = await lerGitHub({ token, repositorio });
      conferencias.push(conferirPrsDeOfertas(prs, agora), conferirRobos(execucoes));
    }

    const banco = clienteOperacao({ url: process.env.SUPABASE_URL, chave: process.env.SUPABASE_SECRET_KEY });
    conferencias.push(conferirErros(banco ? await banco.resumo() : null));
    if (banco) console.log(`Limpeza: ${await banco.limparErros(30)} erro(s) com mais de 30 dias apagado(s).`);

    for (const c of conferencias) console.log(`${c.desligado ? 'desligado' : c.problema ? 'PROBLEMA ' : 'ok       '} ${c.chave}: ${c.resumo}`);

    const gh = clienteGitHub({ token, repositorio });
    if (gh) {
      const link = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${repositorio}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
      for (const [chave, r] of await aplicarAlertas(gh, conferencias, { dono: process.env.GITHUB_REPOSITORY_OWNER, link })) console.log(`Alerta ${chave}: ${r}.`);
    }
  } catch (falha) {
    console.error(`O vigia parou: ${falha.message}`);
    process.exit(1);
  }
}
/* node:coverage enable */
