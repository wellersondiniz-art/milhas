#!/usr/bin/env node
// Gera as páginas estáticas a partir de dados/*.json:
//   site/loja/<id>/index.html   uma por loja
//   site/ofertas/index.html     ofertas ativas hoje
//   site/como-funciona/, sobre-os-dados/, privacidade/, termos/, contato/
//                               páginas institucionais (scripts/paginas/institucionais.js)
//   site/sitemap.xml            só quando a URL base do site estiver definida
//   site/robots.txt
//
// Sem dependências. Os dados passam antes pelo validador; com erro, nada é escrito.
// As pastas geradas (loja/, ofertas/ e as institucionais) são apagadas e refeitas a cada execução
// (são geradas e ficam fora do Git, como site/dados/).
//
// Uso:
//   node scripts/gerar-paginas.js [--hoje AAAA-MM-DD] [--url-base https://...] [--saida pasta]
// A URL base também pode vir de URL_DO_SITE. Sem ela, vale scripts/paginas/config.js.

import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ARQUIVOS, hojeEmBrasilia, validarDados } from './validar-dados.js';
import { URL_BASE } from './paginas/config.js';
import { conferirHtml, lerDescricao, lerTitulo } from './paginas/conferir-html.js';
import { gerarPaginas } from './paginas/montar.js';
import { PASTAS_INSTITUCIONAIS } from './paginas/institucionais.js';

const RAIZ = new URL('../', import.meta.url);

export async function lerDados(pasta) {
  const dados = {};
  for (const nome of ARQUIVOS) dados[nome] = JSON.parse(await readFile(new URL(`${nome}.json`, pasta), 'utf8'));
  return dados;
}

/** Valida, monta e grava. Devolve a lista de arquivos escritos e os avisos. */
export async function gerarNoDisco({ pastaDados, saida, hoje, urlBase }) {
  const { erros } = await validarDados(pastaDados, { hoje });
  if (erros.length) {
    const lista = erros.map((e) => `- ${e}`).join('\n');
    throw new Error(`Dados inválidos; nenhuma página foi gerada:\n${lista}`);
  }
  const dados = await lerDados(pastaDados);
  const resultado = gerarPaginas(dados, { hoje, urlBase });
  const problemas = conferirPaginas(resultado.arquivos);
  if (problemas.length) throw new Error(`HTML gerado com problema; nada foi gravado:\n${problemas.map((p) => `- ${p}`).join('\n')}`);

  await rm(new URL('loja/', saida), { recursive: true, force: true });
  await rm(new URL('ofertas/', saida), { recursive: true, force: true });
  for (const pasta of PASTAS_INSTITUCIONAIS) await rm(new URL(`${pasta}/`, saida), { recursive: true, force: true });
  await rm(new URL('plano/', saida), { recursive: true, force: true });
  await rm(new URL('sitemap.xml', saida), { force: true });
  for (const { caminho, conteudo } of resultado.arquivos) {
    const destino = new URL(caminho, saida);
    await mkdir(new URL('./', destino), { recursive: true });
    await writeFile(destino, conteudo, 'utf8');
  }
  const quebrados = await linksQuebrados(resultado.arquivos, saida);
  if (quebrados.length) throw new Error(`Links internos quebrados:\n${quebrados.map((p) => `- ${p}`).join('\n')}`);
  return resultado;
}

/** Cada HTML passa pela conferência; título e descrição não podem se repetir. */
export function conferirPaginas(arquivos) {
  const problemas = [];
  const vistos = { titulo: new Map(), descricao: new Map() };
  for (const { caminho, conteudo } of arquivos) {
    if (!caminho.endsWith('.html')) continue;
    for (const p of conferirHtml(conteudo)) problemas.push(`${caminho}: ${p}`);
    for (const [tipo, valor] of [['titulo', lerTitulo(conteudo)], ['descricao', lerDescricao(conteudo)]]) {
      if (vistos[tipo].has(valor)) problemas.push(`${caminho}: ${tipo} igual ao de ${vistos[tipo].get(valor)}`);
      vistos[tipo].set(valor, caminho);
    }
  }
  return problemas;
}

/** Links relativos (href) que não levam a um arquivo que existe em `saida`. */
export async function linksQuebrados(arquivos, saida) {
  const quebrados = [];
  for (const { caminho, conteudo } of arquivos) {
    if (!caminho.endsWith('.html')) continue;
    for (const [, href] of conteudo.matchAll(/href="([^"]*)"/g)) {
      if (/^(https?:|#|mailto:)/.test(href)) continue;
      const alvo = new URL(href.replace(/&amp;/g, '&'), new URL(caminho, saida));
      alvo.search = '';
      alvo.hash = '';
      const arquivo = alvo.pathname.endsWith('/') ? new URL('index.html', alvo) : alvo;
      try { await access(arquivo); } catch { quebrados.push(`${caminho} → ${href}`); }
    }
  }
  return quebrados;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      hoje: { type: 'string' },
      'url-base': { type: 'string' },
      saida: { type: 'string' },
    },
  });
  const hoje = values.hoje ?? hojeEmBrasilia();
  const urlBase = values['url-base'] ?? process.env.URL_DO_SITE ?? URL_BASE;
  const saida = values.saida ? new URL(`${values.saida.replace(/\/?$/, '/')}`, `file://${process.cwd()}/`) : new URL('site/', RAIZ);
  try {
    const { arquivos, resumo, avisos } = await gerarNoDisco({ pastaDados: new URL('dados/', RAIZ), saida, hoje, urlBase });
    for (const aviso of avisos) console.log(`Aviso: ${aviso}`);
    console.log(`Páginas geradas em ${fileURLToPath(saida)} (hoje = ${hoje}):`);
    for (const { caminho } of arquivos) console.log(`  ${caminho}`);
    console.log(`${arquivos.length} arquivos. Ofertas ativas hoje: ${resumo.ofertas.ofertasAtivas} em ${resumo.ofertas.lojasComOferta} loja(s).`);
  } catch (erro) {
    console.error(erro.message);
    process.exit(1);
  }
}
