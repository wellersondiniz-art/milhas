// Liga o botão "Essa informação está errada?" em cada resultado.
//
// Deixe false até a função /api/reportar estar configurada na Cloudflare
// (segredo GITHUB_TOKEN, variável REPORTES_REPO e KV REPORTES_LIMITE; passo a
// passo no README, seção "Avisos de erro (reportes)"). Com false, o botão não
// aparece e a página Privacidade não fala de reportes.
export const REPORTE_LIGADO = false;

/** Endereço da função, no mesmo site (a CSP só deixa connect-src 'self'). */
export const ENDERECO_DO_REPORTE = '/api/reportar';
