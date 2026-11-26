// Confere a resposta do modelo ANTES de ela ir para a tela. É a última trava
// contra injeção de prompt e contra invenção: mesmo que alguém convença o
// modelo, a resposta só passa se:
//   - não tiver link, e-mail, HTML, código ou Markdown;
//   - não vazar as regras (marca de controle);
//   - todo número estiver nos fatos que o motor calculou;
//   - não citar loja, programa ou cartão que ficou fora do resultado;
//   - couber no tamanho máximo.
// Se não passar, a pessoa vê um recado fixo, escrito por nós.

import { LIMITES } from './config.js';
import { normalizarNome, numerosDe } from './fatos.js';
import { MARCA_DE_CONTROLE } from './prompt.js';

export const RECUSA_FIXA = 'Só consigo explicar o resultado desta conta.';

const PROIBIDOS = [
  ['link', /https?:|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|app|br|xyz|site|info|ly|me)\b/i],
  ['email', /[^\s@]+@[^\s@]+/],
  ['html', /<\s*\/?\s*[a-z!?]|&[a-z]+;|&#\d+;/i],
  ['codigo', /```|`|\bjavascript:|\bon[a-z]+\s*=|\bscript\b/i],
  ['markdown', /\*\*|__|^\s*#|\[[^\]]*\]\([^)]*\)/m],
  ['dado_pessoal', /\b(cpf|senha|c[oó]digo de seguran[cç]a|cvv)\b/i],
];

/** Tira o que é só enfeite e não muda o sentido: espaços sobrando. */
function arrumar(texto) {
  return texto.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * @param {string} texto   o texto devolvido pelo modelo
 * @param {{ numeros: Set<string>, nomesDeFora: string[] }} fatos  de montarFatos
 * @returns {{ ok: true, texto: string } | { ok: false, motivo: string, detalhe?: string }}
 */
export function conferirResposta(texto, { numeros, nomesDeFora }) {
  if (typeof texto !== 'string' || !texto.trim()) return { ok: false, motivo: 'vazia' };
  const limpo = arrumar(texto.normalize('NFKC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, ''));
  if (limpo.length > LIMITES.resposta) return { ok: false, motivo: 'grande' };
  if (limpo.includes(MARCA_DE_CONTROLE) || /MDV-REGRA/i.test(limpo)) return { ok: false, motivo: 'vazou_regras' };
  for (const [motivo, padrao] of PROIBIDOS) {
    const m = padrao.exec(limpo);
    if (m) return { ok: false, motivo, detalhe: m[0] };
  }
  for (const n of numerosDe(limpo)) {
    if (!numeros.has(n)) return { ok: false, motivo: 'numero_fora_dos_fatos', detalhe: n };
  }
  const normal = normalizarNome(limpo);
  for (const nome of nomesDeFora) {
    if (new RegExp(`(^|[^a-z0-9])${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(normal)) {
      return { ok: false, motivo: 'nome_fora_do_resultado', detalhe: nome };
    }
  }
  return { ok: true, texto: limpo };
}

/** Quebra a resposta em parágrafos e itens para a tela montar com textContent. */
export function emBlocos(texto) {
  const blocos = [];
  for (const linha of texto.split('\n')) {
    const t = linha.trim();
    if (!t) continue;
    const item = /^[-•]\s+(.*)$/.exec(t);
    if (item) {
      const ultimo = blocos[blocos.length - 1];
      if (ultimo?.tipo === 'lista') ultimo.itens.push(item[1]);
      else blocos.push({ tipo: 'lista', itens: [item[1]] });
    } else {
      blocos.push({ tipo: 'paragrafo', texto: t });
    }
  }
  return blocos;
}
