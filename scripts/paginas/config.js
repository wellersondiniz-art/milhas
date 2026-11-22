// Configuração das páginas geradas.
//
// URL_BASE: endereço público do site, sem barra no fim (ex.: "https://www.exemplo.com.br").
// O domínio ainda NÃO foi decidido, então fica "A_CONFIRMAR". Enquanto for assim,
// o gerador não escreve link canônico, og:url nem sitemap.xml (que exige endereço
// completo), e avisa no terminal.
//
// Para gerar com um endereço sem mexer aqui:
//   URL_DO_SITE=https://www.exemplo.com.br node scripts/gerar-paginas.js
//   node scripts/gerar-paginas.js --url-base https://www.exemplo.com.br
export const URL_BASE = 'A_CONFIRMAR';

export const NOME_DO_SITE = 'comprador de milhas';
