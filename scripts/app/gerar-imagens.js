#!/usr/bin/env node
// Gera os ícones e as telas de abertura do app (Android e iOS) a partir dos
// ícones do site (site/img/icones/*.svg), no estilo Cofrinho.
//
// Usa o Chromium do Playwright (já é ferramenta de teste do projeto) para
// desenhar o SVG num <canvas> e grava o PNG com scripts/app/png.js.
// Os arquivos gerados entram no Git: só rode de novo quando o ícone mudar.
//
// Uso: npm run app:imagens

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codificarPng } from './png.js';

const RAIZ = new URL('../../', import.meta.url);
const RES = 'app/android/app/src/main/res';
const IOS = 'app/ios/App/App/Assets.xcassets';

export const CORES = { fundo: '#fbf6ec', verde: '#1f6b3a' };

// Densidades do Android: ícone de 48 dp e camada da frente de 108 dp.
const DENSIDADES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const ABERTURA_RETRATO = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };

/** Lista de tudo o que é gerado: caminho, tamanho, desenho e se tem transparência. */
export function listaDeImagens() {
  const lista = [];
  for (const [nome, fator] of Object.entries(DENSIDADES)) {
    const icone = Math.round(48 * fator);
    const frente = Math.round(108 * fator);
    lista.push({ caminho: `${RES}/mipmap-${nome}/ic_launcher.png`, largura: icone, altura: icone, desenho: 'arredondado', alfa: true });
    lista.push({ caminho: `${RES}/mipmap-${nome}/ic_launcher_round.png`, largura: icone, altura: icone, desenho: 'redondo', alfa: true });
    lista.push({ caminho: `${RES}/mipmap-${nome}/ic_launcher_foreground.png`, largura: frente, altura: frente, desenho: 'frente', alfa: true });
    const [l, a] = ABERTURA_RETRATO[nome];
    lista.push({ caminho: `${RES}/drawable-port-${nome}/splash.png`, largura: l, altura: a, desenho: 'abertura', alfa: false });
    lista.push({ caminho: `${RES}/drawable-land-${nome}/splash.png`, largura: a, altura: l, desenho: 'abertura', alfa: false });
  }
  lista.push({ caminho: `${RES}/drawable/splash.png`, largura: 480, altura: 320, desenho: 'abertura', alfa: false });
  // App Store: 1024 × 1024 sem transparência (a Apple recusa ícone com canal alfa).
  lista.push({ caminho: `${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`, largura: 1024, altura: 1024, desenho: 'cheio', alfa: false });
  for (const sufixo of ['', '-1', '-2']) {
    lista.push({ caminho: `${IOS}/Splash.imageset/splash-2732x2732${sufixo}.png`, largura: 2732, altura: 2732, desenho: 'abertura', alfa: false });
  }
  return lista;
}

/** A moeda sem o quadrado verde: camada da frente do ícone adaptável do Android. */
export function svgDaFrente(svgMascaravel) {
  const semFundo = svgMascaravel.replace(/<rect[^>]*\/>\s*/, '');
  if (semFundo === svgMascaravel) throw new Error('o ícone mascarável mudou: não achei o <rect> do fundo');
  return semFundo;
}

// Roda dentro da página: desenha e devolve os pixels RGBA.
async function desenharNaPagina({ largura, altura, desenho, svgs, cores }) {
  const carregar = (svg) => new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = falha;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  if (desenho === 'abertura') {
    ctx.fillStyle = cores.fundo;
    ctx.fillRect(0, 0, largura, altura);
    const lado = Math.round(Math.min(largura, altura) * 0.3);
    ctx.drawImage(await carregar(svgs.arredondado), Math.round((largura - lado) / 2), Math.round((altura - lado) / 2), lado, lado);
  } else if (desenho === 'redondo') {
    ctx.beginPath();
    ctx.arc(largura / 2, altura / 2, largura / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(await carregar(svgs.cheio), 0, 0, largura, altura);
  } else {
    ctx.drawImage(await carregar(svgs[desenho]), 0, 0, largura, altura);
  }
  // Devolve em base64: passar milhões de números soltos para o Node é lento.
  const bytes = ctx.getImageData(0, 0, largura, altura).data;
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

export async function gerar() {
  const { chromium } = await import('@playwright/test');
  const ler = (c) => readFile(new URL(c, RAIZ), 'utf8');
  const mascaravel = await ler('site/img/icones/icone-maskable.svg');
  const svgs = { arredondado: await ler('site/img/icones/icone.svg'), cheio: mascaravel, frente: svgDaFrente(mascaravel) };
  const navegador = await chromium.launch();
  try {
    const pagina = await navegador.newPage();
    const prontos = new Map(); // mesma imagem em mais de um lugar (as três aberturas do iOS)
    for (const item of listaDeImagens()) {
      const chave = `${item.desenho}:${item.largura}x${item.altura}:${item.alfa}`;
      if (!prontos.has(chave)) {
        const pixels = Buffer.from(await pagina.evaluate(desenharNaPagina, { ...item, svgs, cores: CORES }), 'base64');
        prontos.set(chave, codificarPng(item.largura, item.altura, pixels, { alfa: item.alfa }));
      }
      const destino = fileURLToPath(new URL(item.caminho, RAIZ));
      await mkdir(dirname(destino), { recursive: true });
      await writeFile(destino, prontos.get(chave));
    }
  } finally {
    await navegador.close();
  }
  console.log(`${listaDeImagens().length} imagens do app geradas.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  gerar().catch((erro) => { console.error(erro); process.exit(1); });
}
