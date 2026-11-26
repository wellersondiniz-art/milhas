// App Android/iOS (Capacitor): ponte nativa, cofre do perfil, dados do site,
// montagem de app/www, ícones e configuração dos projetos nativos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { ponteNativa } from '../site/js/nativo/plataforma.js';
import { abrirArmazenamentoSeguro } from '../site/js/nativo/armazem-seguro.js';
import { buscarDadosDoApp } from '../site/js/nativo/dados.js';
import { ENDERECO_DO_SITE, ESPERA_DOS_DADOS_MS } from '../site/js/nativo/config.js';
import { abrirArmazem, CHAVE, CHAVE_V1 } from '../site/js/perfil/armazem.js';
import { URL_BASE } from '../scripts/paginas/config.js';
import { codificarPng, crc32, lerCabecalhoPng } from '../scripts/app/png.js';
import { colocarCsp, cspDoApp, cspDoSite, FORA_DO_APP, montarApp } from '../scripts/app/montar-app.js';
import { listaDeImagens, svgDaFrente } from '../scripts/app/gerar-imagens.js';

const raiz = new URL('../', import.meta.url);
const ler = (c) => readFile(new URL(c, raiz), 'utf8');

// ---------------------------------------------------------------------------
// Ponte nativa

const capValido = (extra = {}) => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    nativePromise: async () => ({}),
    PluginHeaders: [{ name: 'App' }, { name: 'SecureStorage' }],
    ...extra,
  },
});

test('ponteNativa: no navegador comum não há ponte', () => {
  assert.equal(ponteNativa({}), null);
  assert.equal(ponteNativa(undefined), null);
  assert.equal(ponteNativa({ Capacitor: {} }), null);
  assert.equal(ponteNativa(capValido({ isNativePlatform: () => false })), null);
});

test('ponteNativa: sem nativePromise ou sem o plugin do cofre, segue como site', () => {
  assert.equal(ponteNativa(capValido({ nativePromise: undefined })), null);
  assert.equal(ponteNativa(capValido({ PluginHeaders: [{ name: 'App' }] })), null);
  assert.equal(ponteNativa(capValido({ PluginHeaders: undefined })), null);
  assert.equal(ponteNativa(capValido({ isNativePlatform: () => { throw new Error('x'); } })), null);
});

test('ponteNativa: dentro do app devolve a ponte', () => {
  const janela = capValido();
  assert.equal(ponteNativa(janela), janela.Capacitor);
});

// ---------------------------------------------------------------------------
// Cofre do perfil

function ponteFalsa({ inicial = {}, falharLeitura = false, falharGravacao = false } = {}) {
  const cofre = new Map(Object.entries(inicial));
  const chamadas = [];
  return {
    cofre,
    chamadas,
    async nativePromise(plugin, metodo, opcoes) {
      chamadas.push({ plugin, metodo, opcoes });
      assert.equal(plugin, 'SecureStorage');
      if (metodo === 'internalGetItem') {
        if (falharLeitura) throw Object.assign(new Error('invalidData'), { code: 'invalidData' });
        return { data: cofre.has(opcoes.prefixedKey) ? cofre.get(opcoes.prefixedKey) : null };
      }
      if (falharGravacao) throw new Error('osError');
      if (metodo === 'internalSetItem') { cofre.set(opcoes.prefixedKey, opcoes.data); return {}; }
      if (metodo === 'internalRemoveItem') return { success: cofre.delete(opcoes.prefixedKey) };
      throw new Error(metodo);
    },
  };
}

test('cofre: lê o que já estava guardado ao abrir', async () => {
  const ponte = ponteFalsa({ inicial: { 'capacitor-storage_comprador-de-milhas:perfil': '{"versao":2}' } });
  const armazenamento = await abrirArmazenamentoSeguro(ponte, [CHAVE, CHAVE_V1]);
  assert.equal(armazenamento.getItem(CHAVE), '{"versao":2}');
  assert.equal(armazenamento.getItem(CHAVE_V1), null);
  assert.deepEqual(ponte.chamadas.map((c) => c.opcoes.sync), [false, false]);
});

