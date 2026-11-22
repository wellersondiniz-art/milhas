// Métricas simples e sem cookie, enviadas ao Plausible.
//
// Regras (o teste testes/metricas.test.mjs confere):
// - Nenhum script de terceiro: o próprio site manda o evento com fetch para o
//   endereço de ENDERECO_DE_ENVIO (a "Events API" do Plausible).
// - Nenhum cookie, nada no localStorage, nenhum identificador da pessoa.
// - Só eventos da lista EVENTOS, só com as propriedades listadas em cada um, e
//   cada valor tem de ser um código curto (letras minúsculas, números, ponto e
//   hífen): id de loja, nome de site. Valor da compra, cartões, programas e
//   qualquer texto digitado não cabem nesse formato. Se algo não bate, o
//   evento inteiro é descartado.
// - O endereço vai sem o que vem depois de "?" e de "#".
// - Quem pede para não ser rastreado (Global Privacy Control ou Do Not Track)
//   não é medido.
// - A página Privacidade lista as descrições de EVENTOS: o texto acompanha o código.

import { DOMINIO_NO_PLAUSIBLE, ENDERECO_DE_ENVIO } from './config.js';

const A_CONFIRMAR = 'A_CONFIRMAR';

/** O que é medido. `descricao` aparece na página Privacidade. */
export const EVENTOS = {
  busca_loja: {
    propriedades: ['loja', 'origem'],
    descricao: 'qual loja foi escolhida na calculadora ou qual página de loja foi aberta',
  },
  calculo: {
    propriedades: ['loja'],
    descricao: 'que uma conta foi feita e em qual loja (sem o valor da compra)',
  },
  clique_saida: {
    propriedades: ['destino', 'pagina', 'loja'],
    descricao: 'cliques em links para outros sites: só o nome do site de destino (como amazon.com.br) e em qual parte do nosso site estava o link',
  },
  instalacao: {
    propriedades: [],
    descricao: 'que o app foi instalado no aparelho',
  },
  oferta_vencida_vista: {
    propriedades: ['loja', 'pagina'],
    descricao: 'que uma oferta que já acabou apareceu na tela, para a gente saber o que atualizar primeiro',
  },
};

const VALOR_PERMITIDO = /^[a-z0-9][a-z0-9.-]{0,62}$/;

/** Endereço sem "?…" e sem "#…". */
export function limparUrl(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

/** Corpo do evento para o Plausible, ou null se algo não for permitido. */
export function montarEvento(nome, propriedades, { url, dominio }) {
  if (!Object.hasOwn(EVENTOS, nome)) return null;
  const permitidas = EVENTOS[nome].propriedades;
  const p = {};
  for (const [chave, valor] of Object.entries(propriedades ?? {})) {
    if (valor === undefined || valor === null) continue;
    if (!permitidas.includes(chave)) return null;
    if (typeof valor !== 'string' || !VALOR_PERMITIDO.test(valor)) return null;
    p[chave] = valor;
  }
  const corpo = { n: nome, u: limparUrl(url), d: dominio };
  if (Object.keys(p).length) corpo.p = p;
  return corpo;
}

/** Medir só no endereço do site no ar, com o Plausible configurado, e sem pedido de não rastrear. */
export function podeMedir({ dominio, hostname, navegador }) {
  if (!dominio || dominio === A_CONFIRMAR) return false;
  if (hostname !== dominio) return false;
  if (navegador?.globalPrivacyControl === true) return false;
  if (navegador?.doNotTrack === '1') return false;
  return true;
}

export function metricasLigadas(dominio = DOMINIO_NO_PLAUSIBLE) {
  return Boolean(dominio) && dominio !== A_CONFIRMAR;
}

/**
 * Cria o registrador. `registrar(nome, propriedades, { umaVez })` devolve
 * true quando mandou. Falha de rede é ignorada: a métrica nunca atrapalha o site.
 */
export function criarMetricas({
  dominio = DOMINIO_NO_PLAUSIBLE,
  endereco = ENDERECO_DE_ENVIO,
  janela = globalThis.window,
  enviar,
} = {}) {
  const ligada = Boolean(janela) && podeMedir({ dominio, hostname: janela.location.hostname, navegador: janela.navigator });
  const mandar = enviar ?? ((corpo) => janela.fetch(endereco, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(corpo),
    keepalive: true,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  }));
  const enviados = new Set();
  return {
    ligada,
    registrar(nome, propriedades = {}, { umaVez = false } = {}) {
      if (!ligada) return false;
      const corpo = montarEvento(nome, propriedades, { url: janela.location.href, dominio });
      if (!corpo) return false;
      if (umaVez) {
        const chave = JSON.stringify(corpo);
        if (enviados.has(chave)) return false;
        enviados.add(chave);
      }
      try {
        Promise.resolve(mandar(corpo)).catch(() => {});
      } catch { /* sem rede ou bloqueado: segue sem medir */ }
      return true;
    },
  };
}

