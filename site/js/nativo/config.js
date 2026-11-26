// Configuração do app instalado pelas lojas (Android e iOS, via Capacitor).
//
// ENDERECO_DO_SITE: de onde o app busca a lista de lojas e ofertas atualizada
// (dados/*.json, os mesmos arquivos públicos do site). Tem de ser igual ao
// URL_BASE de scripts/paginas/config.js (um teste confere). Quando o domínio
// milhasdavez.com.br estiver ligado, troque os dois juntos.
export const ENDERECO_DO_SITE = 'https://milhasdavez.pages.dev';

// Quanto o app espera o site responder antes de usar a cópia que veio dentro dele.
export const ESPERA_DOS_DADOS_MS = 6000;