test('cofre: grava só neste aparelho, sem iCloud, na ordem pedida; apagar tira do cofre', async () => {
  const ponte = ponteFalsa();
  const armazenamento = await abrirArmazenamentoSeguro(ponte, [CHAVE]);
  armazenamento.setItem(CHAVE, 'um');
  armazenamento.setItem(CHAVE, 'dois');
  assert.equal(armazenamento.getItem(CHAVE), 'dois', 'a leitura é imediata, sem esperar o cofre');
  await armazenamento.esperarGravacoes();
  assert.equal(ponte.cofre.get(`capacitor-storage_${CHAVE}`), 'dois');
  const gravacoes = ponte.chamadas.filter((c) => c.metodo === 'internalSetItem');
  assert.deepEqual(gravacoes.map((c) => c.opcoes.data), ['um', 'dois']);
  for (const g of gravacoes) {
    assert.equal(g.opcoes.access, 1);
    assert.equal(g.opcoes.sync, false);
  }
  armazenamento.removeItem(CHAVE);
  assert.equal(armazenamento.getItem(CHAVE), null);
  await armazenamento.esperarGravacoes();
  assert.equal(ponte.cofre.size, 0);
});

test('cofre: chave que não é do perfil (o teste do armazém) fica só na memória', async () => {
  const ponte = ponteFalsa();
  const armazenamento = await abrirArmazenamentoSeguro(ponte, [CHAVE]);
  armazenamento.setItem('comprador-de-milhas:teste', '1');
  assert.equal(armazenamento.getItem('comprador-de-milhas:teste'), '1');
  armazenamento.removeItem('comprador-de-milhas:teste');
  await armazenamento.esperarGravacoes();
  assert.deepEqual(ponte.chamadas.filter((c) => c.metodo !== 'internalGetItem'), []);
});

test('cofre: dado ilegível ou falha ao gravar não derrubam o app (avisa e segue)', async () => {
  const erros = [];
  const ilegivel = await abrirArmazenamentoSeguro(ponteFalsa({ falharLeitura: true }), [CHAVE], { aoFalhar: (e) => erros.push(e.message) });
  assert.equal(ilegivel.getItem(CHAVE), null);
  assert.deepEqual(erros, ['invalidData']);

  const semGravar = await abrirArmazenamentoSeguro(ponteFalsa({ falharGravacao: true }), [CHAVE], { aoFalhar: (e) => erros.push(e.message) });
  semGravar.setItem(CHAVE, 'x');
  semGravar.setItem(CHAVE, 'y'); // a fila continua depois de uma falha
  await semGravar.esperarGravacoes();
  assert.equal(semGravar.getItem(CHAVE), 'y');
  assert.deepEqual(erros, ['invalidData', 'osError', 'osError']);

  // Sem aoFalhar, a falha é engolida em silêncio.
  const calado = await abrirArmazenamentoSeguro(ponteFalsa({ falharLeitura: true, falharGravacao: true }), [CHAVE]);
  calado.setItem(CHAVE, 'z');
  await calado.esperarGravacoes();
});

test('cofre + armazém do perfil: salvar, ler de novo ao reabrir e apagar', async () => {
  const ponte = ponteFalsa();
  const perfil = { versao: 2, programas: [], cartoes: [] };
  const primeiro = abrirArmazem(await abrirArmazenamentoSeguro(ponte, [CHAVE, CHAVE_V1]));
  assert.equal(primeiro.emMemoria, false);
  assert.equal(primeiro.salvar(perfil), true);
  await new Promise((r) => setTimeout(r, 0));
  const reaberto = abrirArmazem(await abrirArmazenamentoSeguro(ponte, [CHAVE, CHAVE_V1]));
  assert.equal(reaberto.temAlgo(), true);
  reaberto.apagar();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ponte.cofre.size, 0);
});

// ---------------------------------------------------------------------------
// Dados: site primeiro, cópia do app como reserva

function respostaFalsa(ok, origem) { return { ok, origem }; }

test('dados do app: usa o site quando ele responde, sem cookie', async () => {
  const pedidos = [];
  const buscar = async (url, opcoes) => { pedidos.push({ url, opcoes }); return respostaFalsa(true, 'site'); };
  const { resposta, doSite } = await buscarDadosDoApp('lojas', { buscar, endereco: 'https://exemplo.com.br', espera: 1000 });
  assert.equal(doSite, true);
  assert.equal(resposta.origem, 'site');
  assert.equal(pedidos[0].url, 'https://exemplo.com.br/dados/lojas.json');
  assert.equal(pedidos[0].opcoes.credentials, 'omit');
  assert.equal(pedidos.length, 1);
});

