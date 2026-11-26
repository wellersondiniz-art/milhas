#!/usr/bin/env node
// Alertas da operação como "issue" no GitHub.
//
// Por que issue: o GitHub avisa o dono do repositório por e-mail e pelo app
// GitHub Mobile (notificação no celular) sem nenhuma conta nova. Cada tipo de
// alerta tem uma etiqueta "chave" no título, ex.: [operacao:disponibilidade].
//   - abrir: se já existe issue aberta com a chave, só comenta quando o texto
//     mudou (sem spam a cada 15 minutos); senão, abre e atribui ao dono;
//   - fechar: se existe issue aberta com a chave, comenta "voltou ao normal" e fecha.
//
// O repositório é público: o texto do alerta nunca leva segredo, dado pessoal
// ou detalhe que ajude um atacante. Só o que falhou e o link do robô.
//
// Uso (no GitHub Actions, que já define GITHUB_TOKEN e GITHUB_REPOSITORY):
//   node scripts/operacao/alerta.js abrir  --chave disponibilidade --titulo "..." --corpo-arquivo f.md
//   node scripts/operacao/alerta.js fechar --chave disponibilidade

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';
export const ETIQUETA = 'operacao';

export function marcador(chave) {
  if (!/^[a-z0-9-]{1,40}$/.test(chave ?? '')) throw new Error(`chave inválida: ${chave}`);
  return `[operacao:${chave}]`;
}

/** Cliente mínimo da API REST do GitHub (só o que os alertas usam). */
export function clienteGitHub({ token, repositorio, fetch: buscar = globalThis.fetch }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repositorio ?? '')) return null;
  async function pedir(metodo, caminho, corpo) {
    const resposta = await buscar(`${API}/repos/${repositorio}${caminho}`, {
      method: metodo,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(corpo ? { 'content-type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (!resposta.ok) throw new Error(`GitHub: ${metodo} ${caminho.split('?')[0]} respondeu ${resposta.status}`);
    return resposta.status === 204 ? null : resposta.json();
  }
  return {
    issuesAbertas: () => pedir('GET', `/issues?state=open&labels=${ETIQUETA}&per_page=100`),
    comentarios: (n) => pedir('GET', `/issues/${n}/comments?per_page=100`),
    criar: (dados) => pedir('POST', '/issues', dados),
    comentar: (n, texto) => pedir('POST', `/issues/${n}/comments`, { body: texto }),
    fechar: (n) => pedir('PATCH', `/issues/${n}`, { state: 'closed', state_reason: 'completed' }),
  };
}

async function acharAberta(gh, chave) {
  const lista = await gh.issuesAbertas();
  const m = marcador(chave);
  return lista.find((i) => !i.pull_request && typeof i.title === 'string' && i.title.startsWith(m)) ?? null;
}

/**
 * Abre (ou mantém) o alerta. Devolve 'aberto', 'comentado' ou 'igual'.
 * @param {object} gh  clienteGitHub()
 * @param {{ chave: string, titulo: string, corpo: string, dono?: string }} alerta
 */
export async function abrirAlerta(gh, { chave, titulo, corpo, dono }) {
  const existente = await acharAberta(gh, chave);
  if (!existente) {
    await gh.criar({
      title: `${marcador(chave)} ${titulo}`,
      body: corpo,
      labels: [ETIQUETA],
      ...(dono ? { assignees: [dono] } : {}),
    });
    return 'aberto';
  }
  const comentarios = await gh.comentarios(existente.number);
  const ultimo = comentarios.length > 0 ? comentarios[comentarios.length - 1].body : existente.body;
  if (ultimo === corpo) return 'igual';
  await gh.comentar(existente.number, corpo);
  return 'comentado';
}

/** Fecha o alerta, se houver um aberto. Devolve 'fechado' ou 'nada'. */
export async function fecharAlerta(gh, { chave, texto = 'Voltou ao normal. Alerta fechado pelo robô.' }) {
  const existente = await acharAberta(gh, chave);
  if (!existente) return 'nada';
  await gh.comentar(existente.number, texto);
  await gh.fechar(existente.number);
  return 'fechado';
}

export function lerArgumentos(argv) {
  const [acao, ...resto] = argv;
  if (acao !== 'abrir' && acao !== 'fechar') throw new Error('use: alerta.js abrir|fechar --chave <chave> [--titulo <texto>] [--corpo-arquivo <arquivo>]');
  const opcoes = { acao };
  for (let i = 0; i < resto.length; i += 2) {
    const nome = resto[i];
    const valor = resto[i + 1];
    if (!['--chave', '--titulo', '--corpo-arquivo'].includes(nome) || valor === undefined) throw new Error(`argumento inválido: ${nome}`);
    opcoes[nome.slice(2).replace('-arquivo', 'Arquivo')] = valor;
  }
  marcador(opcoes.chave);
  if (acao === 'abrir' && !opcoes.titulo) throw new Error('abrir precisa de --titulo');
  return opcoes;
}

/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opcoes = lerArgumentos(process.argv.slice(2));
    const gh = clienteGitHub({ token: process.env.GITHUB_TOKEN, repositorio: process.env.GITHUB_REPOSITORY });
    if (!gh) {
      console.log('Sem GITHUB_TOKEN/GITHUB_REPOSITORY: alerta não enviado (rode no GitHub Actions).');
      process.exit(0);
    }
    if (opcoes.acao === 'abrir') {
      const corpo = opcoes.corpoArquivo ? await readFile(opcoes.corpoArquivo, 'utf8') : opcoes.titulo;
      const r = await abrirAlerta(gh, { chave: opcoes.chave, titulo: opcoes.titulo, corpo, dono: process.env.GITHUB_REPOSITORY_OWNER });
      console.log(`Alerta ${opcoes.chave}: ${r}.`);
    } else {
      console.log(`Alerta ${opcoes.chave}: ${await fecharAlerta(gh, { chave: opcoes.chave })}.`);
    }
  } catch (falha) {
    console.error(falha.message);
    process.exit(1);
  }
}
/* node:coverage enable */
