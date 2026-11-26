#!/usr/bin/env node
// Demonstração do fluxo semanal, de ponta a ponta, sem internet e sem chave:
// - as duas páginas são FICTÍCIAS (testes/atualizacao/*.html);
// - a "resposta do modelo" foi ESCRITA À MÃO no formato da API
//   (testes/atualizacao/respostas-gravadas/), com dois erros de propósito;
// - tudo roda numa cópia temporária do projeto: dados/ de verdade não muda;
// - na aprovação, os comandos git/gh são só registrados, não executados.
//
// Uso: node testes/atualizacao/demo.mjs [pasta-de-saida]
// (copia relatorio.md, relatorio-pr.md e proposta.json para a pasta de saída)

import { cp, mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { carregarFontes, coletar } from '../../scripts/coletar.js';
import { extrair, respostaGravada } from '../../scripts/extrair.js';
import { propor } from '../../scripts/propor-mudancas.js';
import { aprovar } from '../../scripts/aprovar-mudancas.js';

const AQUI = new URL('./', import.meta.url);
const RAIZ_REAL = new URL('../../', import.meta.url);
export const DATA = '2026-11-25'; // dia da última conferência de dados/ (o validador recusa data no futuro)
export const OFERTAS_EXEMPLO = new URL('../exemplos/ofertas-exemplo.json', import.meta.url);

export const FONTES = [
  {
    id: 'azul-magalu',
    url: 'https://www.voeazul.com.br/br/pt/programa-fidelidade/parceiros/magalu-exemplo',
    programa_id: 'azul-fidelidade',
    loja_id: 'magalu',
    cadastrado_em: DATA,
    observacoes: 'Fonte fictícia da demonstração.',
  },
  {
    id: 'livelo-amazon',
    url: 'https://www.livelo.com.br/parceiros/amazon-exemplo',
    programa_id: 'livelo',
    loja_id: 'amazon',
    cadastrado_em: DATA,
    observacoes: 'Fonte fictícia da demonstração.',
  },
];

/** fetch falso: devolve as páginas fictícias. */
async function buscarFalso(url) {
  const fonte = FONTES.find((f) => f.url === url);
  if (!fonte) return new Response('não encontrada', { status: 404, headers: { 'content-type': 'text/plain' } });
  const html = await readFile(new URL(`${fonte.id}.html`, AQUI), 'utf8');
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** Roda coletar → extrair → propor → aprovar numa cópia temporária. */
export async function rodarDemo() {
  const tmp = await mkdtemp(join(tmpdir(), 'fluxo-semanal-'));
  const raiz = pathToFileURL(`${tmp}/`);
  await cp(fileURLToPath(new URL('dados/', RAIZ_REAL)), join(tmp, 'dados'), { recursive: true });
  await writeFile(join(tmp, 'dados', 'fontes.json'), `${JSON.stringify(FONTES, null, 2)}\n`);
  // A base de produção não tem mais a oferta de exemplo: a demonstração usa a
  // cópia que ficou em testes/exemplos/ (ela vira a oferta "encerrada").
  await cp(fileURLToPath(OFERTAS_EXEMPLO), join(tmp, 'dados', 'ofertas.json'));
  const ofertasAntes = await readFile(join(tmp, 'dados', 'ofertas.json'), 'utf8');

  const pasta = new URL(`coleta/${DATA}/`, raiz);
  const fontes = await carregarFontes(raiz);
  const coleta = await coletar({ fontes, pasta, data: DATA, buscar: buscarFalso, pausaMs: 0 });

  const cartoes = JSON.parse(await readFile(join(tmp, 'dados', 'cartoes.json'), 'utf8'));
  const extracao = await extrair({ pasta, cartoes, obterResposta: respostaGravada(new URL('respostas-gravadas/', AQUI)) });

  const { proposta, relatorio, comparacao } = await propor({
    pasta,
    pastaDados: new URL('dados/', raiz),
    aviso: 'DEMONSTRAÇÃO: páginas fictícias e resposta do modelo escrita à mão (sem chamar a API). Nada disso entra em dados/.',
  });
  const ofertasDepoisDoRelatorio = await readFile(join(tmp, 'dados', 'ofertas.json'), 'utf8');

  const comandos = [];
  const executarFalso = (comando, args) => {
    comandos.push([comando, ...args].join(' '));
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse') return 'main';
    if (comando === 'gh') return '(PR simulado: nenhum comando foi executado)';
    return '';
  };
  const mensagens = [];
  let recusa = null;
  try {
    await aprovar({ raiz, data: DATA, codigo: 'codigo-errado', executar: executarFalso, log: (m) => mensagens.push(m) });
  } catch (falha) {
    recusa = falha.message;
  }
  const comandosAntesDaAprovacao = comandos.length;
  await aprovar({ raiz, data: DATA, codigo: proposta.codigo, executar: executarFalso, log: (m) => mensagens.push(m) });
  const ofertasAprovadas = JSON.parse(await readFile(join(tmp, 'dados', 'ofertas.json'), 'utf8'));

  return {
    tmp, pasta, coleta, extracao, proposta, relatorio, comparacao, comandos, mensagens, recusa,
    comandosAntesDaAprovacao, ofertasAprovadas,
    ofertasMudaramAntesDaAprovacao: ofertasAntes !== ofertasDepoisDoRelatorio,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await rodarDemo();
  const destino = process.argv[2] ? resolve(process.argv[2]) : null;
  if (destino) {
    await mkdir(destino, { recursive: true });
    for (const nome of ['relatorio.md', 'relatorio-pr.md', 'proposta.json', 'extracao.json']) {
      await cp(fileURLToPath(new URL(nome, r.pasta)), join(destino, nome));
    }
    await cp(fileURLToPath(new URL('azul-magalu.txt', r.pasta)), join(destino, 'azul-magalu.txt'));
  }
  console.log(r.relatorio);
  console.log('---');
  console.log(`Aprovação com código errado: ${r.recusa}`);
  console.log('Comandos que a aprovação rodaria (simulados):');
  for (const c of r.comandos) console.log(`  ${c}`);
}
