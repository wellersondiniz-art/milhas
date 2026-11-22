// Testes da montagem de dist/ (scripts/publicar/): minificação, CSS embutido
// com resumo na CSP, modulepreload, regra das imagens e o sw.js final.
//
// O teste mais importante: o motor minificado dá exatamente a mesma conta que
// o motor original, em todas as lojas, com os dados reais.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { minificarCss, minificarHtml, minificarJs } from '../scripts/publicar/minificar.js';
import { conferirImagens, cspComEstilos, ficaForaDoAr, grafoDeModulos, importsDe, montarDist, resolverHref, resumoCsp } from '../scripts/publicar/montar-dist.js';

const raiz = new URL('../', import.meta.url);
const site = new URL('site/', raiz);

async function pastaTemporaria(fn) {
  const pasta = await mkdtemp(join(tmpdir(), 'dist-'));
  try { return await fn(pasta); } finally { await rm(pasta, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
// JS

test('JS: tira comentários e indentação, mantém as quebras de linha', () => {
  const codigo = '// topo\nconst a = 1; /* meio */ const b = 2;\n\n  /**\n   * doc\n   */\n  function f(x) {\n    return x + 1; // fim\n  }\n';
  assert.equal(minificarJs(codigo), 'const a=1;const b=2;\nfunction f(x){\nreturn x+1;\n}\n');
});

test('JS: texto entre aspas e template passam intactos', () => {
  const codigo = "const u = 'http://x.com/a // b';\nconst t = `  dois  espaços ${ 'e' + `de ${ 1 + 1 } novo` }  /* não */ `;\n";
  const saida = minificarJs(codigo);
  assert.match(saida, /'http:\/\/x\.com\/a \/\/ b'/);
  assert.match(saida, /`  dois  espaços \$\{'e'\+`de \$\{1\+1\} novo`\}  \/\* não \*\/ `/);
});

test('JS: expressão regular e divisão', () => {
  const codigo = "const r = /[/]\\/ +/g;\nconst d = (a) / 2 / b;\nfunction f() { return /x/.test(s); }\nconst t = `${a / 100n}.${b}`;\n";
  const saida = minificarJs(codigo);
  assert.match(saida, /const r= \/\[\/\]\\\/ \+\/g;/);
  assert.match(saida, /const d=\(a\) \/ 2 \/ b;/);
  assert.match(saida, /return \/x\/\.test\(s\);/);
  assert.match(saida, /`\$\{a \/ 100n\}\.\$\{b\}`/);
});

test('JS: não junta sinais que mudariam o sentido', () => {
  assert.equal(minificarJs('x = a + +b - -c;\n'), 'x=a+ +b- -c;\n');
  assert.equal(minificarJs('const y = typeof x;\n'), 'const y=typeof x;\n');
  assert.equal(minificarJs('const z = 1 .toString();\n'), 'const z=1 .toString();\n');
});

test('JS: recusa texto que termina no meio', () => {
  assert.throws(() => minificarJs("const a = 'sem fim;\n"));
  assert.throws(() => minificarJs('const a = `sem fim;\n'));
  assert.throws(() => minificarJs('/* sem fim\n'));
});

async function minificarPastaJs(destino) {
  await cp(new URL('js/', site), destino, { recursive: true });
  const arquivos = (await readdir(destino, { recursive: true })).filter((a) => a.endsWith('.js'));
  for (const a of arquivos) {
    const caminho = join(destino, a);
    await writeFile(caminho, minificarJs(await readFile(caminho, 'utf8')), 'utf8');
  }
  return arquivos;
}

test('JS: todo arquivo de site/js minificado continua sendo JavaScript válido', async () => {
  await pastaTemporaria(async (pasta) => {
    const arquivos = await minificarPastaJs(pasta);
    assert.ok(arquivos.length > 10);
    for (const a of arquivos) {
      const mjs = join(pasta, `${a}.check.mjs`);
      await cp(join(pasta, a), mjs);
      execFileSync(process.execPath, ['--check', mjs]);
    }
  });
});

test('JS: o motor minificado faz a mesma conta que o original, com os dados reais', async () => {
  await pastaTemporaria(async (pasta) => {
    await minificarPastaJs(pasta);
    const original = await import('../site/js/motor/index.js');
    const formatoOriginal = await import('../site/js/perfil/formato.js');
    const minificado = await import(pathToFileURL(join(pasta, 'motor/index.js')).href);
    const formatoMinificado = await import(pathToFileURL(join(pasta, 'perfil/formato.js')).href);
    const dados = {};
    for (const nome of ['programas', 'cartoes', 'lojas', 'ofertas']) dados[nome] = JSON.parse(await readFile(new URL(`dados/${nome}.json`, raiz), 'utf8'));
    const perfil = formatoOriginal.perfilDeTodos(dados);
    assert.deepEqual(formatoMinificado.perfilDeTodos(dados), perfil);
    let contas = 0;
    for (const loja of dados.lojas) {
      for (const valor of [1, 9999, 129900, 1234567]) {
        for (const hoje of ['2026-11-10T12:00', '2027-03-01T08:00']) {
          const compra = { loja_id: loja.id, valor_centavos: valor, tipo_vendedor: 'loja' };
          assert.deepEqual(minificado.calcularJeitosDeComprar(perfil, compra, dados, hoje), original.calcularJeitosDeComprar(perfil, compra, dados, hoje));
          contas++;
        }
      }
    }
    assert.ok(contas >= 8);
    assert.equal(minificado.formatarCentavos(123456), original.formatarCentavos(123456));
  });
});

// ---------------------------------------------------------------------------
// CSS e HTML

test('CSS: tira comentários e espaços, mantém aspas e calc()', () => {
  const css = '/* cor */\n.a ,\n.b {\n  color : red ;\n  content: "  /* fica */  ";\n  width: calc(100% - 2rem);\n}\n';
  assert.equal(minificarCss(css), '.a,.b{color : red;content: "  /* fica */  ";width: calc(100% - 2rem)}');
});

test('HTML: tira comentários e indentação; recusa <pre>', () => {
  assert.equal(minificarHtml('<div>\n  <!-- nota -->\n  <p>oi  você</p>\n\n</div>\n'), '<div>\n<p>oi  você</p>\n</div>\n');
  assert.throws(() => minificarHtml('<pre>  x</pre>'));
});

// ---------------------------------------------------------------------------
// Peças da montagem

test('resolverHref entende caminho relativo e absoluto, e recusa outro site', () => {
  assert.equal(resolverHref('loja/magalu/index.html', '../../css/base.css'), 'css/base.css');
  assert.equal(resolverHref('offline.html', '/css/base.css'), 'css/base.css');
  assert.equal(resolverHref('index.html', 'js/app.js?v=1'), 'js/app.js');
  assert.throws(() => resolverHref('index.html', 'https://cdn.exemplo/x.css'));
});

test('importsDe acha import e export from, inclusive minificados', () => {
  assert.deepEqual(importsDe("import{a}from'./a.js';\nexport { b } from \"../b.js\";\nimport './c.js';"), ['./a.js', '../b.js', './c.js']);
});

test('grafo de módulos do app tem todos os arquivos que ele usa', async () => {
  const modulos = await grafoDeModulos(site, 'js/app.js');
  for (const m of ['js/motor/calcular.js', 'js/motor/datas.js', 'js/tela/busca-loja.js', 'js/pwa/pwa.js', 'js/perfil/armazem.js']) assert.ok(modulos.includes(m), `falta ${m}`);
  assert.ok(!modulos.includes('js/app.js'));
});

test('CSP ganha o resumo de cada <style>', () => {
  const resumo = resumoCsp('body{color:red}');
  assert.match(resumo, /^'sha256-[A-Za-z0-9+/]+=*'$/);
  const nova = cspComEstilos("default-src 'self'; style-src 'self'; img-src 'self'", [resumo, resumo]);
  assert.equal(nova, `default-src 'self'; style-src 'self' ${resumo}; img-src 'self'`);
  assert.throws(() => cspComEstilos("style-src 'unsafe-inline'", [resumo]));
});

test('imagem precisa de width, height e AVIF/WebP/SVG', () => {
  assert.deepEqual(conferirImagens('a.html', '<img src="x.avif" width="10" height="10" alt="">'), []);
  assert.deepEqual(conferirImagens('a.html', '<picture><source srcset="x.avif" type="image/avif"><img src="x.webp" width="10" height="10" alt=""></picture>'), []);
  assert.equal(conferirImagens('a.html', '<img src="x.avif" alt="">').length, 1);
  assert.equal(conferirImagens('a.html', '<img src="x.png" width="1" height="1" alt="">').length, 1);
  assert.equal(conferirImagens('a.html', '<source srcset="x.jpg 1x">').length, 1);
});

// ---------------------------------------------------------------------------
// dist/ inteira

test('dist/: CSS dentro das páginas, CSP com os resumos, modulepreload e sw.js com os arquivos finais', async () => {
  await pastaTemporaria(async (pasta) => {
    const destino = pathToFileURL(`${pasta}/dist/`);
    await montarDist(site, destino);
    const arquivos = (await readdir(destino, { recursive: true })).map(String);
    assert.ok(!arquivos.some((a) => a.endsWith('.css')), 'nenhum .css solto em dist/');
    for (const a of ['estilo.html', 'js/vitrine.js']) assert.ok(!arquivos.includes(a), `${a} não vai para o ar`);

    const headers = await readFile(new URL('_headers', destino), 'utf8');
    for (const pagina of arquivos.filter((a) => a.endsWith('.html'))) {
      const html = await readFile(new URL(pagina, destino), 'utf8');
      assert.ok(!/rel="stylesheet"/.test(html), `${pagina} ainda tem <link rel="stylesheet">`);
      assert.ok(!/<!--/.test(html), `${pagina} ainda tem comentário`);
      for (const [, css] of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
        assert.ok(headers.includes(resumoCsp(css)), `${pagina}: resumo do <style> fora da CSP`);
      }
    }

    const index = await readFile(new URL('index.html', destino), 'utf8');
    assert.match(index, /<style>/);
    for (const m of await grafoDeModulos(destino, 'js/app.js')) assert.ok(index.includes(`<link rel="modulepreload" href="${m}">`), `sem modulepreload de ${m}`);
    assert.match(index, /<link rel="preload" href="dados\/lojas\.json" as="fetch" crossorigin>/);

    const sw = await readFile(new URL('sw.js', destino), 'utf8');
    const lista = JSON.parse(/const ARQUIVOS_DO_APP=(\[[\s\S]*?\]);/.exec(sw)[1]);
    for (const a of lista) assert.ok(arquivos.includes(a), `sw.js guarda ${a}, que não existe em dist/`);
    assert.ok(lista.includes('index.html') && lista.includes('js/app.js'));
    assert.ok(!lista.some((a) => a.endsWith('.css') || a.endsWith('-512.png')));
    assert.match(sw, /const VERSAO='[0-9a-f]{12}';/);
  });
});

test('ficaForaDoAr: vitrine, sw.js de site/ e .gitkeep não vão para dist/', () => {
  for (const f of ['estilo.html', 'js/vitrine.js', 'css/vitrine.css', 'sw.js', 'img/.gitkeep']) assert.ok(ficaForaDoAr(f), f);
  for (const f of ['index.html', 'js/app.js', 'offline.html', 'loja/magalu/index.html', 'js/tela/estilo.js']) assert.ok(!ficaForaDoAr(f), f);
});
