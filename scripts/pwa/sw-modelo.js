// Service worker do site (feito à mão, sem biblioteca).
//
// Este arquivo é um MODELO. O build (scripts/gerar-sw.js) troca __VERSAO__ e
// __ARQUIVOS_DO_APP__ e grava o resultado em site/sw.js (fora do Git).
// A versão é um resumo do conteúdo dos arquivos do app: mudou um arquivo,
// muda a versão, e o navegador acha a versão nova sozinho.
//
// O que fica guardado no aparelho (e mais nada):
//   1. App (shell): os arquivos de VERSAO. Cache primeiro. Troca inteiro quando
//      a pessoa toca em "Atualizar agora" (nunca à força).
//   2. Dados (dados/*.json): cache primeiro, atualiza em segundo plano.
//      Cada cópia guarda a hora em que foi salva (cabeçalho X-Salvo-Em).
//   3. Páginas por loja e de ofertas (loja/..., ofertas/, onde-rende-mais/): rede primeiro,
//      cópia guardada só para quando estiver sem internet.
//
// Privacidade: o perfil da pessoa mora no localStorage, que um service worker
// nem consegue ler. Mesmo assim, só entram no cache os endereços da lista
// acima; qualquer outro pedido passa direto, sem cópia. Nada com "perfil" no
// endereço, nada com resposta "no-store", nada de outro site, nada que não
// seja GET.

const VERSAO = '__VERSAO__';
const ARQUIVOS_DO_APP = __ARQUIVOS_DO_APP__;

const PREFIXO = 'milhas-';
const CACHE_APP = `${PREFIXO}app-${VERSAO}`;
const CACHE_PAGINAS = `${PREFIXO}paginas-${VERSAO}`;
const CACHE_DADOS = `${PREFIXO}dados`;
const PAGINA_SEM_INTERNET = 'offline.html';

const ESCOPO = new URL(self.registration ? self.registration.scope : self.location.href);

/** Endereço completo de um arquivo do site ("index.html" → "https://.../index.html"). */
const noSite = (arquivo) => new URL(arquivo, ESCOPO).href;

/** Caminho relativo à raiz do site ("", "index.html", "dados/lojas.json"...). */
function caminhoRelativo(url) {
  const base = ESCOPO.pathname;
  return url.pathname.startsWith(base) ? url.pathname.slice(base.length) : null;
}

/**
 * Que tipo de pedido é este. Função pura: só olha o pedido.
 * Devolve 'app', 'dados', 'pagina' ou 'ignorar' (passa direto, sem cache).
 */
function classificar(metodo, enderecoTexto, modo) {
  if (metodo !== 'GET') return 'ignorar';
  let url;
  try { url = new URL(enderecoTexto); } catch { return 'ignorar'; }
  if (url.origin !== ESCOPO.origin) return 'ignorar';
  const caminho = caminhoRelativo(url);
  if (caminho === null) return 'ignorar';
  // Os arquivos do app são código fixo, iguais para todo mundo (inclusive
  // js/perfil/*.js, que é o código da tela, não os dados de ninguém).
  if (ARQUIVOS_DO_APP.includes(caminho) && !url.search) return 'app';
  // Trava extra de privacidade: fora isso, nada que fale de perfil vai para o cache.
  if (/perfil/i.test(caminho) || /perfil/i.test(url.search)) return 'ignorar';
  if (caminho === 'sw.js') return 'ignorar';
  if (/^dados\/[a-z0-9-]+\.json$/.test(caminho)) return url.search ? 'ignorar' : 'dados';
  if (caminho === '' || caminho === 'index.html') return 'app';
  if (modo === 'navigate' && /^(loja\/[a-z0-9-]+\/|ofertas\/|abastecer\/|onde-rende-mais\/|viagens\/)(index\.html)?$/.test(caminho)) return 'pagina';
  return 'ignorar';
}

/** Resposta que pode ir para o cache: deste site, completa e sem "no-store". */
function podeGuardar(resposta) {
  if (!resposta || resposta.status !== 200 || resposta.type !== 'basic') return false;
  const controle = resposta.headers.get('Cache-Control') || '';
  return !/no-store|private/i.test(controle);
}

