#!/usr/bin/env node
// Etapa 4 do fluxo semanal: só roda quando VOCÊ manda. Depois de revisar
// coleta/AAAA-MM-DD/relatorio.md, aprove com o código que aparece no fim dele.
// O script confere o código, grava dados/ofertas.json, valida, cria a branch
// ofertas/AAAA-MM-DD, faz o commit, envia e abre o pull request. O merge é seu.
//
// Uso: node scripts/aprovar-mudancas.js --data AAAA-MM-DD --codigo <código>
//      [--so-gravar]  grava dados/ofertas.json e para (sem branch, commit nem PR)

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lerData, lerJson } from './coletar.js';
import { validarDados } from './validar-dados.js';
import { codigoDeAprovacao, sha256 } from './atualizacao/comparar.js';
import { serializarOfertas } from './propor-mudancas.js';

const RAIZ = new URL('../', import.meta.url);

/** Roda um comando sem shell (argumentos em lista) e devolve a saída. */
export function executarDeVerdade(comando, args, raiz) {
  return execFileSync(comando, args, { cwd: fileURLToPath(raiz), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Endereço do GitHub para abrir o PR à mão, a partir do remote origin. */
export function linkParaComparar(remote, branch) {
  const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}/compare/main...${encodeURIComponent(branch)}?expand=1` : null;
}

/**
 * Confere a aprovação e publica. Lança erro (sem mexer em nada) se o código não
 * bater, se a proposta tiver erro ou se dados/ofertas.json mudou desde o relatório.
 * `executar(comando, args)` pode ser trocado nos testes.
 */
export async function aprovar({ raiz = RAIZ, data, codigo, soGravar = false, executar = (c, a) => executarDeVerdade(c, a, raiz), log = console.log }) {
  const pasta = new URL(`coleta/${data}/`, raiz);
  const proposta = await lerJson(new URL('proposta.json', pasta));
  const arquivoOfertas = new URL('dados/ofertas.json', raiz);

  // 1. O código aprovado é o desta proposta, e ela não foi editada depois.
  const recalculado = codigoDeAprovacao(proposta.ofertas, proposta.base_sha256);
  if (recalculado !== proposta.codigo) throw new Error('proposta.json foi alterado depois do relatório. Rode propor-mudancas.js de novo.');
  if (codigo !== proposta.codigo) throw new Error('o código não confere com o do relatório desta data. Nada foi gravado.');
  if (proposta.erros_de_validacao.length > 0) throw new Error('a proposta tem erro de validação (veja o fim do relatório). Nada foi gravado.');

  // 2. O ofertas.json de hoje é o mesmo que serviu de base para o relatório.
  if (sha256(await readFile(arquivoOfertas, 'utf8')) !== proposta.base_sha256) {
    throw new Error('dados/ofertas.json mudou depois do relatório. Rode propor-mudancas.js de novo e revise.');
  }

  const branch = `ofertas/${data}`;
  if (!soGravar) {
    if (executar('git', ['status', '--porcelain']) !== '') throw new Error('há mudanças não salvas no Git. Faça commit ou guarde antes de aprovar.');
    const atual = executar('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (atual !== 'main') throw new Error(`você está na branch "${atual}". Volte para a main (git switch main && git pull) antes de aprovar.`);
    executar('git', ['switch', '-c', branch]);
  }

  // 3. Grava e valida de novo com os dados reais.
  await writeFile(arquivoOfertas, serializarOfertas(proposta.ofertas));
  const { erros } = await validarDados(new URL('dados/', raiz), { hoje: data });
  if (erros.length > 0) {
    if (!soGravar) {
      executar('git', ['checkout', '--', 'dados/ofertas.json']);
      executar('git', ['switch', 'main']);
      executar('git', ['branch', '-D', branch]);
    }
    throw new Error(`os dados não passaram na validação; nada foi enviado:\n- ${erros.join('\n- ')}`);
  }
  log('dados/ofertas.json gravado e validado.');
  if (soGravar) return { branch: null, pr: null };

  // 4. Commit, envio e pull request.
  executar('git', ['add', 'dados/ofertas.json']);
  executar('git', ['commit', '-m', `Atualiza ofertas da semana (${data})`, '-m', `Aprovado com o código ${codigo} depois de revisar coleta/${data}/relatorio.md.`]);
  executar('git', ['push', '-u', 'origin', branch]);
  log(`Branch ${branch} enviada.`);

  const corpo = fileURLToPath(new URL('relatorio-pr.md', pasta));
  let pr = null;
  try {
    pr = executar('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `Ofertas da semana: ${data}`, '--body-file', corpo]);
    log(`Pull request aberto: ${pr}`);
  } catch {
    const link = linkParaComparar(executar('git', ['remote', 'get-url', 'origin']), branch);
    log('Não consegui abrir o PR com o gh (instale e faça gh auth login, ou abra à mão).');
    if (link) log(`Abra o PR aqui e cole o texto de coleta/${data}/relatorio-pr.md: ${link}`);
  }
  return { branch, pr };
}

// Linha de comando (fina: a lógica acima é que tem teste).
/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv;
    const i = argv.indexOf('--codigo');
    if (i < 0 || !argv[i + 1]) throw new Error('Informe o código do fim do relatório: --codigo <código>');
    if (argv.indexOf('--data') < 0) throw new Error('Informe a data da coleta: --data AAAA-MM-DD');
    await aprovar({ data: lerData(argv), codigo: argv[i + 1], soGravar: argv.includes('--so-gravar') });
  } catch (falha) {
    console.error(falha.message);
    process.exit(1);
  }
}
/* node:coverage enable */
