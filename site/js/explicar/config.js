// Liga o botão "Explica pra mim" embaixo do resultado.
//
// Deixe false até a função /api/explicar estar configurada na Cloudflare
// (segredo ANTHROPIC_API_KEY e KV EXPLICAR_LIMITE; passo a passo no README,
// seção "Explica pra mim") E até o advogado revisar o trecho novo de
// Privacidade e Termos. Com false, o botão não aparece e as páginas
// Privacidade e Termos não falam dele.
export const EXPLICAR_LIGADO = false;

/** Endereço da função, no mesmo site (a CSP só deixa connect-src 'self'). */
export const ENDERECO_DO_EXPLICAR = '/api/explicar';
