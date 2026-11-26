// Moldura comum das páginas geradas: <head>, topo, rodapé, alertas e a caixa
// "Palavras desta página". Usada pelas páginas de loja/ofertas (montar.js) e
// pelas páginas institucionais (institucionais.js). Funções puras.

import { NOME_DO_SITE } from './config.js';
import { h, jsonLd } from './html.js';

/** Páginas institucionais, na ordem do rodapé: [pasta, texto do link]. */
export const PAGINAS_DO_RODAPE = [
  ['como-funciona', 'Como funciona'],
  ['sobre-os-dados', 'Sobre os dados'],
  ['privacidade', 'Privacidade'],
  ['termos', 'Termos de uso'],
  ['contato', 'Contato'],
];

export function urlAbsoluta(urlBase, caminho) {
  return urlBase ? `${urlBase}/${caminho}` : null;
}

function cabecalho(raiz, atual) {
  const link = (href, texto, rota) => h('a', { class: 'topo__link', href, 'aria-current': rota === atual ? 'page' : null }, texto);
  return h('header', { class: 'topo' },
    h('div', { class: 'container topo__linha' },
      h('a', { class: 'topo__marca', href: raiz }, NOME_DO_SITE),
      h('nav', { class: 'topo__menu', 'aria-label': 'Principal' },
        link(raiz, 'Comparar', 'inicio'),
        link(`${raiz}ofertas/`, 'Ofertas', 'ofertas'),
        link(`${raiz}#/perfil`, 'Meu perfil', 'perfil'))));
}

export function rodape(raiz, atual = null) {
  return h('footer', { class: 'container rodape' },
    h('nav', { 'aria-label': 'Sobre o site' },
      h('ul', { class: 'rodape__links' }, PAGINAS_DO_RODAPE.map(([pasta, texto]) => h('li', {},
        h('a', { href: `${raiz}${pasta}/`, 'aria-current': pasta === atual ? 'page' : null }, texto))))),
    h('p', { class: 'texto-suave texto-pequeno' },
      'Não pedimos número de cartão nem CPF. Os números são estimativas a partir das regras publicadas pelas lojas e programas: confira sempre antes de comprar.'));
}

/**
 * Página completa. `atual` marca o link do topo (inicio, ofertas, perfil) ou
 * do rodapé (pasta da página institucional) como página atual.
 * `semIndexar` pede aos buscadores para não listar a página (rascunho).
 * `scripts`: arquivos do próprio site (ex.: 'js/produtos-validade.js'), como módulo.
 */
export function documento({ titulo, descricao, caminho, raiz, urlBase, atual, dadosEstruturados, principal, semIndexar = false, scripts = [] }) {
  const url = urlAbsoluta(urlBase, caminho);
  const og = (prop, valor) => h('meta', { property: prop, content: valor });
  return `<!doctype html>\n${h('html', { lang: 'pt-BR' },
    h('head', {},
      h('meta', { charset: 'utf-8' }),
      h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      h('title', {}, titulo),
      h('meta', { name: 'description', content: descricao }),
      semIndexar ? h('meta', { name: 'robots', content: 'noindex' }) : null,
      h('meta', { name: 'theme-color', content: '#1f6b3a' }),
      h('link', { rel: 'manifest', href: `${raiz}manifest.webmanifest` }),
      h('link', { rel: 'icon', href: `${raiz}img/icones/icone.svg`, type: 'image/svg+xml' }),
      h('link', { rel: 'apple-touch-icon', href: `${raiz}img/icones/apple-touch-icon.png` }),
      url ? h('link', { rel: 'canonical', href: url }) : null,
      og('og:type', 'website'),
      og('og:locale', 'pt_BR'),
      og('og:site_name', NOME_DO_SITE),
      og('og:title', titulo),
      og('og:description', descricao),
      url ? og('og:url', url) : null,
      h('meta', { name: 'twitter:card', content: 'summary' }),
      h('link', { rel: 'stylesheet', href: `${raiz}css/base.css` }),
      h('link', { rel: 'stylesheet', href: `${raiz}css/estilo.css` }),
      h('link', { rel: 'stylesheet', href: `${raiz}css/paginas.css` }),
      dadosEstruturados ? jsonLd(dadosEstruturados) : null,
      scripts.map((src) => h('script', { type: 'module', src: `${raiz}${src}` }))),
    h('body', {},
      h('a', { class: 'pular-para-conteudo', href: '#conteudo' }, 'Pular para o conteúdo'),
      cabecalho(raiz, atual),
      h('main', { id: 'conteudo', class: 'container pilha--lg' }, principal),
      rodape(raiz, atual)))}\n`;
}

export function alerta(tipo, icone, titulo, ...corpo) {
  return h('div', { class: `alerta alerta--${tipo}`, role: 'note' },
    h('span', { class: 'alerta__icone', 'aria-hidden': 'true' }, icone),
    h('div', { class: 'alerta__corpo' }, h('strong', { class: 'alerta__titulo' }, titulo), ...corpo));
}

const TERMOS = {
  milheiro: ['O que é milheiro?', 'É quanto valem 1.000 pontos ou milhas, em reais. Usamos uma estimativa média para dizer quanto os pontos valem; você pode trocar pelo seu valor em "Meu perfil".'],
  clube: ['O que é clube?', 'É uma assinatura mensal do programa de pontos. Quem assina costuma ganhar mais pontos por real nas lojas parceiras, às vezes só depois de algumas horas de assinatura.'],
  bonus: ['O que é bônus?', 'É uma porcentagem a mais de pontos que o programa dá por um tempo, por cima dos pontos normais.'],
};

/** Explica milheiro, clube e bônus quando a palavra aparece no texto da página. */
export function termosExplicados(htmlDaPagina) {
  const texto = htmlDaPagina.toString();
  const usados = [
    /milheiro/i.test(texto) && 'milheiro',
    /clube/i.test(texto) && 'clube',
    /bônus/i.test(texto) && 'bonus',
  ].filter(Boolean);
  if (!usados.length) return null;
  return h('section', { class: 'pilha--sm', 'aria-labelledby': 'termos-titulo' },
    h('h2', { id: 'termos-titulo', class: 'pagina__subtitulo' }, 'Palavras desta página'),
    usados.map((t) => h('details', { class: 'termo' },
      h('summary', {}, TERMOS[t][0]),
      h('p', { class: 'termo__texto' }, TERMOS[t][1]))));
}
