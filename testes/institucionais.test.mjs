// Páginas institucionais (scripts/paginas/institucionais.js) e rodapé.
// Alguns testes amarram o texto ao código: se o site passar a usar cookie,
// métrica ou link de afiliado, eles falham para lembrar de mudar os textos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { PASTAS_INSTITUCIONAIS, paginasInstitucionais } from '../scripts/paginas/institucionais.js';
import { PAGINAS_DO_RODAPE } from '../scripts/paginas/moldura.js';
import { conferirHtml } from '../scripts/paginas/conferir-html.js';
import { gerarPaginas } from '../scripts/paginas/montar.js';
import { lerDados } from '../scripts/gerar-paginas.js';
import { EVENTOS } from '../site/js/metricas/metricas.js';
import { DOMINIO_NO_PLAUSIBLE } from '../site/js/metricas/config.js';

const RAIZ = new URL('../', import.meta.url);
const BASE = 'https://exemplo.com.br';
const porCaminho = (paginas) => Object.fromEntries(paginas.map((a) => [a.caminho, a.conteudo]));
const textoVisivel = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

async function codigoDoSite() {
  const pasta = new URL('site/js/', RAIZ);
  const arquivos = (await readdir(pasta, { recursive: true })).filter((a) => a.endsWith('.js'));
  const textos = await Promise.all(arquivos.map((a) => readFile(new URL(a, pasta), 'utf8')));
  return textos.join('\n') + await readFile(new URL('site/index.html', RAIZ), 'utf8');
}

test('gera as cinco páginas, todas passam na conferência de HTML', () => {
  const { paginas } = paginasInstitucionais({ urlBase: BASE });
  assert.deepEqual(paginas.map((p) => p.caminho), PASTAS_INSTITUCIONAIS.map((p) => `${p}/index.html`));
  for (const { caminho, conteudo } of paginas) assert.deepEqual(conferirHtml(conteudo), [], caminho);
});

test('rodapé: mesma lista das páginas geradas, em todas as páginas e no index.html', async () => {
  assert.deepEqual(PAGINAS_DO_RODAPE.map(([pasta]) => pasta), PASTAS_INSTITUCIONAIS);
  const dados = await lerDados(new URL('dados/', RAIZ));
  const { arquivos } = gerarPaginas(dados, { hoje: '2026-11-22', urlBase: BASE });
  const index = await readFile(new URL('site/index.html', RAIZ), 'utf8');
  for (const pasta of PASTAS_INSTITUCIONAIS) {
    assert.match(index, new RegExp(`<a href="${pasta}/">`), `index.html → ${pasta}`);
    for (const { caminho, conteudo } of arquivos.filter((a) => a.caminho.endsWith('.html'))) {
      const raiz = '../'.repeat(caminho.split('/').length - 1);
      assert.ok(conteudo.includes(`href="${raiz}${pasta}/"`), `${caminho} → ${pasta}`);
    }
  }
  const privacidade = arquivos.find((a) => a.caminho === 'privacidade/index.html').conteudo;
  assert.match(privacidade, /<a href="..\/privacidade\/" aria-current="page">Privacidade<\/a>/);
});

test('revisão jurídica pendente: aviso no topo, noindex e fora do sitemap', () => {
  const { paginas, indexaveis, avisos } = paginasInstitucionais({ urlBase: BASE, revisaoPendente: true });
  for (const { caminho, conteudo } of paginas) {
    assert.match(textoVisivel(conteudo), /Texto em revisão Este texto ainda vai ser revisado por um advogado/, caminho);
    assert.match(conteudo, /<meta name="robots" content="noindex">/, caminho);
    // O aviso vem antes do primeiro h2 (no começo da página).
    assert.ok(conteudo.indexOf('Texto em revisão') < conteudo.indexOf('<h2'), caminho);
  }
  assert.deepEqual(indexaveis, []);
  assert.ok(avisos.some((a) => /REVISAO_JURIDICA_PENDENTE/.test(a)));
});

test('revisão aprovada: sem aviso, sem noindex e no sitemap', async () => {
  const { paginas, indexaveis } = paginasInstitucionais({ urlBase: BASE, revisaoPendente: false });
  for (const { conteudo } of paginas) {
    assert.doesNotMatch(conteudo, /Texto em revisão|noindex/);
  }
  assert.deepEqual(indexaveis, PASTAS_INSTITUCIONAIS.map((p) => `${p}/`));
});

test('sitemap do build segue a revisão: hoje as institucionais ficam de fora', async () => {
  const dados = await lerDados(new URL('dados/', RAIZ));
  const { arquivos } = gerarPaginas(dados, { hoje: '2026-11-22', urlBase: BASE });
  const sitemap = arquivos.find((a) => a.caminho === 'sitemap.xml').conteudo;
  for (const pasta of PASTAS_INSTITUCIONAIS) assert.doesNotMatch(sitemap, new RegExp(`/${pasta}/`));
});

test('contato: sem e-mail definido, diz que o canal está em preparação', () => {
  const { paginas, avisos } = paginasInstitucionais({ email: 'A_CONFIRMAR' });
  const contato = porCaminho(paginas)['contato/index.html'];
  assert.match(textoVisivel(contato), /Ainda estamos preparando o canal de contato/);
  assert.doesNotMatch(contato, /mailto:/);
  assert.ok(avisos.some((a) => /EMAIL_DE_CONTATO/.test(a)));
});

