// Funções puras de texto usadas no fluxo semanal de ofertas.
// Sem dependências: transformam o HTML de uma página em texto simples e
// conferem se um trecho citado pelo modelo existe de fato nesse texto.

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', eacute: 'é', ecirc: 'ê',
  iacute: 'í', oacute: 'ó', ocirc: 'ô', otilde: 'õ', uacute: 'ú', ccedil: 'ç',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã', Eacute: 'É', Ecirc: 'Ê',
  Iacute: 'Í', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Uacute: 'Ú', Ccedil: 'Ç',
  ordf: 'ª', ordm: 'º', deg: '°', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bull: '•',
};

/** Troca entidades HTML (&amp;, &#233;, &#xE9;) pelos caracteres. */
export function decodificarEntidades(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (inteira, nome) => {
    if (nome[0] === '#') {
      const codigo = nome[1] === 'x' || nome[1] === 'X' ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : inteira;
    }
    return ENTIDADES[nome] ?? inteira;
  });
}

/**
 * Transforma HTML em texto simples, uma linha por bloco.
 * Tira script, style, svg e comentários. Os links ficam no texto como
 * "texto [link: https://...]", para que o modelo possa citar o link da oferta
 * e a conferência encontre o endereço no texto.
 */
export function htmlParaTexto(html) {
  let t = String(html);
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  t = t.replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(https:\/\/[^"']+)\1[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_, _aspas, href, dentro) => `${dentro} [link: ${decodificarEntidades(href)}]`);
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/?(p|div|li|ul|ol|tr|table|section|article|header|footer|main|nav|aside|h[1-6]|dt|dd|dl|blockquote|pre|form|fieldset|caption|figure|figcaption)\b[^>]*>/gi, '\n');
  t = t.replace(/<\/(td|th)\s*>/gi, ' | ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = decodificarEntidades(t);
  return t
    .split('\n')
    .map((linha) => linha.replace(/[ \t ]+/g, ' ').trim())
    .filter((linha) => linha.length > 0)
    .join('\n');
}

/** Minúsculas, sem acento e com espaços colapsados: para comparar textos. */
export function normalizar(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** true se o trecho (não vazio) aparece no texto, ignorando acento, caixa e espaços. */
export function contemTrecho(texto, trecho) {
  const t = normalizar(trecho);
  return t.length > 0 && normalizar(texto).includes(t);
}

/**
 * Lê um número escrito como no Brasil ("10", "2,5", "1.500") ou com ponto
 * decimal ("2.5"). Devolve null se o texto não for só um número.
 */
export function lerNumero(valor) {
  const v = String(valor).trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(v)) return Number(v.replace(/\./g, ''));
  if (/^\d+(,\d+)?$/.test(v)) return Number(v.replace(',', '.'));
  if (/^\d+\.\d+$/.test(v)) return Number(v);
  return null;
}

/** Todos os números que aparecem num texto, lidos com lerNumero. */
export function numerosNoTexto(texto) {
  const achados = String(texto).match(/\d{1,3}(?:\.\d{3})+(?!\d)|\d+(?:[.,]\d+)?/g) ?? [];
  return achados.map(lerNumero).filter((n) => n !== null);
}

const MESES = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function dataIso(ano, mes, dia) {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Lê uma data escrita como na página: "14/11/2026", "14/11/26",
 * "14 de novembro de 2026" ou "2026-11-14". Sem ano escrito, devolve null:
 * o ano não é adivinhado.
 */
export function lerData(valor) {
  const v = normalizar(valor);
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return dataIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return dataIso(ano, Number(m[2]), Number(m[1]));
  }
  m = v.match(/^(\d{1,2})(?:º|o)? de ([a-z]+) de (\d{4})$/);
  if (m && MESES[m[2]]) return dataIso(Number(m[3]), MESES[m[2]], Number(m[1]));
  return null;
}