/** Cópia da resposta com a hora em que foi salva. */
async function comHoraSalva(resposta, agora) {
  const cabecalhos = new Headers(resposta.headers);
  cabecalhos.set('X-Salvo-Em', agora.toISOString());
  const corpo = await resposta.blob();
  return new Response(corpo, { status: resposta.status, statusText: resposta.statusText, headers: cabecalhos });
}

function avisarPagina(clienteId, mensagem) {
  if (!clienteId) return Promise.resolve();
  return self.clients.get(clienteId).then((cliente) => { if (cliente) cliente.postMessage(mensagem); });
}

// ---------------------------------------------------------------------------
// Instalar: guarda o app inteiro. Não pula a espera: quem decide é a pessoa.

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_APP).then((cache) => cache.addAll(ARQUIVOS_DO_APP.map((a) => new Request(noSite(a), { cache: 'reload' })))),
  );
});

// Ativar: apaga caches de versões antigas. O de dados fica (não tem versão).
self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const nomes = await caches.keys();
    const manter = new Set([CACHE_APP, CACHE_PAGINAS, CACHE_DADOS]);
    await Promise.all(nomes.filter((n) => n.startsWith(PREFIXO) && !manter.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// A página pede para trocar de versão quando a pessoa toca em "Atualizar agora".
self.addEventListener('message', (evento) => {
  const tipo = evento.data && evento.data.tipo;
  if (tipo === 'atualizar-agora') self.skipWaiting();
  if (tipo === 'qual-versao' && evento.source) evento.source.postMessage({ tipo: 'versao', versao: VERSAO });
});

// ---------------------------------------------------------------------------
// Estratégias

async function doApp(pedido) {
  const cache = await caches.open(CACHE_APP);
  const url = new URL(pedido.url);
  const navegando = pedido.mode === 'navigate';
  // "/", "/index.html" e "/?loja=magalu" abrem o mesmo index.html guardado.
  const chave = navegando || caminhoRelativo(url) === '' ? noSite('index.html') : pedido;
  const guardado = await cache.match(chave, { ignoreSearch: navegando });
  if (guardado) return guardado;
  return fetch(pedido);
}

async function dosDados(pedido, clienteId, esperar) {
  const cache = await caches.open(CACHE_DADOS);
  const guardado = await cache.match(pedido);
  const buscar = fetch(pedido.url, { cache: 'no-cache' }).then(async (resposta) => {
    if (podeGuardar(resposta)) await cache.put(pedido.url, await comHoraSalva(resposta.clone(), new Date()));
    return resposta;
  });
  if (guardado) {
    // Cache primeiro; a cópia nova fica para a próxima vez.
    esperar(buscar.catch(() => avisarPagina(clienteId, {
      tipo: 'dados-sem-rede',
      salvoEm: guardado.headers.get('X-Salvo-Em'),
    })));
    return guardado;
  }
  return buscar;
}

async function daPagina(pedido) {
  const cache = await caches.open(CACHE_PAGINAS);
  try {
    const resposta = await fetch(pedido);
    if (podeGuardar(resposta)) await cache.put(pedido.url, resposta.clone());
    return resposta;
  } catch (erro) {
    const guardado = await cache.match(pedido.url, { ignoreSearch: true });
    if (guardado) return guardado;
    const semInternet = await caches.match(noSite(PAGINA_SEM_INTERNET), { cacheName: CACHE_APP });
    if (semInternet) return semInternet;
    throw erro;
  }
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  const tipo = classificar(pedido.method, pedido.url, pedido.mode);
  if (tipo === 'ignorar') return; // o navegador busca sozinho, sem cache nosso
  const esperar = (promessa) => evento.waitUntil(promessa);
  if (tipo === 'app') evento.respondWith(doApp(pedido));
  else if (tipo === 'dados') evento.respondWith(dosDados(pedido, evento.clientId, esperar));
  else if (tipo === 'pagina') evento.respondWith(daPagina(pedido));
});
