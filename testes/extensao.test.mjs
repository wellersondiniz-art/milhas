// Extensão de navegador: leitura do preço, texto do selo, núcleo do service
// worker, build do pacote e as garantias de segurança e privacidade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lerPreco, PRECO_MAXIMO_CENTAVOS, recortarPreco } from '../extensao/fonte/preco.js';
import { textoDoSelo } from '../extensao/fonte/selo-texto.js';
import { agoraEmSaoPaulo } from '../extensao/fonte/relogio.js';
import { lerArgumentos, montarExtensao, montarManifesto, textoDosDados, validarSeletores } from '../scripts/extensao/montar.js';

const raiz = new URL('../', import.meta.url);
const lerJson = async (rel) => JSON.parse(await readFile(new URL(rel, raiz), 'utf8'));

// ---------------------------------------------------------------------------
// Preço lido da página (não confiável)

test('lerPreco aceita os jeitos comuns de escrever preço em reais', () => {
  assert.equal(lerPreco('R$ 1.299,00'), 129900);
  assert.equal(lerPreco('R$ 1.299,00'), 129900);
  assert.equal(lerPreco('R$ 1.299,00'), 129900);
  assert.equal(lerPreco('  R$1299,90 \n'), 129990);
  assert.equal(lerPreco('1.234.567,89'), 123456789);
  assert.equal(lerPreco('R$ 99'), 9900);
  assert.equal(lerPreco('0,01'), 1);
  assert.equal(lerPreco('1.234'), 123400, 'ponto é milhar no formato de tela');
});

test('lerPreco no formato decimal (atributo de máquina)', () => {
  assert.equal(lerPreco('1299.9', 'decimal'), 129990);
  assert.equal(lerPreco('1299.90', 'decimal'), 129990);
  assert.equal(lerPreco('250', 'decimal'), 25000);
  assert.equal(lerPreco('0.1', 'decimal'), 10);
  assert.equal(lerPreco('1.299,90', 'decimal'), null);
  assert.equal(lerPreco('1299.999', 'decimal'), null);
  assert.equal(lerPreco('-5', 'decimal'), null);
});

test('lerPreco recusa tudo que não for exatamente um preço', () => {
  for (const ruim of [
    '', '   ', 'R$', 'Grátis', 'R$ 1.299,00 a R$ 1.599,00', '12x de R$ 108,25', 'R$ 1,299.00', 'R$ 12.34,00',
    'R$ 1.29', 'R$ 10,5', 'US$ 10,00', '<img src=x onerror=alert(1)>', 'R$ 0,00', '0', '1e5', 'R$ -10,00',
    'R$ 1.299,00'.repeat(4), '١٢٣', 'R$ ９９', '9999999999,00',
  ]) {
    assert.equal(lerPreco(ruim), null, ruim);
  }
  for (const naoTexto of [null, undefined, 1299, {}, ['R$ 1,00']]) assert.equal(lerPreco(naoTexto), null);
});

test('lerPreco respeita o teto e devolve sempre inteiro seguro', () => {
  assert.equal(lerPreco('R$ 999.999.999,99'), PRECO_MAXIMO_CENTAVOS);
  assert.equal(lerPreco('999999999.99', 'decimal'), PRECO_MAXIMO_CENTAVOS);
  assert.equal(lerPreco('R$ 1.000.000.000,00'), null);
  assert.equal(lerPreco('000.123,00'), 12300);
});

