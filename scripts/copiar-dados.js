#!/usr/bin/env node
// Copia os dados (dados/*.json) para site/dados/, que é a pasta publicada.
// A fonte da verdade continua sendo dados/; site/dados/ é gerada e fica fora do Git.
//
// Uso: node scripts/copiar-dados.js
// Na Cloudflare Pages: comando de build "node scripts/copiar-dados.js",
// pasta de saída "site".

import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const ARQUIVOS = [
  'programas.json', 'cartoes.json', 'lojas.json', 'ofertas.json', 'cambio.json', 'links.json', 'redes-postos.json', 'regras-postos.json',
  'cotacoes.json', 'transferencias.json', 'bonus-transferencia.json', 'viagens.json',
  'salas-vip.json',
];

export async function copiarDados(origem, destino) {
  await mkdir(destino, { recursive: true });
  for (const nome of ARQUIVOS) await copyFile(new URL(nome, origem), new URL(nome, destino));
  return ARQUIVOS.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raiz = new URL('../', import.meta.url);
  const n = await copiarDados(new URL('dados/', raiz), new URL('site/dados/', raiz));
  console.log(`${n} arquivos copiados de dados/ para site/dados/.`);
}