test('contato: com e-mail, vira link mailto; e-mail inválido para o build', () => {
  const contato = porCaminho(paginasInstitucionais({ email: 'oi@exemplo.com.br' }).paginas)['contato/index.html'];
  assert.match(contato, /<a href="mailto:oi@exemplo.com.br">oi@exemplo.com.br<\/a>/);
  assert.doesNotMatch(contato, /em preparação/);
  assert.throws(() => paginasInstitucionais({ email: 'oi" onclick="x' }), /EMAIL_DE_CONTATO inválido/);
});

test('textos: data de atualização no topo, termos explicados, sem linguagem de contrato nem promessa de ganho', () => {
  const p = porCaminho(paginasInstitucionais({ atualizadoEm: '2026-11-22' }).paginas);
  for (const [caminho, html] of Object.entries(p)) {
    const texto = textoVisivel(html);
    assert.match(texto, /Texto de 22\/11\/2026\./, caminho);
    for (const proibido of [/usuário/i, /vedad/i, /mediante/i, /doravante/i, /outrossim/i, /declara/i, /lucr/i, /\bganhe\b/i, /garantid/i]) {
      assert.doesNotMatch(texto, proibido, `${caminho}: ${proibido}`);
    }
  }
  const como = textoVisivel(p['como-funciona/index.html']);
  for (const termo of ['O que é milheiro?', 'O que é clube?', 'O que é bônus?']) assert.ok(como.includes(termo), termo);
  assert.throws(() => paginasInstitucionais({ atualizadoEm: 'ontem' }), /TEXTOS_ATUALIZADOS_EM/);
});

async function codigoPorArquivo() {
  const pasta = new URL('site/js/', RAIZ);
  const arquivos = (await readdir(pasta, { recursive: true })).filter((a) => a.endsWith('.js'));
  return Promise.all(arquivos.map(async (a) => [a, await readFile(new URL(a, pasta), 'utf8')]));
}

test('privacidade e termos dizem o que o código faz: sem cookie, sem afiliado; métrica só pelo módulo de métricas', async () => {
  const p = porCaminho(paginasInstitucionais({ medindo: false }).paginas);
  const privacidade = textoVisivel(p['privacidade/index.html']);
  const termos = textoVisivel(p['termos/index.html']);
  assert.match(privacidade, /O site não cria cookies\. Hoje não usamos nenhuma ferramenta de métrica/);
  assert.match(privacidade, /Número do cartão/);
  assert.match(privacidade, /CPF/);
  assert.match(termos, /não usamos link de afiliado/);
  assert.match(termos, /comissão sem custo extra para você/);

  // Se algum destes falhar, mude os textos de Privacidade e Termos junto com o código.
  const codigo = await codigoDoSite();
  assert.doesNotMatch(codigo, /document\.cookie/, 'o site passou a usar cookie');
  assert.doesNotMatch(codigo, /sendBeacon|gtag|google|umami|cloudflareinsights/i, 'o site passou a usar outra métrica');
  // Só a pasta metricas/ fala com o Plausible (e a Privacidade lista o que ela manda).
  const falamComFora = (await codigoPorArquivo()).filter(([, texto]) => /plausible|https:\/\//i.test(texto)).map(([a]) => a);
  assert.ok(falamComFora.includes('metricas/config.js'));
  assert.deepEqual(falamComFora.filter((a) => !a.startsWith('metricas/')), [], 'só site/js/metricas/ pode falar com o Plausible');
  const headers = await readFile(new URL('site/_headers', RAIZ), 'utf8');
  assert.match(headers, /connect-src 'self' https:\/\/plausible\.io;/, 'o site passou a falar com outro servidor');
  assert.match(headers, /script-src 'self';/, 'o site passou a carregar script de fora');
  const esquemas = await Promise.all(['ofertas', 'lojas', 'cartoes', 'programas'].map((n) => readFile(new URL(`dados/schemas/${n}.schema.json`, RAIZ), 'utf8')));
  assert.doesNotMatch(esquemas.join('\n'), /afiliad|affiliate/i, 'os dados passaram a ter link de afiliado');
});

test('com as métricas ligadas, a Privacidade lista tudo o que é medido e o que nunca vai', () => {
  const { paginas, avisos } = paginasInstitucionais({ medindo: true });
  const privacidade = textoVisivel(porCaminho(paginas)['privacidade/index.html']);
  assert.match(privacidade, /O site não cria cookies e não mostra anúncios/);
  assert.match(privacidade, /Plausible, uma ferramenta de métricas que não usa cookie/);
  for (const { descricao } of Object.values(EVENTOS)) {
    assert.ok(privacidade.toLowerCase().includes(descricao.toLowerCase()), descricao);
  }
  assert.match(privacidade, /Nunca mandamos o valor da compra, os seus cartões, os seus programas/);
  assert.match(privacidade, /Do Not Track/);
  assert.doesNotMatch(privacidade, /Hoje não usamos nenhuma ferramenta de métrica/);
  assert.ok(avisos.some((a) => /Métricas ligadas/.test(a)));
  assert.equal(conferirHtml(porCaminho(paginas)['privacidade/index.html']).length, 0);
});

test('a Privacidade segue o config: desligada enquanto o Plausible for A_CONFIRMAR', () => {
  const privacidade = textoVisivel(porCaminho(paginasInstitucionais({}).paginas)['privacidade/index.html']);
  if (DOMINIO_NO_PLAUSIBLE === 'A_CONFIRMAR') assert.match(privacidade, /Hoje não usamos nenhuma ferramenta de métrica/);
  else assert.match(privacidade, /Contamos só isto/);
});