test('recortarPreco tira o preço no cartão da linha de parcelas (textos reais da Magalu, 23/11/2026)', async () => {
  const { lojas } = await lerJson('extensao/seletores.json');
  const padrao = lojas.find((l) => l.loja_id === 'magalu').seletores_preco[0].extrair;
  const casos = [
    ['ou R$\u00a03.699,00 em 10x de R$\u00a0369,90 sem juros', '3.699,00', 369900],
    ['ou R$ 346,32 em 8x de R$ 43,29 sem juros', '346,32', 34632],
    ['ou R$ 735,68 em 10x de R$ 73,57 sem juros', '735,68', 73568],
    ['Ou 1x de R$ 39,99 sem juros', '39,99', 3999],
    ['  ou\n R$ 1,00 em 1x ', '1,00', 100],
  ];
  for (const [texto, recorte, centavos] of casos) {
    assert.equal(recortarPreco(texto, padrao), recorte, texto);
    assert.equal(lerPreco(recortarPreco(texto, padrao)), centavos, texto);
  }
  for (const ruim of ['R$ 329,00', 'no Pix', 'ou R$ abc em 10x', 'De R$ 5.099,00', 'x'.repeat(81), null, 42]) {
    assert.equal(recortarPreco(ruim, padrao), null, String(ruim));
  }
  // O recorte não valida: quem valida é lerPreco.
  assert.equal(lerPreco(recortarPreco('ou R$ 1.2.3,00 em 2x', padrao)), null);
});

// ---------------------------------------------------------------------------
// Texto do selo

const jeito = (extra = {}) => ({
  tipo: 'sem_oferta',
  programa: { id: 'p', nome: 'Programa X' },
  cartao: { id: 'c', nome: 'Cartão X Platinum' },
  total_pontos: 2598,
  total_pontos_texto: '2.598',
  valor_estimado_em_reais: { texto: 'R$ 51,96' },
  tem_dado_antigo: false,
  ...extra,
});

test('textoDoSelo monta "Melhor jeito: X pontos com [cartão]"', () => {
  assert.deepEqual(textoDoSelo([jeito(), jeito({ total_pontos: 1 })]), {
    titulo: 'Melhor jeito: 2.598 pontos com Cartão X Platinum',
    detalhe: 'no Programa X · vale cerca de R$ 51,96',
  });
  assert.deepEqual(textoDoSelo([jeito({ tipo: 'oferta', valor_estimado_em_reais: null, tem_dado_antigo: true })]), {
    titulo: 'Melhor jeito: 2.598 pontos com Cartão X Platinum',
    detalhe: 'com a oferta Programa X · dado conferido há mais de 14 dias',
  });
  assert.equal(textoDoSelo([jeito({ total_pontos: 1, total_pontos_texto: '1' })]).titulo, 'Melhor jeito: 1 ponto com Cartão X Platinum');
  assert.deepEqual(textoDoSelo([jeito({ cartao: null, programa: null, valor_estimado_em_reais: null })], { semPerfil: true }), {
    titulo: 'Melhor jeito: 2.598 pontos',
    detalhe: 'contando todos os cartões; escolha os seus nas opções da extensão',
  });
});

test('textoDoSelo não mostra selo sem pontos ou sem resultado', () => {
  assert.equal(textoDoSelo([]), null);
  assert.equal(textoDoSelo(null), null);
  assert.equal(textoDoSelo([jeito({ total_pontos: 0, total_pontos_texto: '0' })]), null);
  assert.equal(textoDoSelo([jeito({ total_pontos_texto: undefined })]), null);
});

// ---------------------------------------------------------------------------
// Relógio de São Paulo

test('agoraEmSaoPaulo usa o horário de Brasília, em qualquer fuso do computador', () => {
  assert.equal(agoraEmSaoPaulo(new Date('2026-11-22T02:30:00Z')), '2026-11-21T23:30');
  assert.equal(agoraEmSaoPaulo(Date.UTC(2026, 0, 1, 3, 0)), '2026-01-01T00:00');
});

// ---------------------------------------------------------------------------
// Arquivo de seletores

const LOJAS = [{ id: 'magalu', dominio: 'magazineluiza.com.br' }, { id: 'amazon', dominio: 'amazon.com.br' }];
const lojaOk = (extra = {}) => ({
  loja_id: 'magalu',
  status: 'verificado',
  hosts: ['www.magazineluiza.com.br'],
  caminho_produto: '/p/',
  seletores_preco: [{ css: '.preco', formato: 'texto' }],
  fonte_url: 'https://www.magazineluiza.com.br/produto/p/abc/',
  verificado_em: '2026-11-22',
  ...extra,
});

