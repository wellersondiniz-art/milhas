// Configuração das páginas geradas.
//
// URL_BASE: endereço público do site, sem barra no fim. Entra no link canônico,
// no og:url, no JSON-LD, no sitemap.xml e no robots.txt.
//
// Por enquanto é o endereço gratuito da Cloudflare Pages. Ele só funciona se o
// projeto na Cloudflare Pages se chamar exatamente "milhasdavez".
// Quando o domínio milhasdavez.com.br for comprado e ligado ao projeto, troque
// esta linha por: export const URL_BASE = 'https://milhasdavez.com.br';
//
// Para gerar com outro endereço sem mexer aqui:
//   URL_DO_SITE=https://outro.exemplo node scripts/gerar-paginas.js
//   node scripts/gerar-paginas.js --url-base https://outro.exemplo
// "A_CONFIRMAR" desliga canônico, og:url e sitemap.
export const URL_BASE = 'https://milhasdavez.pages.dev';

export const NOME_DO_SITE = 'comprador de milhas';