test('dados do app: site com erro, fora do ar ou lento → cópia de dentro do app', async () => {
  const cenarios = {
    erro: async (url) => (url.startsWith('https') ? respostaFalsa(false, 'site') : respostaFalsa(true, 'app')),
    fora: async (url) => { if (url.startsWith('https')) throw new TypeError('Failed to fetch'); return respostaFalsa(true, 'app'); },
    lento: (url, { signal }) => (url.startsWith('https')
      ? new Promise((_, falha) => signal.addEventListener('abort', () => falha(new Error('abortado'))))
      : Promise.resolve(respostaFalsa(true, 'app'))),
  };
  for (const [nome, buscar] of Object.entries(cenarios)) {
    const { resposta, doSite } = await buscarDadosDoApp('ofertas', { buscar, endereco: 'https://exemplo.com.br', espera: 5 });
    assert.equal(doSite, false, nome);
    assert.equal(resposta.origem, 'app', nome);
  }
});

test('o endereço dos dados do app é o mesmo endereço do site (URL_BASE) e a espera é curta', () => {
  assert.equal(ENDERECO_DO_SITE, URL_BASE);
  assert.ok(ESPERA_DOS_DADOS_MS >= 2000 && ESPERA_DOS_DADOS_MS <= 10000);
});

test('_headers deixa o app ler só os dados públicos (CORS em /dados/*)', async () => {
  const headers = await ler('site/_headers');
  assert.match(headers, /^\/dados\/\*\n {2}Access-Control-Allow-Origin: \*$/m);
  assert.equal(headers.match(/Access-Control-Allow-Origin/g).length, 1, 'CORS só nos dados');
});

// ---------------------------------------------------------------------------
// Montagem de app/www

const CSP_SITE = "default-src 'self'; script-src 'self'; style-src 'self' 'sha256-abc='; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

test('cspDoSite lê a CSP do _headers e reclama se não houver', () => {
  assert.equal(cspDoSite(`/*\n  Content-Security-Policy: ${CSP_SITE}\n  X-Frame-Options: DENY\n`), CSP_SITE);
  assert.throws(() => cspDoSite('/*\n  X-Frame-Options: DENY\n'), /sem Content-Security-Policy/);
});

test('cspDoApp: tira o que não vale em <meta>, libera só o site no connect-src', () => {
  const csp = cspDoApp(CSP_SITE, 'https://milhasdavez.pages.dev');
  assert.equal(csp, "default-src 'self'; script-src 'self'; style-src 'self' 'sha256-abc='; connect-src 'self' https://milhasdavez.pages.dev; upgrade-insecure-requests");
  assert.match(cspDoApp("default-src 'self'", 'https://a.com.br'), /connect-src 'self' https:\/\/a\.com\.br$/);
  for (const ruim of ['http://a.com.br', 'https://a.com.br/pasta', 'https://a.com.br/?x=1', 'https://a.com.br/#x']) {
    assert.throws(() => cspDoApp(CSP_SITE, ruim), /inválido/, ruim);
  }
});

test('colocarCsp põe a <meta> logo depois do charset, antes de estilo e script', () => {
  const html = '<!doctype html><html><head>\n<meta charset="utf-8">\n<style>a{}</style><script src="x.js"></script></head></html>';
  const saida = colocarCsp(html, `default-src 'self'; x "y"`);
  const posMeta = saida.indexOf('http-equiv="Content-Security-Policy"');
  assert.ok(posMeta > saida.indexOf('charset') && posMeta < saida.indexOf('<style>'));
  assert.match(saida, /content="default-src 'self'; x &quot;y&quot;"/);
  assert.throws(() => colocarCsp(saida, 'x'), /já tem CSP/);
  assert.throws(() => colocarCsp('<html><head></head></html>', 'x'), /sem <meta charset/);
});