test('o seletores.json do repositório é válido e só tem candidatos A_CONFIRMAR ou lojas verificadas com fonte', async () => {
  const lojas = await lerJson('dados/lojas.json');
  const arquivo = await lerJson('extensao/seletores.json');
  const { erros, ativos } = validarSeletores(arquivo, lojas);
  assert.deepEqual(erros, []);
  const verificadas = arquivo.lojas.filter((l) => l.status === 'verificado').map((l) => l.loja_id);
  assert.deepEqual(ativos.map((l) => l.loja_id), verificadas);
  const conferir = validarSeletores(arquivo, lojas, { conferir: true });
  assert.equal(conferir.ativos.length, arquivo.lojas.length);
});

test('validarSeletores: só entra loja verificada, com campos limpos', () => {
  const { erros, ativos } = validarSeletores({ versao: 1, lojas: [lojaOk({ extra: 'x', seletores_preco: [{ css: 'meta', atributo: 'content', formato: 'decimal', lixo: 1 }, { css: 'p', formato: 'texto', extrair: '^ou (\\S+)' }] }), lojaOk({ loja_id: 'amazon', hosts: ['amazon.com.br'], status: 'A_CONFIRMAR' })] }, LOJAS);
  assert.deepEqual(erros, []);
  assert.deepEqual(ativos, [{ loja_id: 'magalu', hosts: ['www.magazineluiza.com.br'], caminho_produto: '/p/', seletores_preco: [{ css: 'meta', formato: 'decimal', atributo: 'content' }, { css: 'p', formato: 'texto', extrair: '^ou (\\S+)' }] }]);
});

test('validarSeletores aponta cada problema e não ativa a loja com erro', () => {
  const casos = [
    [null, /versao/],
    [{ versao: 2, lojas: [] }, /versao/],
    [{ versao: 1, lojas: [lojaOk({ loja_id: 'nao-existe' })] }, /loja_id não existe/],
    [{ versao: 1, lojas: [lojaOk({ hosts: [] })] }, /"hosts"/],
    [{ versao: 1, lojas: [lojaOk({ hosts: ['<all_urls>'] })] }, /host inválido/],
    [{ versao: 1, lojas: [lojaOk({ hosts: ['*.magazineluiza.com.br'] })] }, /host inválido/],
    [{ versao: 1, lojas: [lojaOk({ hosts: ['www.amazon.com.br'] })] }, /não é do domínio da loja/],
    [{ versao: 1, lojas: [lojaOk({ hosts: ['magazineluiza.com.br.golpe.com'] })] }, /não é do domínio da loja/],
    [{ versao: 1, lojas: [lojaOk(), lojaOk()] }, /mais de uma loja/],
    [{ versao: 1, lojas: [lojaOk({ caminho_produto: '' })] }, /caminho_produto/],
    [{ versao: 1, lojas: [lojaOk({ caminho_produto: '(' })] }, /expressão regular válida/],
    [{ versao: 1, lojas: [lojaOk({ seletores_preco: [] })] }, /ao menos um seletor/],
    [{ versao: 1, lojas: [lojaOk({ seletores_preco: [{ css: ' ', formato: 'texto' }] })] }, /"css"/],
    [{ versao: 1, lojas: [lojaOk({ seletores_preco: [{ css: 'a', formato: 'html' }] })] }, /"formato"/],
    [{ versao: 1, lojas: [lojaOk({ seletores_preco: [{ css: 'input', atributo: 'value', formato: 'texto' }] })] }, /"atributo"/],
    [{ versao: 1, lojas: [lojaOk({ seletores_preco: [{ css: 'a', formato: 'texto', extrair: '(' }] })] }, /"extrair"/],
    [{ versao: 1, lojas: [lojaOk({ seletores_preco: [{ css: 'a', formato: 'texto', extrair: 'R\\$ [\\d,]+' }] })] }, /grupo de captura/],
    [{ versao: 1, lojas: [lojaOk({ seletores_preco: [{ css: 'a', formato: 'texto', extrair: `(${'a'.repeat(200)})` }] })] }, /"extrair"/],
    [{ versao: 1, lojas: [lojaOk({ fonte_url: 'A_CONFIRMAR' })] }, /fonte_url/],
    [{ versao: 1, lojas: [lojaOk({ verificado_em: '22/11/2026' })] }, /verificado_em/],
    [{ versao: 1, lojas: [lojaOk({ status: 'ok' })] }, /"status"/],
  ];
  for (const [arquivo, erro] of casos) {
    const r = validarSeletores(arquivo, LOJAS, { conferir: true });
    assert.match(r.erros.join('\n'), erro, JSON.stringify(arquivo));
    if (arquivo?.lojas?.length === 1) assert.deepEqual(r.ativos, []);
  }
});

