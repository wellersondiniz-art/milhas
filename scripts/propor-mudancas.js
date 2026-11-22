#!/usr/bin/env node
// Etapa 3 do fluxo semanal: compara as ofertas extraídas com dados/ofertas.json
// e gera o relatório em português. NÃO grava nada em dados/: a lista proposta
// fica em coleta/AAAA-MM-DD/proposta.json até você aprovar
// (scripts/aprovar-mudancas.js).
//
// Uso: node scripts/propor-mudancas.js [--data AAAA-MM-DD]
// Saída: coleta/AAAA-MM-DD/relatorio.md (com trechos, para revisar),
//        coleta/AAAA-MM-DD/relatorio-pr.md (sem trechos, vira o texto do PR) e
//        coleta/AAAA-MM-DD/proposta.json.

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lerData, lerJson } from './coletar.js';
import { validarDados } from './validar-dados.js';
import { codigoDeAprovacao, compararOfertas, chave, sha256 } from './atualizacao/comparar.js';
import { montarRelatorio } from './atualizacao/relatorio.js';

const RAIZ = new URL('../', import.meta.url);

/** Valida uma lista de ofertas junto com o resto do cadastro, numa pasta temporária. */
export async function validarProposta(pastaDados, final, hoje) {
  const tmp = await mkdtemp(join(tmpdir(), 'proposta-'));
  try {
    await cp(fileURLToPath(pastaDados), tmp, { recursive: true });
    await writeFile(join(tmp, 'ofertas.json'), `${JSON.stringify(final, null, 2)}\n`);
    return await validarDados(pathToFileURL(`${tmp}/`), { hoje });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Formato do ofertas.json gravado: 2 espaços e quebra de linha no fim. */
export const serializarOfertas = (lista) => `${JSON.stringify(lista, null, 2)}\n`;

/**
 * Gera a proposta e os relatórios em `pasta` (coleta/AAAA-MM-DD/).
 * Devolve { proposta, relatorio, comparacao }.
 */
export async function propor({ pasta, pastaDados, aviso }) {
  const extracao = await lerJson(new URL('extracao.json', pasta));
  const data = extracao.data;
  const textoBase = await readFile(new URL('ofertas.json', pastaDados), 'utf8');
  const atuais = JSON.parse(textoBase);
  const dados = {
    programas: await lerJson(new URL('programas.json', pastaDados)),
    lojas: await lerJson(new URL('lojas.json', pastaDados)),
    cartoes: await lerJson(new URL('cartoes.json', pastaDados)),
  };

  const okFontes = extracao.fontes.filter((f) => !f.erro);
  const propostas = okFontes.flatMap((f) => f.ofertas);
  const evidencias = Object.assign({}, ...okFontes.map((f) => f.evidencias));
  const problemas = okFontes.flatMap((f) => f.problemas);
  const cobertos = new Set(okFontes.map((f) => chave(f)));

  const comparacao = compararOfertas({ atuais, propostas, cobertos, hoje: data });
  const baseSha256 = sha256(textoBase);
  const codigo = codigoDeAprovacao(comparacao.final, baseSha256);
  const validacao = await validarProposta(pastaDados, comparacao.final, data);

  const proposta = { data, base_sha256: baseSha256, codigo, erros_de_validacao: validacao.erros, ofertas: comparacao.final };
  const base = { data, comparacao, dados, evidencias, problemas, fontes: extracao.fontes, codigo, aviso };
  let relatorio = montarRelatorio({ ...base, comTrechos: true });
  let relatorioPr = montarRelatorio({ ...base, comTrechos: false });
  if (validacao.erros.length > 0) {
    const bloco = `\n## A proposta não passa na validação\n\nNão dá para aprovar enquanto houver erro:\n\n${validacao.erros.map((e) => `- ${e}`).join('\n')}\n`;
    relatorio += bloco;
    relatorioPr += bloco;
  }

  await writeFile(new URL('proposta.json', pasta), `${JSON.stringify(proposta, null, 2)}\n`);
  await writeFile(new URL('relatorio.md', pasta), relatorio);
  await writeFile(new URL('relatorio-pr.md', pasta), relatorioPr);
  return { proposta, relatorio, comparacao };
}

// Linha de comando (fina: a lógica acima é que tem teste).
/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const data = lerData(process.argv);
    const pasta = new URL(`coleta/${data}/`, RAIZ);
    const { proposta, comparacao: c } = await propor({ pasta, pastaDados: new URL('dados/', RAIZ) });
    console.log(`Relatório: coleta/${data}/relatorio.md`);
    console.log(`${c.novas.length} nova(s), ${c.alteradas.length} alterada(s), ${c.encerradas.length} encerrada(s), ${c.suspeitas.length} suspeita(s).`);
    if (proposta.erros_de_validacao.length > 0) {
      console.log('A proposta tem erro de validação (veja o fim do relatório) e não pode ser aprovada.');
    } else {
      console.log(`Depois de revisar, aprove com: node scripts/aprovar-mudancas.js --data ${data} --codigo ${proposta.codigo}`);
    }
  } catch (falha) {
    console.error(falha.message);
    process.exit(1);
  }
}
/* node:coverage enable */
