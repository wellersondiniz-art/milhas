#!/usr/bin/env node
// Gera site/sw.js a partir de scripts/pwa/sw-modelo.js.
//
// Preenche a lista de arquivos do app (o "shell", que funciona sem internet) e
// a versão, que é um resumo SHA-256 do conteúdo desses arquivos. Assim a
// versão muda sozinha quando qualquer arquivo do app muda, e ninguém precisa
// lembrar de trocar um número.
//
// Uso: node scripts/gerar-sw.js   (já faz parte de npm run build)

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const RAIZ = new URL('../', import.meta.url);

/** Arquivos fixos do app, além de tudo em js/ e img/icones/. */
const FIXOS = ['index.html', 'offline.html', 'manifest.webmanifest', 'css/base.css', 'css/estilo.css', 'css/paginas.css'];
/** Fora do app: a vitrine de estilo é só para quem desenvolve. */
const FORA = new Set(['js/vitrine.js']);

async function listarPasta(site, pasta) {
  const itens = await readdir(new URL(pasta, site), { withFileTypes: true, recursive: true });
  return itens
    .filter((i) => i.isFile())
    .map((i) => {
      const dentro = fileURLToPath(new URL(pasta, site));
      const completo = `${i.parentPath ?? i.path}/${i.name}`;
      return `${pasta}${completo.slice(dentro.length).replace(/^\/+/, '')}`;
    });
}

/**
 * Lista dos arquivos do app, em ordem, relativa a site/.
 * cssEmbutido: em dist/ o CSS vai dentro das páginas e os .css não existem.
 */
export async function listarArquivosDoApp(site, { cssEmbutido = false } = {}) {
  const fixos = cssEmbutido ? FIXOS.filter((a) => !a.endsWith('.css')) : FIXOS;
  const js = (await listarPasta(site, 'js/')).filter((a) => a.endsWith('.js') && !FORA.has(a));
  // Os ícones de 512 px só servem na hora de instalar, e quem baixa é o
  // navegador. Guardar no aparelho custaria ~50 KB na primeira visita.
  const icones = (await listarPasta(site, 'img/icones/')).filter((a) => /\.(png|svg)$/.test(a) && !/-512\.png$/.test(a));
  return [...fixos, ...js.sort(), ...icones.sort()];
}

/** Versão = 12 primeiros caracteres do SHA-256 de (caminho + conteúdo) de cada arquivo. */
export async function calcularVersao(site, arquivos) {
  const resumo = createHash('sha256');
  for (const arquivo of arquivos) {
    resumo.update(`${arquivo}\0`);
    resumo.update(await readFile(new URL(arquivo, site)));
    resumo.update('\0');
  }
  return resumo.digest('hex').slice(0, 12);
}

export function montarSw(modelo, { versao, arquivos }) {
  if (!/^[0-9a-f]{12}$/.test(versao)) throw new Error(`versão inválida: ${versao}`);
  const marcas = ["const VERSAO = '__VERSAO__';", 'const ARQUIVOS_DO_APP = __ARQUIVOS_DO_APP__;'];
  for (const marca of marcas) if (modelo.split(marca).length !== 2) throw new Error(`o modelo precisa ter "${marca}" uma vez`);
  return modelo
    .replace(marcas[0], `const VERSAO = '${versao}';`)
    .replace(marcas[1], `const ARQUIVOS_DO_APP = ${JSON.stringify(arquivos, null, 2)};`);
}

export async function gerarSw(site = new URL('site/', RAIZ), opcoes = {}) {
  const arquivos = await listarArquivosDoApp(site, opcoes);
  const versao = await calcularVersao(site, arquivos);
  const modelo = await readFile(new URL('scripts/pwa/sw-modelo.js', RAIZ), 'utf8');
  await writeFile(new URL('sw.js', site), montarSw(modelo, { versao, arquivos }), 'utf8');
  return { versao, arquivos };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { versao, arquivos } = await gerarSw();
  console.log(`site/sw.js gerado: versão ${versao}, ${arquivos.length} arquivos no app.`);
}
