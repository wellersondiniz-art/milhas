#!/usr/bin/env node
// Etapa 2 do fluxo semanal: manda o texto de cada página coletada ao modelo,
// que só copia texto para campos, e confere cada valor contra a página
// (scripts/atualizacao/extracao.js). Nada aqui mexe em dados/.
//
// Uso:
//   ANTHROPIC_API_KEY=... node scripts/extrair.js [--data AAAA-MM-DD]
//   node scripts/extrair.js --data AAAA-MM-DD --resposta-gravada <pasta>
//     (usa respostas já gravadas, <pasta>/<id-da-fonte>.json, sem chamar a API)
// Saída: coleta/AAAA-MM-DD/<id>.resposta.json e coleta/AAAA-MM-DD/extracao.json.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { lerData, lerJson } from './coletar.js';
import { MODELO_PADRAO, chamarModelo, converterExtracao, lerResposta } from './atualizacao/extracao.js';

const RAIZ = new URL('../', import.meta.url);

// Preço do Claude Haiku 5.5 (US$ por milhão de tokens, prompts até 100 mil tokens).
const PRECO = { entrada: 0.10, saida: 0.50 };

/**
 * Extrai as ofertas de todas as páginas coletadas em `pasta`.
 * `obterResposta(fonte, texto)` devolve { resposta, bruta }; nos testes e na
 * demonstração ela lê uma resposta gravada em vez de chamar a API.
 */
export async function extrair({ pasta, cartoes, obterResposta, modelo = MODELO_PADRAO }) {
  const coleta = await lerJson(new URL('coleta.json', pasta));
  const saida = { data: coleta.data, modelo, fontes: [], uso: { entrada: 0, saida: 0 } };
  for (const item of coleta.fontes) {
    const registro = { id: item.id, url: item.url, programa_id: item.programa_id, loja_id: item.loja_id };
    if (item.erro) {
      saida.fontes.push({ ...registro, erro: item.erro });
      continue;
    }
    const texto = await readFile(new URL(item.arquivo, pasta), 'utf8');
    try {
      const { resposta, bruta } = await obterResposta(item, texto);
      await writeFile(new URL(`${item.id}.resposta.json`, pasta), `${JSON.stringify(bruta, null, 2)}\n`);
      saida.uso.entrada += bruta?.usage?.input_tokens ?? 0;
      saida.uso.saida += bruta?.usage?.output_tokens ?? 0;
      const convertido = converterExtracao({ resposta, fonte: item, texto, cartoes, data: coleta.data });
      saida.fontes.push({ ...registro, ...convertido });
    } catch (falha) {
      saida.fontes.push({ ...registro, erro: `extração falhou: ${falha.message}` });
    }
  }
  await writeFile(new URL('extracao.json', pasta), `${JSON.stringify(saida, null, 2)}\n`);
  return saida;
}

/** obterResposta que lê <pasta>/<id>.json (resposta da API já gravada). */
export function respostaGravada(pastaGravada) {
  return async (fonte) => {
    const bruta = await lerJson(new URL(`${fonte.id}.json`, pastaGravada));
    return { resposta: lerResposta(bruta), bruta };
  };
}

export function custoEmDolares(uso) {
  return (uso.entrada * PRECO.entrada + uso.saida * PRECO.saida) / 1_000_000;
}

// Linha de comando (fina: a lógica acima é que tem teste).
/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv;
    const data = lerData(argv);
    const pasta = new URL(`coleta/${data}/`, RAIZ);
    const cartoes = await lerJson(new URL('dados/cartoes.json', RAIZ));
    const i = argv.indexOf('--resposta-gravada');
    const modelo = process.env.MODELO_EXTRACAO || MODELO_PADRAO;
    const obterResposta = i >= 0
      ? respostaGravada(pathToFileURL(`${resolve(argv[i + 1])}/`))
      : (fonte, texto) => chamarModelo({ texto, fonte, chave: process.env.ANTHROPIC_API_KEY, modelo });
    if (i < 0 && !process.env.ANTHROPIC_API_KEY) {
      throw new Error('Defina ANTHROPIC_API_KEY no ambiente (nunca no repositório), ou use --resposta-gravada <pasta>.');
    }
    const saida = await extrair({ pasta, cartoes, obterResposta, modelo });
    for (const f of saida.fontes) {
      console.log(f.erro ? `- ${f.id}: ${f.erro}` : `- ${f.id}: ${f.ofertas.length} oferta(s), ${f.problemas.length} campo(s) recusado(s)`);
    }
    if (i < 0) console.log(`Tokens: ${saida.uso.entrada} de entrada, ${saida.uso.saida} de saída (cerca de US$ ${custoEmDolares(saida.uso).toFixed(4)}).`);
    console.log(`\nPróximo passo: node scripts/propor-mudancas.js --data ${data}`);
  } catch (falha) {
    console.error(falha.message);
    process.exit(1);
  }
}
/* node:coverage enable */