// ---------------------------------------------------------------------------
// Manifesto e pacote

test('montarManifesto: sites só das lojas ativas; sem loja, sem script de conteúdo', async () => {
  const modelo = await lerJson('extensao/fonte/manifest.json');
  const com = montarManifesto(modelo, [{ hosts: ['www.b.com.br', 'a.com.br'] }, { hosts: ['a.com.br'] }]);
  assert.deepEqual(com.content_scripts, [{ matches: ['https://a.com.br/*', 'https://www.b.com.br/*'], js: ['conteudo.js'], run_at: 'document_idle', all_frames: false }]);
  assert.equal(montarManifesto(modelo, []).content_scripts, undefined);
  assert.deepEqual(modelo.content_scripts, [], 'o modelo não é alterado');
});

test('textoDosDados gera só dados, sem código', () => {
  const texto = textoDosDados({ lojas: [{ id: 'a', nome: '</script>' }] }, []);
  assert.match(texto, /^\/\/ Gerado/);
  assert.match(texto, /export const DADOS = Object\.freeze\(\{"lojas":\[\{"id":"a","nome":"<\/script>"\}\]\}\);/);
  assert.match(texto, /export const SELETORES = Object\.freeze\(\[\]\);/);
});

test('lerArgumentos', () => {
  const o = lerArgumentos(['--conferir', '--dados', 'x', '--saida', 'y', '--seletores', 'z.json']);
  assert.equal(o.conferir, true);
  assert.equal(o.dados.href, pathToFileURL(path.resolve('x') + path.sep).href);
  assert.equal(o.saida.href, pathToFileURL(path.resolve('y') + path.sep).href);
  assert.equal(o.seletores.href, pathToFileURL(path.resolve('z.json')).href);
  assert.deepEqual(lerArgumentos([]), { conferir: false });
  assert.throws(() => lerArgumentos(['--publicar']), /opção desconhecida/);
});

