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

export const NOME_DO_SITE = 'Milhas da Vez';

// ---------------------------------------------------------------------------
// Páginas institucionais (scripts/paginas/institucionais.js)

// REVISÃO JURÍDICA: os textos de Como funciona, Sobre os dados, Privacidade,
// Termos de uso e Contato ainda NÃO foram revisados por um advogado.
// Enquanto isto for true, cada uma dessas páginas mostra no topo o aviso
// "Texto em revisão", não entra no sitemap.xml, pede aos buscadores para não
// listar (noindex) e o build avisa. Só troque para false depois que um
// advogado revisar e aprovar os textos.
export const REVISAO_JURIDICA_PENDENTE = true;

// Data da última mudança nos textos das páginas institucionais (AAAA-MM-DD).
// Troque sempre que mudar o que essas páginas dizem.
export const TEXTOS_ATUALIZADOS_EM = '2026-11-24';

// Canal de contato. Ainda não foi escolhido: com "A_CONFIRMAR", a página
// Contato diz que o canal está sendo preparado e o build avisa.
// Exemplo: export const EMAIL_DE_CONTATO = 'contato@milhasdavez.com.br';
export const EMAIL_DE_CONTATO = 'A_CONFIRMAR';

// Quem responde pelos dados (o "controlador", na LGPD). A Privacidade precisa
// dizer o nome (ou razão social) e o CNPJ ou CPF de quem cuida do site.
// Só o dono do site sabe e decide isso: preencha depois de falar com o
// advogado. Com "A_CONFIRMAR", a Privacidade mostra um aviso de que falta essa
// informação e o build avisa.
// Exemplo: export const RESPONSAVEL_PELOS_DADOS = { nome: 'Fulano de Tal ME', documento: 'CNPJ 00.000.000/0001-00' };
export const RESPONSAVEL_PELOS_DADOS = { nome: 'A_CONFIRMAR', documento: 'A_CONFIRMAR' };
