#!/usr/bin/env node
// Monta uma cópia do site com produtos e ofertas de DEMONSTRAÇÃO, para ver
// como a vitrine fica antes de ter credencial de API nenhuma.
//
// - Tudo vai para demo-produtos/ (fora do Git). site/, dados/ e .cache/ não mudam.
// - Os produtos (testes/produtos/demo/produtos.json) passam pela mesma
//   conferência dos produtos de verdade (normalizarProduto) e são marcados
//   como demonstração na página.
// - As ofertas de demonstração (testes/produtos/demo/ofertas.json) valem de
//   3 dias atrás até daqui a 10 dias, para sempre ter ponto para mostrar.
//
// Uso: npm run produtos:demo   (monta e abre o servidor em http://127.0.0.1:8081)

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ARQUIVOS } from '../copiar-dados.js';
import { gerarNoDisco } from '../gerar-paginas.js';
import { hojeEmBrasilia } from '../validar-dados.js';
import { normalizarProduto } from './normalizar.js';

const RAIZ = new URL('../../', import.meta.url);
const DIA_MS = 86_400_000;

function diaMais(hoje, dias) {
  return new Date(Date.parse(`${hoje}T12:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Ofertas de demonstração com as datas em volta de hoje. */
export function ofertasDeDemo(modelo, hoje) {
  return JSON.parse(JSON.stringify(modelo)
    .replaceAll('__INICIO__', diaMais(hoje, -3))
    .replaceAll('__FIM__', diaMais(hoje, 10))
    .replaceAll('__HOJE__', hoje));
}

/** Vitrine de demonstração: os produtos do arquivo, conferidos e carimbados com `agora`. */
export function vitrineDeDemo(modelo, lojas, agora) {
  const produtos = [];
  for (const d of modelo.produtos) {
    const loja = lojas.find((l) => l.id === d.loja_id);
    const r = normalizarProduto({ ...d, moeda: 'BRL', disponivel: true, vendido_pela_loja: null }, {
      loja,
      item: { id_na_loja: d.id_na_loja, categoria: d.categoria, vendido_pela_loja: d.vendido_pela_loja },
      api: 'demo',
      consultadoEm: agora,
      validadeHoras: 24,
      demo: true,
    });
    if (r.erro) throw new Error(`produto de demonstração inválido: ${r.erro}`);
    produtos.push(r);
  }
  return { gerada_em: agora, demo: true, produtos };
}

/** Monta a demonstração em `pasta` (URL de diretório). */
export async function montarDemo({ raiz = RAIZ, pasta, agora }) {
  const hoje = hojeEmBrasilia(new Date(agora));
  const lerJson = async (caminho) => JSON.parse(await readFile(new URL(caminho, raiz), 'utf8'));
  await rm(pasta, { recursive: true, force: true });
  await cp(new URL('site/', raiz), new URL('site/', pasta), { recursive: true });
  await cp(new URL('dados/', raiz), new URL('dados/', pasta), { recursive: true });

  const ofertas = [...await lerJson('dados/ofertas.json'), ...ofertasDeDemo(await lerJson('testes/produtos/demo/ofertas.json'), hoje)];
  await writeFile(new URL('dados/ofertas.json', pasta), `${JSON.stringify(ofertas, null, 2)}\n`);
  await mkdir(new URL('site/dados/', pasta), { recursive: true });
  for (const nome of ARQUIVOS) await cp(new URL(`dados/${nome}`, pasta), new URL(`site/dados/${nome}`, pasta));

  const vitrine = vitrineDeDemo(await lerJson('testes/produtos/demo/produtos.json'), await lerJson('dados/lojas.json'), agora);
  const resultado = await gerarNoDisco({ pastaDados: new URL('dados/', pasta), saida: new URL('site/', pasta), hoje, urlBase: null, vitrine, agora });
  return { vitrine, resultado, hoje };
}

/* node:coverage disable */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const pasta = new URL('demo-produtos/', RAIZ);
    const { vitrine, hoje } = await montarDemo({ pasta, agora: new Date().toISOString() });
    console.log(`Demonstração montada em ${fileURLToPath(pasta)}site (hoje = ${hoje}), com ${vitrine.produtos.length} produtos inventados.`);
    console.log('Abra: http://127.0.0.1:8081/onde-rende-mais/  e  http://127.0.0.1:8081/loja/amazon/');
  } catch (erro) {
    console.error(erro.message);
    process.exit(1);
  }
}
/* node:coverage enable */