async function comPacote(opcoes, fn) {
  const pasta = await mkdtemp(path.join(tmpdir(), 'pacote-'));
  const saida = pathToFileURL(pasta + path.sep);
  try {
    const r = await montarExtensao({ ...opcoes, saida });
    return await fn(saida, r);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

test('montarExtensao copia o motor e o formato do perfil do site sem mudar nada', async () => {
  await comPacote({}, async (saida, { manifesto }) => {
    for (const nome of await readdir(new URL('site/js/motor/', raiz))) {
      assert.equal(await readFile(new URL(`motor/${nome}`, saida), 'utf8'), await readFile(new URL(`site/js/motor/${nome}`, raiz), 'utf8'), nome);
    }
    assert.equal(await readFile(new URL('perfil/formato.js', saida), 'utf8'), await readFile(new URL('site/js/perfil/formato.js', raiz), 'utf8'));
    const gravado = JSON.parse(await readFile(new URL('manifest.json', saida), 'utf8'));
    assert.deepEqual(gravado, manifesto);
    const arquivos = await readdir(saida, { recursive: true });
    for (const proibido of ['seletores.json', 'README.md', 'PRIVACIDADE.md']) assert.ok(!arquivos.includes(proibido), proibido);
    // Os arquivos citados no manifesto existem no pacote.
    for (const caminho of [manifesto.background.service_worker, manifesto.options_ui.page, ...Object.values(manifesto.icons)]) {
      await readFile(new URL(caminho, saida));
    }
  });
});

test('montarExtensao recusa seletores com erro e não monta nada', async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), 'seletores-'));
  try {
    const arquivo = path.join(pasta, 'seletores.json');
    await (await import('node:fs/promises')).writeFile(arquivo, JSON.stringify({ versao: 1, lojas: [lojaOk({ hosts: ['www.exemplo.com'] })] }));
    await assert.rejects(montarExtensao({ seletores: pathToFileURL(arquivo), saida: pathToFileURL(path.join(pasta, 'saida') + path.sep) }), /não é do domínio da loja/);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Núcleo do service worker (motor de verdade, dados de teste)

test('núcleo: config e selo só para o host exato de uma loja ativa', async () => {
  await comPacote({
    dados: new URL('testes/navegador/dados-de-teste/', raiz),
    seletores: new URL('testes/extensao/seletores-de-teste.json', raiz),
  }, async (saida) => {
    const { calcularSelo, configuracaoPara, lojaDoHost } = await import(new URL('nucleo.js', saida));
    const { DADOS, SELETORES } = await import(new URL('dados.js', saida));
    const HOJE = '2026-11-10T12:00';

    assert.deepEqual(configuracaoPara('www.outra-loja.invalid', SELETORES), {
      caminho_produto: '^/p/',
      seletores: [{ css: '#preco', atributo: null }, { css: '[data-testid="price-installment"] > span[aria-hidden="true"]', atributo: null }],
    });
    // Preço recortado da linha de parcelas (regra "extrair" do arquivo de seletores).
    // Desde o PR 33 a ordem é pelo valor em reais: o Beta não tem milheiro, então fica depois.
    assert.equal(calcularSelo({ texto: 'ou R$ 3.699,00 em 10x de R$ 369,90 sem juros', indice: 1 }, 'www.outra-loja.invalid', null, DADOS, SELETORES, HOJE).titulo, 'Melhor jeito: 7.398 pontos com Cartão Alfa Platinum');
    assert.equal(calcularSelo({ texto: 'R$ 3.329,10', indice: 1 }, 'www.outra-loja.invalid', null, DADOS, SELETORES, HOJE), null);
    assert.deepEqual(configuracaoPara('WWW.OUTRA-LOJA.INVALID', SELETORES)?.caminho_produto, '^/p/');
    for (const host of ['outra-loja.invalid', 'www.outra-loja.invalid.golpe.com', 'golpe.com', '', null]) {
      assert.equal(configuracaoPara(host, SELETORES), null, String(host));
      assert.equal(lojaDoHost(host, SELETORES), null);
    }

    const perfil = { versao: 2, programas: [{ programa_id: 'programa-alfa', clube_ativo: false }], cartoes: ['cartao-alfa'], valor_milheiro_brl: {} };
    assert.deepEqual(calcularSelo({ texto: 'R$ 1.299,00', indice: 0 }, 'www.outra-loja.invalid', perfil, DADOS, SELETORES, HOJE), {
      titulo: 'Melhor jeito: 2.598 pontos com Cartão Alfa Platinum',
      detalhe: 'no Programa Alfa · vale cerca de R$ 51,96',
    });
    // Sem perfil (ou perfil quebrado): todos os cartões, com aviso.
    for (const semPerfil of [undefined, null, 'lixo', { versao: 99 }]) {
      assert.equal(calcularSelo({ texto: 'R$ 1.299,00', indice: 0 }, 'www.outra-loja.invalid', semPerfil, DADOS, SELETORES, HOJE).titulo, 'Melhor jeito: 2.598 pontos com Cartão Alfa Platinum');
    }
    // Oferta de teste na loja-teste (Programa Alfa, válida em 10/11/2026), preço em atributo decimal.
    const comOferta = calcularSelo({ texto: '250.00', indice: 1 }, 'www.loja-teste.invalid', perfil, DADOS, SELETORES, HOJE);
    assert.match(comOferta.titulo, /^Melhor jeito: [\d.]+ pontos com Cartão Alfa Platinum$/);
    assert.match(comOferta.detalhe, /^com a oferta Programa Alfa/);
    // O formato vem do arquivo de seletores, não da página: texto de tela no seletor decimal é recusado.
    assert.equal(calcularSelo({ texto: 'R$ 250,00', indice: 1 }, 'www.loja-teste.invalid', perfil, DADOS, SELETORES, HOJE), null);

    for (const pedido of [null, 'R$ 1,00', { texto: 'R$ 1,00' }, { texto: 'R$ 1,00', indice: 9 }, { texto: 'R$ 1,00', indice: '0' }, { texto: 'R$ 0,00', indice: 0 }, { texto: 'abc', indice: 0 }]) {
      assert.equal(calcularSelo(pedido, 'www.outra-loja.invalid', perfil, DADOS, SELETORES, HOJE), null, JSON.stringify(pedido));
    }
    assert.equal(calcularSelo({ texto: 'R$ 1,00', indice: 0 }, 'www.golpe.com', perfil, DADOS, SELETORES, HOJE), null);
  });
});

// ---------------------------------------------------------------------------
// Segurança e privacidade (o que a política promete, conferido no código)

test('manifesto: permissões mínimas e CSP estrita', async () => {
  await comPacote({ conferir: true }, async (saida) => {
    const m = JSON.parse(await readFile(new URL('manifest.json', saida), 'utf8'));
    assert.equal(m.manifest_version, 3);
    assert.deepEqual(m.permissions, ['storage']);
    assert.equal(m.host_permissions, undefined);
    assert.equal(m.optional_permissions, undefined);
    assert.equal(m.optional_host_permissions, undefined);
    assert.equal(m.web_accessible_resources, undefined, 'a página da loja não enxerga arquivos da extensão');
    assert.equal(m.externally_connectable, undefined);
    const texto = JSON.stringify(m);
    assert.doesNotMatch(texto, /<all_urls>|\*:\/\/\*|https:\/\/\*\//);
    for (const site of m.content_scripts[0].matches) assert.match(site, /^https:\/\/[a-z0-9.-]+\/\*$/);
    assert.equal(m.content_scripts[0].all_frames, false);
    const csp = m.content_security_policy.extension_pages;
    for (const diretiva of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) {
      assert.ok(csp.includes(diretiva), diretiva);
    }
    assert.doesNotMatch(csp, /unsafe|https?:|\*/);
  });
});

test('código da extensão: sem rede, sem código remoto, sem HTML em texto, sem log', async () => {
  const pasta = new URL('extensao/fonte/', raiz);
  for (const nome of await readdir(pasta)) {
    if (!/\.(js|html)$/.test(nome)) continue;
    const codigo = await readFile(new URL(nome, pasta), 'utf8');
    assert.doesNotMatch(codigo, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|\bimport\s*\(/, `${nome}: rede ou código carregado em tempo de execução`);
    assert.doesNotMatch(codigo, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, `${nome}: HTML em texto ou eval`);
    assert.doesNotMatch(codigo, /console\.|debugger/, `${nome}: log`);
    assert.doesNotMatch(codigo, /https?:\/\//, `${nome}: endereço de internet no código`);
    assert.doesNotMatch(codigo, /document\.cookie|localStorage|location\.href\s*=|chrome\.(tabs|scripting|cookies|history|webRequest)/, `${nome}: API fora do necessário`);
  }
  const conteudo = await readFile(new URL('conteudo.js', pasta), 'utf8');
  assert.match(conteudo, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.match(conteudo, /\.textContent = String\(titulo\)/);
  // A página só manda o texto do preço e o número do seletor; nunca o endereço.
  for (const [, corpo] of conteudo.matchAll(/pedir\((\{[^}]*\})\)/g)) assert.doesNotMatch(corpo, /location|url|href|document/i);
});
