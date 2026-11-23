// Codificador PNG mínimo (sem dependência): RGB ou RGBA, 8 bits, sem filtro.
// Serve para gravar os ícones do app. O ícone da App Store não pode ter canal
// alfa, por isso existe a opção RGB.

import { deflateSync } from 'node:zlib';

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const tipoEDados = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tipoEDados));
  return Buffer.concat([tamanho, tipoEDados, crc]);
}

/**
 * @param {number} largura
 * @param {number} altura
 * @param {Uint8Array|number[]} rgba  pixels RGBA, linha a linha (como getImageData)
 * @param {{ alfa?: boolean }} opcoes  alfa: false grava só RGB (o alfa é descartado)
 * @returns {Buffer}
 */
export function codificarPng(largura, altura, rgba, { alfa = true } = {}) {
  if (rgba.length !== largura * altura * 4) throw new Error('tamanho dos pixels não bate com largura × altura');
  const canais = alfa ? 4 : 3;
  const linha = largura * canais + 1;
  const cru = Buffer.alloc(linha * altura);
  for (let y = 0; y < altura; y++) {
    cru[y * linha] = 0; // filtro "nenhum"
    for (let x = 0; x < largura; x++) {
      const de = (y * largura + x) * 4;
      const para = y * linha + 1 + x * canais;
      for (let c = 0; c < canais; c++) cru[para + c] = rgba[de + c];
    }
  }
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8;
  cabecalho[9] = alfa ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', cabecalho),
    bloco('IDAT', deflateSync(cru, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

/** Lê largura, altura e tipo de cor do cabeçalho de um PNG. */
export function lerCabecalhoPng(buffer) {
  if (buffer.readUInt32BE(12) !== 0x49484452) throw new Error('não é PNG');
  return { largura: buffer.readUInt32BE(16), altura: buffer.readUInt32BE(20), tipoDeCor: buffer[25] };
}
