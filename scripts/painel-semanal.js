#!/usr/bin/env node
// Painel semanal das métricas: lojas mais buscadas, lojas sem oferta,
// cliques de saída e taxa calcular → clicar. Grava painel/painel-<fim>.md.
//
// Uso:
//   PLAUSIBLE_API_KEY=... npm run painel
//   npm run painel -- --fim 2026-11-21          (semana que termina nesse dia)
//   npm run painel -- --exemplo                 (números de exemplo, sem chave)
//
// Variáveis de ambiente:
//   PLAUSIBLE_API_KEY   chave da Stats API (obrigatória, fora do --exemplo)
//   PLAUSIBLE_SITE_ID   nome do site no Plausible (padrão: site/js/metricas/config.js)
//   PLAUSIBLE_URL       só se usar o Plausible num servidor próprio

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { hojeEmBrasilia } from './validar-dados.js';
import { lerDados } from './gerar-paginas.js';
import { DOMINIO_NO_PLAUSIBLE } from '../site/js/metricas/config.js';
import { BASE_PADRAO, buscarSemana } from './painel/plausible.js';
import { lojasComOferta, montarPainel, semanaAte } from './painel/montar.js';

const RAIZ = new URL('../', import.meta.url);

export async function gerarPainel({ saida = new URL('painel/', RAIZ), ambiente = process.env, argumentos = process.argv.slice(2), buscar = fetch, hoje = hojeEmBrasilia() } = {}) {
  const { values } = parseArgs({ args: argumentos, options: { fim: { type: 'string' }, exemplo: { type: 'boolean' } } });
  if (values.fim && !/^\d{4}-\d{2}-\d{2}$/.test(values.fim)) throw new Error('--fim precisa ser AAAA-MM-DD');
  const periodo = semanaAte(hoje, values.fim);
  const dados = await lerDados(new URL('dados/', RAIZ));
  const site = ambiente.PLAUSIBLE_SITE_ID || DOMINIO_NO_PLAUSIBLE;

  let eventos;
  if (values.exemplo) {
    eventos = JSON.parse(await readFile(new URL('testes/painel/exemplo.json', RAIZ), 'utf8'));
  } else {
    if (!ambiente.PLAUSIBLE_API_KEY) throw new Error('Defina PLAUSIBLE_API_KEY (chave da Stats API do Plausible). Para ver um exemplo sem chave: npm run painel -- --exemplo');
    if (!site || site === 'A_CONFIRMAR') throw new Error('Defina DOMINIO_NO_PLAUSIBLE em site/js/metricas/config.js (ou PLAUSIBLE_SITE_ID).');
    eventos = await buscarSemana({ base: ambiente.PLAUSIBLE_URL || BASE_PADRAO, chave: ambiente.PLAUSIBLE_API_KEY, site, ...periodo, buscar });
  }
  const texto = montarPainel({ periodo, eventos, lojas: dados.lojas, comOferta: lojasComOferta(dados, hoje), site: values.exemplo ? 'exemplo' : site, geradoEm: hoje });
  const pasta = saida;
  await mkdir(pasta, { recursive: true });
  const arquivo = new URL(`painel-${periodo.fim}${values.exemplo ? '-exemplo' : ''}.md`, pasta);
  await writeFile(arquivo, texto, 'utf8');
  return { arquivo: fileURLToPath(arquivo), texto };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { arquivo } = await gerarPainel();
    console.log(`Painel gravado em ${arquivo}`);
  } catch (erro) {
    console.error(erro.message);
    process.exit(1);
  }
}