test('montarApp copia o site sem o que é de servidor e põe CSP em todas as páginas', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'montar-app-'));
  try {
    const origem = join(temp, 'dist');
    await mkdir(join(origem, 'loja', 'x'), { recursive: true });
    await writeFile(join(origem, '_headers'), `/*\n  Content-Security-Policy: ${CSP_SITE}\n`);
    for (const f of FORA_DO_APP.filter((f) => f !== '_headers')) await writeFile(join(origem, f), 'x');
    await writeFile(join(origem, 'index.html'), '<head><meta charset="utf-8"></head>');
    await writeFile(join(origem, 'loja', 'x', 'index.html'), '<head><meta charset="utf-8"></head>');
    await writeFile(join(origem, 'app.js'), '1');
    const destino = join(temp, 'www');
    const paginas = await montarApp(pathToFileURL(`${destino}/`), pathToFileURL(`${origem}/`));
    assert.equal(paginas, 2);
    assert.deepEqual((await readdir(destino)).sort(), ['app.js', 'index.html', 'loja']);
    assert.match(await readFile(join(destino, 'loja', 'x', 'index.html'), 'utf8'), /connect-src 'self' https:\/\/milhasdavez\.pages\.dev/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PNG e imagens do app

test('PNG: cabeçalho, CRC e pixels batem (com e sem transparência)', () => {
  assert.equal(crc32(Buffer.from('IEND')), 0xae426082);
  const pixels = [255, 0, 0, 255, 0, 255, 0, 128];
  for (const alfa of [true, false]) {
    const png = codificarPng(2, 1, pixels, { alfa });
    assert.deepEqual(lerCabecalhoPng(png), { largura: 2, altura: 1, tipoDeCor: alfa ? 6 : 2 });
    const inicioIdat = png.indexOf('IDAT') + 4;
    const tamanho = png.readUInt32BE(inicioIdat - 8);
    const cru = inflateSync(png.subarray(inicioIdat, inicioIdat + tamanho));
    assert.deepEqual([...cru], alfa ? [0, ...pixels] : [0, 255, 0, 0, 0, 255, 0]);
  }
  assert.throws(() => codificarPng(2, 2, pixels), /não bate/);
  assert.throws(() => lerCabecalhoPng(Buffer.alloc(32)), /não é PNG/);
});

test('ícones e aberturas gerados existem com o tamanho certo; o da App Store não tem transparência', async () => {
  const lista = listaDeImagens();
  assert.equal(lista.length, 30);
  for (const item of lista) {
    const cab = lerCabecalhoPng(await readFile(new URL(item.caminho, raiz)));
    assert.deepEqual([cab.largura, cab.altura], [item.largura, item.altura], item.caminho);
    assert.equal(cab.tipoDeCor, item.alfa ? 6 : 2, item.caminho);
  }
  const appStore = lista.find((i) => i.caminho.endsWith('AppIcon-512@2x.png'));
  assert.deepEqual([appStore.largura, appStore.alfa], [1024, false]);
});

test('a frente do ícone adaptável é o ícone mascarável sem o fundo verde', async () => {
  const mascaravel = await ler('site/img/icones/icone-maskable.svg');
  const frente = svgDaFrente(mascaravel);
  assert.doesNotMatch(frente, /<rect/);
  assert.match(frente, /<circle/);
  assert.throws(() => svgDaFrente('<svg></svg>'), /não achei o <rect>/);
});

// ---------------------------------------------------------------------------
// Configuração dos projetos nativos

test('capacitor.config.json: id do app, pasta do app e depuração desligada', async () => {
  const config = JSON.parse(await ler('capacitor.config.json'));
  assert.equal(config.appId, 'br.com.milhasdavez.app');
  assert.equal(config.appName, 'Milhas da Vez');
  assert.equal(config.webDir, 'app/www');
  assert.equal(config.server, undefined, 'o app não carrega o site de fora (server.url): usa os arquivos de dentro dele');
  assert.equal(config.android.webContentsDebuggingEnabled, false);
  assert.equal(config.android.allowMixedContent, false);
  assert.equal(config.ios.webContentsDebuggingEnabled, false);
  assert.equal(config.plugins.CapacitorHttp.enabled, false);
  assert.equal(config.plugins.CapacitorCookies.enabled, false);
});

test('Android: sem backup do perfil, sem HTTP sem criptografia, só a permissão de internet', async () => {
  const manifesto = await ler('app/android/app/src/main/AndroidManifest.xml');
  assert.match(manifesto, /android:allowBackup="false"/);
  assert.match(manifesto, /android:dataExtractionRules="@xml\/regras_de_backup"/);
  assert.match(manifesto, /android:usesCleartextTraffic="false"/);
  assert.deepEqual([...manifesto.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]), ['android.permission.INTERNET']);
  const regras = await ler('app/android/app/src/main/res/xml/regras_de_backup.xml');
  assert.match(regras, /<cloud-backup>[\s\S]*domain="sharedpref"[\s\S]*<\/cloud-backup>/);
  assert.match(regras, /<device-transfer>[\s\S]*domain="sharedpref"[\s\S]*<\/device-transfer>/);
});

test('Android: a assinatura vem de variáveis de ambiente, nunca de arquivo no repositório', async () => {
  const gradle = await ler('app/android/app/build.gradle');
  assert.match(gradle, /System\.getenv\('ANDROID_CHAVE_ARQUIVO'\)/);
  assert.doesNotMatch(gradle, /storePassword\s+["']/);
  assert.doesNotMatch(gradle, /keyPassword\s+["']/);
});

test('iOS: português, sem criptografia própria (só a do sistema) e mesmo id do app', async () => {
  const plist = await ler('app/ios/App/App/Info.plist');
  assert.match(plist, /<key>CFBundleDevelopmentRegion<\/key>\s*<string>pt-BR<\/string>/);
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>Milhas da Vez<\/string>/);
  const projeto = await ler('app/ios/App/App.xcodeproj/project.pbxproj');
  assert.equal([...projeto.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].every((m) => m[1] === 'br.com.milhasdavez.app'), true);
  assert.doesNotMatch(projeto, /DEVELOPMENT_TEAM = [A-Z0-9]{10}/, 'o Team ID entra só no envio, pelo segredo');
});

test('nenhuma chave de assinatura no repositório e o .gitignore barra os formatos', async () => {
  const gitignore = await ler('.gitignore');
  for (const padrao of ['*.jks', '*.keystore', '*.p12', '*.p8', '*.mobileprovision', 'keystore.properties', 'app/www/']) {
    assert.ok(gitignore.split('\n').includes(padrao), `falta ${padrao} no .gitignore`);
  }
  const arquivos = execFileSync('git', ['ls-files'], { cwd: new URL('.', raiz), encoding: 'utf8' }).split('\n');
  const proibidos = arquivos.filter((a) => /\.(jks|keystore|p12|p8|pem|mobileprovision|provisionprofile|aab|apk|ipa)$|keystore\.properties$|google-services\.json$|GoogleService-Info\.plist$/.test(a));
  assert.deepEqual(proibidos, []);
});

test('o workflow de publicação só roda à mão e os segredos só entram nos passos que assinam', async () => {
  const fluxo = await ler('.github/workflows/app-publicar.yml');
  assert.match(fluxo, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(fluxo, /^ {2}(push|pull_request)/m);
  assert.equal((fluxo.match(/environment: lojas/g) || []).length, 2);
  for (const linha of fluxo.split('\n').filter((l) => l.includes('secrets.'))) {
    assert.match(linha, /^ {10}[A-Z0-9_]+: \$\{\{ secrets\.[A-Z0-9_]+ \}\}$/, `segredo fora de env: ${linha}`);
  }
  const verificacao = await ler('.github/workflows/app.yml');
  assert.doesNotMatch(verificacao, /secrets\./);
});

// ---------------------------------------------------------------------------
// Privacidade: a página diz o que o app faz de verdade

test('Privacidade fala do app: cofre do sistema, sem backup, só a lista pública vem do site', async () => {
  const { paginasInstitucionais } = await import('../scripts/paginas/institucionais.js');
  const { paginas } = paginasInstitucionais({ urlBase: 'https://exemplo.com.br' });
  const html = paginas.find((p) => p.caminho === 'privacidade/index.html').conteudo;
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
  assert.match(texto, /No app para Android e iPhone/);
  assert.match(texto, /Keychain/);
  assert.match(texto, /não entra no backup/);
  assert.match(texto, /lista pública de lojas e ofertas/);
  assert.match(texto, /não pede acesso a câmera, localização, contatos, fotos ou notificações/);
  // O que o texto promete, o app cumpre: só a permissão de internet e a CSP só libera o site.
  const manifesto = await ler('app/android/app/src/main/AndroidManifest.xml');
  assert.doesNotMatch(manifesto, /CAMERA|LOCATION|CONTACTS|MEDIA_IMAGES|POST_NOTIFICATIONS/);
  assert.doesNotMatch(await ler('app/ios/App/App/Info.plist'), /UsageDescription/);
});