/** Em qual parte do site o caminho está: inicio, loja, ofertas ou outra. */
export function paginaDoCaminho(caminho) {
  if (/\/loja\/[^/]+\/(index\.html)?$/.test(caminho)) return 'loja';
  if (/\/ofertas\/(index\.html)?$/.test(caminho)) return 'ofertas';
  if (/^\/(index\.html)?$/.test(caminho)) return 'inicio';
  return 'outra';
}

/** Id da loja numa página /loja/<id>/, ou null. */
export function lojaDoCaminho(caminho) {
  const m = /\/loja\/([^/]+)\/(index\.html)?$/.exec(caminho);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Site de destino de um link para fora, sem "www.", ou null se o link é daqui ou não é http(s). */
export function destinoDoLink(href, origemDoSite) {
  let u;
  try { u = new URL(href, origemDoSite); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.origin === origemDoSite) return null;
  return u.hostname.replace(/^www\./, '');
}

/** Conta cliques (e toques) em links para outros sites. `loja()` diz a loja do momento, se houver. */
export function observarCliquesDeSaida({ janela = globalThis.window, metricas, pagina, loja = () => null }) {
  if (!metricas.ligada) return;
  const aoClicar = (evento) => {
    if (evento.type === 'auxclick' && evento.button !== 1) return;
    const link = evento.target?.closest?.('a[href]');
    if (!link) return;
    const destino = destinoDoLink(link.getAttribute('href'), janela.location.origin);
    if (destino) metricas.registrar('clique_saida', { destino, pagina, loja: loja() ?? undefined });
  };
  janela.document.addEventListener('click', aoClicar, true);
  janela.document.addEventListener('auxclick', aoClicar, true);
}

/** Avisa quando o app é instalado (Chrome e Android; o Safari não avisa). */
export function observarInstalacao({ janela = globalThis.window, metricas }) {
  if (!metricas.ligada) return;
  janela.addEventListener('appinstalled', () => metricas.registrar('instalacao', {}, { umaVez: true }));
}

// Onde as ofertas que já acabaram aparecem: a seção "Histórico" das páginas
// de loja e de ofertas (PR do ciclo de vida das ofertas).
export const SELETOR_OFERTAS_VENCIDAS = '[aria-labelledby="historico-titulo"]';

/** Conta uma vez por página quando a lista de ofertas vencidas aparece na tela. */
export function observarOfertasVencidas({ janela = globalThis.window, metricas, pagina, loja = null }) {
  if (!metricas.ligada) return;
  const secao = janela.document.querySelector(SELETOR_OFERTAS_VENCIDAS);
  if (!secao) return;
  const registrar = () => metricas.registrar('oferta_vencida_vista', { pagina, loja: loja ?? undefined }, { umaVez: true });
  if (typeof janela.IntersectionObserver !== 'function') { registrar(); return; }
  const observador = new janela.IntersectionObserver((entradas) => {
    if (entradas.some((e) => e.isIntersecting)) {
      observador.disconnect();
      registrar();
    }
  });
  observador.observe(secao);
}
