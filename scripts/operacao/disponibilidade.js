#!/usr/bin/env node
// Monitor de disponibilidade de reserva (o principal é o UptimeRobot, fora do
// GitHub; ver docs/operacao.md). Roda no GitHub Actions a cada 15 minutos.
//
// Confere três coisas no endereço de SITE_URL:
//   1. a página inicial responde 200 e é HTML;
//   2. /dados/ofertas.json responde 200 e é uma lista (o comparador depende dele);
//   3. cada pedido termina em até 15 segundos.
// Antes de acusar queda, tenta de novo depois de 30 segundos (evita alarme
// falso por um soluço da rede).
//
// Desligado até configurar: sem a variável SITE_URL (GitHub → Settings →
// Secrets and variables → Actions → Variables), só avisa e termina sem erro.
//
// Saída: escreve o texto do alerta em --saida <arquivo> e termina com
//   0 = no ar, 1 = fora do ar (o workflow abre o alerta), 2 = erro de uso.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TEMPO_LIMITE_MS = 15_000;
const AGENTE = 'milhas-monitor/1.0';

export function urlDoSite(valor) {
  const texto = String(valor ?? '').trim().replace(/\/+$/, '');
  if (!texto) return null;
  let url;
  try {
    url = new URL(texto);
  } catch {
    throw new Error('SITE_URL inválida (use https://seu-dominio).');
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SITE_URL precisa ser só https://dominio, sem caminho.');
  }
  return url.origin;
}

/** Os pontos conferidos, cada um com uma função que diz se o conteúdo está certo. */
export const PONTOS = Object.freeze([
  Object.freeze({
    nome: 'Página inicial',
    caminho: '/',
    conferir: (tipo, corpo) => /text\/html/i.test(tipo) && /<html/i.test(corpo),
  }),
  Object.freeze({
    nome: 'Dados das ofertas',
    caminho: '/dados/ofertas.json',
    conferir: (tipo, corpo) => {
      try {
        return Array.isArray(JSON.parse(corpo));
      } catch {
        return false;
      }
    },
  }),
]);

/** Confere um ponto. Nunca lança: devolve { ok, motivo, ms }. */
export async function conferirPonto(base, ponto, { fetch: buscar = globalThis.fetch, relogio = () => Date.now() } = {}) {
  const inicio = relogio();
  try {
    const resposta = await buscar(`${base}${ponto.caminho}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: { 'user-agent': AGENTE, 'cache-control': 'no-cache' },
    });
    const corpo = await resposta.text();
    const ms = relogio() - inicio;
    if (!resposta.ok) return { ok: false, motivo: `respondeu ${resposta.status}`, ms };
    if (!ponto.conferir(resposta.headers.get('content-type') ?? '', corpo)) return { ok: false, motivo: 'respondeu, mas o conteúdo não é o esperado', ms };
    return { ok: true, motivo: 'ok', ms };
  } catch (erro) {
    const ms = relogio() - inicio;
    const motivo = erro?.name === 'TimeoutError' || erro?.name === 'AbortError' ? `não respondeu em ${TEMPO_LIMITE_MS / 1000} s` : 'não conectou (DNS, certificado ou servidor fora do ar)';
    return { ok: false, motivo, ms };
  }
}

/** Confere todos os pontos; o que falhar é conferido de novo depois de `pausaMs`. */
export async function conferirSite(base, { fetch: buscar, pausaMs = 30_000, esperar = (ms) => new Promise((r) => setTimeout(r, ms)), relogio } = {}) {
  const resultados = [];
  for (const ponto of PONTOS) resultados.push({ ponto, ...(await conferirPonto(base, ponto, { fetch: buscar, relogio })) });
  if (resultados.every((r) => r.ok)) return resultados;
  await esperar(pausaMs);
  for (const r of resultados) {
    if (!r.ok) Object.assign(r, await conferirPonto(base, r.ponto, { fetch: buscar, relogio }));
  }
  return resultados;
}

export function textoDoAlerta(base, resultados, linkDoRobo) {
  const linhas = [
    `O monitor não conseguiu abrir o site ${base}.`,
    '',
    '| O que foi conferido | Resultado |',
    '| --- | --- |',
    ...resultados.map((r) => `| ${r.ponto.nome} (${r.ponto.caminho}) | ${r.ok ? 'ok' : `**falhou**: ${r.motivo}`} |`),
    '',
    'O que fazer: siga a seção "Site fora do ar" de docs/operacao.md.',
    'Quando o site voltar, este alerta fecha sozinho.',
  ];
  if (linkDoRobo) linhas.push('', `Execução do robô: ${linkDoRobo}`);
  return `${linhas.join('\n')}\n`;
}

export function linkDaExecucao(env) {
  const { GITHUB_SERVER_URL: s, GITHUB_REPOSITORY: r, GITHUB_RUN_ID: id } = env;
  return s && r && id ? `${s}/${r}/actions/runs/${id}` : null;
}

/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const i = process.argv.indexOf('--saida');
    const saida = i >= 0 ? process.argv[i + 1] : null;
    const base = urlDoSite(process.env.SITE_URL);
    if (!base) {
      console.log('Monitor desligado: defina a variável SITE_URL (veja docs/operacao.md).');
      process.exit(0);
    }
    const resultados = await conferirSite(base);
    for (const r of resultados) console.log(`${r.ok ? 'ok    ' : 'FALHOU'} ${r.ponto.caminho} (${r.ms} ms) ${r.ok ? '' : r.motivo}`);
    if (resultados.every((r) => r.ok)) process.exit(0);
    if (saida) await writeFile(saida, textoDoAlerta(base, resultados, linkDaExecucao(process.env)));
    process.exit(1);
  } catch (falha) {
    console.error(falha.message);
    process.exit(2);
  }
}
/* node:coverage enable */
