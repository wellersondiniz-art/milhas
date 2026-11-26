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
export const TEXTOS_ATUALIZADOS_EM = '2026-11-23';

// Canal de contato. Ainda não foi escolhido: com "A_CONFIRMAR", a página
// Contato diz que o canal está sendo preparado e o build avisa.
// Exemplo: export const EMAIL_DE_CONTATO = 'contato@milhasdavez.com.br';
export const EMAIL_DE_CONTATO = 'A_CONFIRMAR';

// ---------------------------------------------------------------------------
// Alertas por e-mail (servidor/alertas/, functions/api/alertas/, site/alertas/)

// Enquanto for false, nenhuma página leva para /alertas/ e a Privacidade não
// fala de alertas (porque o site não guarda e-mail). Só troque para true
// depois de configurar o Supabase, o Resend, a Cloudflare e o GitHub
// (README, seção "Alertas por e-mail") e de testar com um e-mail seu.
// Ao trocar, mude também TEXTOS_ATUALIZADOS_EM: a Privacidade muda.
export const ALERTAS_LIGADO = false;

// ---------------------------------------------------------------------------
// Plano pago (servidor/plano/, functions/api/plano/, scripts/paginas/plano.js)

// Enquanto for false, a página /plano/ não é gerada e a Privacidade e os
// Termos não falam de plano. Só troque para true depois de configurar o
// Stripe, a Cloudflare e o Supabase (README, seção "Plano pago"), de testar
// os quatro estados no modo de teste e de o advogado revisar os textos.
// Ao trocar, mude também TEXTOS_ATUALIZADOS_EM: a Privacidade e os Termos mudam.
export const PLANO_LIGADO = false;

// Preço por mês em centavos inteiros (990 = R$ 9,90), já com tributos.
export const PLANO_PRECO_CENTAVOS = 'A_CONFIRMAR';

// Link de pagamento do Stripe (Payment Link de assinatura mensal). No modo
// de teste começa com https://buy.stripe.com/test_
export const PLANO_LINK_PAGAMENTO = 'A_CONFIRMAR';

// Link de entrada do portal do cliente do Stripe (cancelar, trocar cartão,
// ver recibos). No modo de teste começa com https://billing.stripe.com/p/login/test_
export const PLANO_LINK_PORTAL = 'A_CONFIRMAR';

// false = modo de teste: o build recusa links que não sejam de teste. Só o
// dono do site troca para true, junto com PLANO_MODO_REAL=ligado na Cloudflare.
export const PLANO_MODO_REAL = false;

// Quem vende o plano (Decreto 7.962/2013, comércio pela internet): nome ou
// razão social, CPF ou CNPJ e endereço, que aparecem na página /plano/.
// Só o dono do site tem esses dados: preencha com o advogado e o contador
// (veja também a nota fiscal de serviço). Com algum "A_CONFIRMAR", o build
// RECUSA o modo real; no modo de teste, a página mostra que falta.
export const PLANO_VENDEDOR = { nome: 'A_CONFIRMAR', documento: 'A_CONFIRMAR', endereco: 'A_CONFIRMAR' };
