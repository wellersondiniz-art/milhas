// Minificação simples, sem dependência: tira comentários e espaços que não
// mudam nada. Não renomeia variável nem reescreve código (isso é coisa de
// bundler e foi deixado de fora de propósito, ver CLAUDE.md seção 2).
//
// Regras para ficar seguro:
//   JS:   texto entre aspas, template `...${}...` e expressão regular passam
//         intactos. Quebra de linha continua quebra de linha (não depende do
//         ponto e vírgula automático), só a indentação e as linhas vazias somem.
//   CSS:  tira comentários e junta espaços; texto entre aspas passa intacto.
//   HTML: tira comentários e indentação. Recusa <pre> e <textarea>, onde o
//         espaço faz parte do conteúdo.

const PALAVRA = /[A-Za-z0-9_$\u0080-￿]/;
// Depois destas palavras, "/" começa uma expressão regular, não uma divisão.
const ANTES_DE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

/** Minifica um módulo JavaScript. Lança erro se o texto terminar no meio de algo. */
export function minificarJs(codigo) {
  let saida = '';
  let i = 0;
  const n = codigo.length;
  // Pilha de chaves abertas dentro de ${ } de template: quando a chave que
  // fecha o ${ aparece, volta para dentro do template.
  const pilhaTemplate = [];
  let chaves = 0;
  let espacoPendente = '';

  const ultimo = () => saida[saida.length - 1] ?? '';

  function soltarEspaco(proximo) {
    if (!espacoPendente) return;
    const antes = ultimo();
    if (espacoPendente.includes('\n')) {
      if (saida && antes !== '\n') saida += '\n';
    } else if (precisaEspaco(antes, proximo)) {
      saida += ' ';
    }
    espacoPendente = '';
  }

  function precisaEspaco(antes, depois) {
    if (!antes) return false;
    if (PALAVRA.test(antes) && PALAVRA.test(depois)) return true;
    if ('+-'.includes(antes) && '+-'.includes(depois)) return true;
    if (antes === '/' || depois === '/') return true;
    if (/[0-9]/.test(antes) && depois === '.') return true;
    return false;
  }

  function lerTemplate() {
    // i está logo depois de ` (ou logo depois do } que fecha um ${ }).
    while (i < n) {
      const c = codigo[i];
      if (c === '\\') { saida += codigo.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { saida += c; i++; return; }
      if (c === '$' && codigo[i + 1] === '{') {
        saida += '${'; i += 2;
        pilhaTemplate.push(chaves);
        chaves = 0;
        return;
      }
      saida += c; i++;
    }
    throw new Error('template sem fim');
  }

  function regexPermitida() {
    const feito = saida.trimEnd();
    const antes = feito.slice(-1);
    if (!antes) return true;
    if (PALAVRA.test(antes)) return ANTES_DE_REGEX.has((/[A-Za-z_$][A-Za-z0-9_$]*$/.exec(feito) ?? [''])[0]);
    return !')]'.includes(antes);
  }

  while (i < n) {
    const c = codigo[i];
    const d = codigo[i + 1];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      espacoPendente += c === '\r' ? '' : c;
      i++;
      continue;
    }
    if (c === '/' && d === '/') {
      const fim = codigo.indexOf('\n', i);
      i = fim === -1 ? n : fim;
      continue;
    }
    if (c === '/' && d === '*') {
      const fim = codigo.indexOf('*/', i + 2);
      if (fim === -1) throw new Error('comentário sem fim');
      espacoPendente += codigo.slice(i, fim).includes('\n') ? '\n' : ' ';
      i = fim + 2;
      continue;
    }

    soltarEspaco(c);

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && codigo[j] !== c) {
        if (codigo[j] === '\\') j++;
        else if (codigo[j] === '\n') throw new Error('texto entre aspas sem fim');
        j++;
      }
      if (j >= n) throw new Error('texto entre aspas sem fim');
      saida += codigo.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '`') {
      saida += c; i++;
      lerTemplate();
      continue;
    }
    if (c === '/' && regexPermitida()) {
      let j = i + 1;
      let classe = false;
      while (j < n) {
        const r = codigo[j];
        if (r === '\\') { j += 2; continue; }
        if (r === '\n') throw new Error('expressão regular sem fim');
        if (r === '[') classe = true;
        else if (r === ']') classe = false;
        else if (r === '/' && !classe) break;
        j++;
      }
      if (j >= n) throw new Error('expressão regular sem fim');
      j++;
      while (j < n && /[a-z]/.test(codigo[j])) j++;
      saida += codigo.slice(i, j);
      i = j;
      continue;
    }
    if (c === '{') chaves++;
    if (c === '}') {
      if (chaves === 0 && pilhaTemplate.length) {
        chaves = pilhaTemplate.pop();
        saida += c; i++;
        lerTemplate();
        continue;
      }
      chaves--;
    }
    saida += c;
    i++;
  }
  if (pilhaTemplate.length) throw new Error('template sem fim');
  return saida.endsWith('\n') ? saida : `${saida}\n`;
}

/** Minifica CSS: sem comentários e com espaços juntados. */
export function minificarCss(css) {
  let saida = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const fim = css.indexOf('*/', i + 2);
      if (fim === -1) throw new Error('comentário de CSS sem fim');
      i = fim + 2;
      saida += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c) { if (css[j] === '\\') j++; j++; }
      if (j >= n) throw new Error('texto de CSS sem fim');
      saida += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    saida += /\s/.test(c) ? ' ' : c;
    i++;
  }
  // Só mexe em espaço fora de aspas: as aspas já foram copiadas, mas os
  // padrões abaixo não atravessam aspas porque só olham espaço e { } ; ,
  return protegerAspas(saida, (trecho) => trecho
    .replace(/ {2,}/g, ' ')
    .replace(/ ?([{};,]) ?/g, '$1')
    .replace(/;}/g, '}'))
    .trim();
}

/** Aplica fn só nos trechos fora de aspas. */
function protegerAspas(texto, fn) {
  const partes = texto.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
  return partes.map((p, k) => (k % 2 ? p : fn(p))).join('');
}

/** Minifica HTML: sem comentários, sem indentação e sem linhas vazias. */
export function minificarHtml(html) {
  if (/<(pre|textarea)[\s>]/i.test(html)) throw new Error('HTML com <pre> ou <textarea>: minificar à mão');
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((linha) => linha.trim())
    .filter(Boolean)
    .join('\n')
    .concat('\n');
}
