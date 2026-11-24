#!/usr/bin/env node
// Painel de custos (GitHub Actions, todo dia; ou npm run custos no computador).
//
// Junta, para cada serviço de operacao/custos.json, o quanto já foi usado no
// mês e compara com o limite. Medições:
//   anthropic_custo_mes   gasto do mês na Anthropic (API de custos, chave de
//                         administrador ANTHROPIC_ADMIN_KEY, só leitura de custo)
//   supabase_banco_bytes  tamanho do banco   } função operacao_resumo() do Supabase
//   emails_mes, emails_24h  e-mails enviados } (SUPABASE_URL e SUPABASE_SECRET_KEY)
// Sem a chave de um serviço, a linha aparece como "sem medição" e não alerta.
//
// Alerta (issue no GitHub, chave "custos") quando qualquer cota passa de
// alerta_percentual (80%). Fecha sozinho quando tudo volta para baixo disso.
//
// Dinheiro em inteiros: centavos de dólar no arquivo de limites e
// NANODÓLARES (1 dólar = 1.000.000.000) na conta, como no "Explica pra mim".
// Arredonda só na hora de mostrar.

import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { abrirAlerta, clienteGitHub, fecharAlerta } from './alerta.js';
import { clienteOperacao } from './supabase.js';

const RAIZ = new URL('../../', import.meta.url);
export const NANO_POR_CENTAVO = 10_000_000;

/** "123.4567" (centavos, texto decimal) → nanodólares inteiros. Lança se o texto não for número. */
export function centavosTextoParaNano(texto) {
  const t = String(texto ?? '').trim();
  const achado = t.match(/^(\d+)(?:\.(\d+))?$/);
  if (!achado) throw new Error(`valor de custo inválido: ${JSON.stringify(t).slice(0, 30)}`);
  const inteiros = Number.parseInt(achado[1], 10);
  // 1 centavo = 10^7 nanodólares: 7 casas decimais bastam; o resto é menos de 1 nanodólar.
  const fracao = Number.parseInt((achado[2] ?? '').padEnd(7, '0').slice(0, 7), 10);
  const nano = inteiros * NANO_POR_CENTAVO + fracao;
  if (!Number.isSafeInteger(nano)) throw new Error('valor de custo grande demais');
  return nano;
}

/** Primeiro instante do mês (UTC) e a hora cheia atual, em ISO. */
export function periodoDoMes(agora) {
  const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
  const fim = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), agora.getUTCHours()));
  return { inicio: inicio.toISOString(), fim: fim.toISOString(), vazio: fim.getTime() <= inicio.getTime() };
}

/**
 * Gasto do mês na Anthropic, em nanodólares, pela API de custos
 * (GET /v1/organizations/analytics/cost). Soma "amount" de todas as linhas e páginas.
 */
export async function gastoAnthropic({ chave, agora, fetch: buscar = globalThis.fetch }) {
  const { inicio, fim, vazio } = periodoDoMes(agora);
  if (vazio) return 0;
  let total = 0;
  let pagina = null;
  for (let voltas = 0; voltas < 20; voltas += 1) {
    const url = new URL('https://api.anthropic.com/v1/organizations/analytics/cost');
    url.searchParams.set('starting_at', inicio);
    url.searchParams.set('ending_at', fim);
    url.searchParams.set('limit', '1000');
    if (pagina) url.searchParams.set('page', pagina);
    const resposta = await buscar(url, {
      headers: {
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'analytics-usage-cost-2026-08-24',
      },
    });
    if (!resposta.ok) throw new Error(`Anthropic: custo do mês respondeu ${resposta.status}`);
    const dados = await resposta.json();
    for (const linha of dados.data ?? []) {
      if (linha?.amount !== undefined && linha?.amount !== null) total += centavosTextoParaNano(linha.amount);
      for (const r of linha?.results ?? []) if (r?.amount !== undefined && r?.amount !== null) total += centavosTextoParaNano(r.amount);
    }
    if (!dados.has_more || !dados.next_page) return total;
    pagina = dados.next_page;
  }
  throw new Error('Anthropic: páginas demais na resposta de custos');
}

const DINHEIRO = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INTEIRO = new Intl.NumberFormat('pt-BR');
const DECIMAL1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Mostra uma quantidade na unidade da cota. Só aqui há arredondamento. */
export function formatar(valor, unidade) {
  if (unidade === 'nano_usd') return `US$ ${DINHEIRO.format(valor / 1e9)}`;
  if (unidade === 'centavos_usd') return `US$ ${DINHEIRO.format(valor / 100)}`;
  if (unidade === 'bytes') {
    if (valor >= 1024 ** 3) return `${DECIMAL1.format(valor / 1024 ** 3)} GB`;
    if (valor >= 1024 ** 2) return `${DECIMAL1.format(valor / 1024 ** 2)} MB`;
    return `${INTEIRO.format(Math.ceil(valor / 1024))} KB`;
  }
  return INTEIRO.format(valor);
}

/** Porcentagem inteira (para baixo) de usado/limite. */
export function percentual(usado, limite) {
  if (!(limite > 0)) return null;
  return Math.floor((usado * 100) / limite);
}

