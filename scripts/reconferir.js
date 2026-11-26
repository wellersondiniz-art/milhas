#!/usr/bin/env node
// Lista o que precisa ser reconferido nesta semana, em ordem de importância
// (lojas mais importantes primeiro). Só lê dados/: não grava nada.
// Regras em scripts/reconferencia/lista.js.
//
// Uso: node scripts/reconferir.js [--hoje AAAA-MM-DD] [--json]
// Sem --hoje, vale a data de hoje no horário de Brasília.

import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { lerDados } from './gerar-paginas.js';
import { dataValida, hojeEmBrasilia } from './validar-dados.js';
import { listarReconferencia } from './reconferencia/lista.js';
import { textoDaReconferencia } from './reconferencia/texto.js';

/** Devolve o texto (ou JSON) da lista. Lança erro se a data for inválida. */
export async function reconferir({ pastaDados, hoje, json = false }) {
  if (!dataValida(hoje)) throw new Error(`data inválida: ${hoje} (use AAAA-MM-DD)`);
  const lista = listarReconferencia(await lerDados(pastaDados), hoje);
  return json ? `${JSON.stringify(lista, null, 2)}\n` : textoDaReconferencia(lista);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { hoje: { type: 'string' }, json: { type: 'boolean' } } });
    process.stdout.write(await reconferir({
      pastaDados: new URL('../dados/', import.meta.url),
      hoje: values.hoje ?? hojeEmBrasilia(),
      json: values.json,
    }));
  } catch (erro) {
    console.error(erro.message);
    process.exit(1);
  }
}
