// Conferência simples das páginas geradas, sem dependências.
// Não é um validador completo do W3C: pega os erros que um gerador costuma
// cometer (tag sem fechar, "<" solto vindo de dado, id repetido, JSON-LD
// quebrado, falta de título, descrição ou h1).

const VAZIOS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TOKEN = /<!--[\s\S]*?-->|<!doctype html>|<(\/?)([a-z][a-z0-9-]*)((?:\s+[a-z][a-z0-9:-]*(?:="[^"<]*")?)*)\s*>/gi;
/** Módulo JS do próprio site, por caminho relativo: ../../js/nome.js */
const SCRIPT_DO_SITE = /^(\.\.\/)*js\/([a-z0-9-]+\/)*[a-z0-9-]+\.js$/;
const ATRIBUTO = /([a-z][a-z0-9:-]*)(?:="([^"]*)")?/gi;

function atributos(texto) {
  const lista = [];
  for (const m of texto.matchAll(ATRIBUTO)) lista.push([m[1].toLowerCase(), m[2] ?? '']);
  return lista;
}

/** Devolve a lista de problemas da página (vazia = ok). */
export function conferirHtml(html) {
  const problemas = [];
  if (!html.startsWith('<!doctype html>')) problemas.push('não começa com <!doctype html>');

  const pilha = [];
  const ids = new Map();
  const referencias = [];
  const contagem = { title: 0, h1: 0, description: 0, main: 0 };
  let posicao = 0;
  let titulo = '';

  const textoSolto = (trecho, onde) => {
    if (trecho.includes('<')) problemas.push(`"<" solto no texto perto de: ${trecho.slice(trecho.indexOf('<'), trecho.indexOf('<') + 40)} (${onde})`);
  };

  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(html))) {
    textoSolto(html.slice(posicao, m.index), `posição ${posicao}`);
    posicao = TOKEN.lastIndex;
    const [inteiro, fecha, nomeBruto, attrsTexto] = m;
    if (!nomeBruto) continue; // comentário ou doctype
    const nome = nomeBruto.toLowerCase();

    if (fecha) {
      const aberto = pilha.pop();
      if (aberto !== nome) problemas.push(`</${nome}> fecha <${aberto ?? 'nada'}>`);
      continue;
    }
    const attrs = atributos(attrsTexto);
    for (const [a, v] of attrs) {
      if (a === 'id') ids.set(v, (ids.get(v) ?? 0) + 1);
      if (a === 'aria-labelledby' || a === 'aria-describedby' || a === 'aria-controls') referencias.push(...v.split(/\s+/));
    }
    if (nome === 'title' || nome === 'h1' || nome === 'main') contagem[nome] += 1;
    if (nome === 'meta' && attrs.some(([a, v]) => a === 'name' && v === 'description')) {
      contagem.description += 1;
      if (!attrs.some(([a, v]) => a === 'content' && v.trim())) problemas.push('meta description vazia');
    }
    if (nome === 'script') {
      const tipo = attrs.find(([a]) => a === 'type')?.[1];
      const src = attrs.find(([a]) => a === 'src')?.[1];
      // Só dois tipos: JSON-LD (dado, não executa) ou módulo do próprio site em js/, sem código na página.
      const moduloDoSite = tipo === 'module' && SCRIPT_DO_SITE.test(src ?? '');
      if (tipo !== 'application/ld+json' && !moduloDoSite) problemas.push(`script que executa código na página (type=${tipo ?? 'nenhum'})`);
      const fim = html.indexOf('</script>', posicao);
      if (fim < 0) { problemas.push('<script> sem </script>'); break; }
      const corpo = html.slice(posicao, fim);
      if (moduloDoSite) {
        if (corpo.trim()) problemas.push('script com src não pode ter código dentro');
      } else {
        try { JSON.parse(corpo); } catch (erro) { problemas.push(`JSON-LD inválido: ${erro.message}`); }
      }
      posicao = fim + '</script>'.length;
      TOKEN.lastIndex = posicao;
      continue;
    }
    if (nome === 'title') {
      const fim = html.indexOf('</title>', posicao);
      titulo = html.slice(posicao, fim).trim();
    }
    if (!VAZIOS.has(nome) && !inteiro.endsWith('/>')) pilha.push(nome);
  }
  textoSolto(html.slice(posicao), 'fim');
  if (pilha.length) problemas.push(`tags sem fechar: ${pilha.join(', ')}`);

  for (const [id, n] of ids) if (n > 1) problemas.push(`id repetido: ${id}`);
  for (const ref of referencias) if (!ids.has(ref)) problemas.push(`aria aponta para id que não existe: ${ref}`);
  if (contagem.title !== 1 || !titulo) problemas.push(`precisa de 1 <title> com texto (tem ${contagem.title})`);
  if (contagem.description !== 1) problemas.push(`precisa de 1 meta description (tem ${contagem.description})`);
  if (contagem.h1 !== 1) problemas.push(`precisa de 1 <h1> (tem ${contagem.h1})`);
  if (contagem.main !== 1) problemas.push(`precisa de 1 <main> (tem ${contagem.main})`);
  if (!/<html lang="pt-BR">/.test(html)) problemas.push('falta <html lang="pt-BR">');
  return problemas;
}

/** Pega o texto de uma tag simples (title) ou o content de uma meta. Para testes e relatórios. */
export function lerTitulo(html) {
  return /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null;
}

export function lerDescricao(html) {
  return /<meta name="description" content="([^"]*)">/.exec(html)?.[1] ?? null;
}