/**
 * Monta as linhas do painel.
 * @param {object} config    operacao/custos.json
 * @param {Record<string, number|null|undefined>} medidas  por nome de medição;
 *        anthropic_custo_mes em NANODÓLARES, o resto na unidade da cota.
 */
export function montarPainel(config, medidas) {
  const alertaEm = Number.isInteger(config.alerta_percentual) ? config.alerta_percentual : 80;
  const linhas = [];
  let fixoCentavos = 0;
  let variavelNano = 0;
  for (const s of config.servicos) {
    fixoCentavos += s.custo_fixo_centavos_usd ?? 0;
    if (s.cotas.length === 0) {
      linhas.push({ servico: s.nome, plano: s.plano, cota: '-', usado: null, limiteTexto: '-', pct: null, situacao: 'sem cota medida' });
      continue;
    }
    for (const c of s.cotas) {
      const bruto = medidas[c.medicao];
      // O gasto vem em nanodólares; o limite do arquivo, em centavos.
      const emNano = c.unidade === 'centavos_usd';
      const limite = emNano ? c.limite * NANO_POR_CENTAVO : c.limite;
      const unidade = emNano ? 'nano_usd' : c.unidade;
      if (bruto === null || bruto === undefined) {
        linhas.push({ servico: s.nome, plano: s.plano, cota: c.nome, usado: null, limiteTexto: formatar(limite, unidade), pct: null, situacao: 'sem medição (falta configurar)' });
        continue;
      }
      if (emNano) variavelNano += bruto;
      const pct = percentual(bruto, limite);
      const situacao = pct >= 100 ? 'LIMITE ESTOURADO' : pct >= alertaEm ? 'ATENÇÃO' : 'ok';
      linhas.push({ servico: s.nome, plano: s.plano, cota: c.nome, usado: formatar(bruto, unidade), limiteTexto: formatar(limite, unidade), pct, situacao });
    }
  }
  const totalNano = fixoCentavos * NANO_POR_CENTAVO + variavelNano;
  return { linhas, alertaEm, totalNano, problema: linhas.some((l) => l.pct !== null && l.pct >= alertaEm), estourado: linhas.some((l) => l.pct !== null && l.pct >= 100) };
}

export function textoDoPainel(painel, { hoje } = {}) {
  const t = [
    `## Custos do mês${hoje ? ` (até ${hoje})` : ''}`,
    '',
    '| Serviço | Plano | O que é medido | Usado | Limite | % | Situação |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...painel.linhas.map((l) => `| ${l.servico} | ${l.plano} | ${l.cota} | ${l.usado ?? '-'} | ${l.limiteTexto} | ${l.pct === null ? '-' : `${l.pct}%`} | ${l.situacao} |`),
    '',
    `Total do mês até agora (fixos + medidos): **${formatar(painel.totalNano, 'nano_usd')}**.`,
    `Alerta quando qualquer linha passa de ${painel.alertaEm}% do limite.`,
  ];
  return `${t.join('\n')}\n`;
}

/** Lê todas as medições que estiverem configuradas. Falha de um serviço não derruba os outros. */
export async function medir(env, { fetch: buscar = globalThis.fetch, agora = new Date() } = {}) {
  const medidas = {};
  const avisos = [];
  if (env.ANTHROPIC_ADMIN_KEY) {
    try {
      medidas.anthropic_custo_mes = await gastoAnthropic({ chave: env.ANTHROPIC_ADMIN_KEY, agora, fetch: buscar });
    } catch (erro) {
      avisos.push(erro.message);
    }
  }
  const banco = clienteOperacao({ url: env.SUPABASE_URL, chave: env.SUPABASE_SECRET_KEY, fetch: buscar });
  if (banco) {
    try {
      const r = await banco.resumo();
      medidas.supabase_banco_bytes = Number(r.banco_bytes);
      medidas.emails_mes = Number(r.emails_mes);
      medidas.emails_24h = Number(r.emails_24h);
    } catch (erro) {
      avisos.push(erro.message);
    }
  }
  return { medidas, avisos };
}

/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(await readFile(new URL('operacao/custos.json', RAIZ), 'utf8'));
    const { medidas, avisos } = await medir(process.env);
    const painel = montarPainel(config, medidas);
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    let texto = textoDoPainel(painel, { hoje });
    if (avisos.length) texto += `\nMedições que falharam: ${avisos.join('; ')}\n`;
    console.log(texto);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, texto);
    const gh = clienteGitHub({ token: process.env.GITHUB_TOKEN, repositorio: process.env.GITHUB_REPOSITORY });
    if (gh) {
      const r = painel.problema
        ? await abrirAlerta(gh, {
          chave: 'custos',
          titulo: painel.estourado ? 'Limite de custo estourado' : `Custo passou de ${painel.alertaEm}% do limite`,
          corpo: `${texto}\nO que fazer: siga a seção "Painel de custos" de docs/operacao.md.\n`,
          dono: process.env.GITHUB_REPOSITORY_OWNER,
        })
        : await fecharAlerta(gh, { chave: 'custos' });
      console.log(`Alerta custos: ${r}.`);
    }
    if (avisos.length) process.exit(1);
  } catch (falha) {
    console.error(`O painel de custos parou: ${falha.message}`);
    process.exit(1);
  }
}
/* node:coverage enable */
