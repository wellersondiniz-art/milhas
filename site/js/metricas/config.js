// Métricas sem cookie (Plausible). Ver site/js/metricas/metricas.js.
//
// DOMINIO_NO_PLAUSIBLE: o nome do site como ele foi cadastrado no Plausible,
// que é o próprio endereço onde o site está no ar, sem https:// e sem barra.
// Exemplos: 'milhasdavez.pages.dev' hoje; 'milhasdavez.com.br' depois do domínio.
//
// Com 'A_CONFIRMAR', nada é medido e a página Privacidade diz que o site não
// usa métrica. O site também só mede quando está aberto exatamente nesse
// endereço: no computador de quem desenvolve, nos testes e nas prévias da
// Cloudflare Pages (endereços diferentes), nada é enviado.
//
// Ao trocar, rode npm run build: a página Privacidade passa a dizer o que é medido.
// Troque também TEXTOS_ATUALIZADOS_EM em scripts/paginas/config.js.
export const DOMINIO_NO_PLAUSIBLE = 'A_CONFIRMAR';

// Para onde vão os eventos. Precisa estar liberado em connect-src (site/_headers).
export const ENDERECO_DE_ENVIO = 'https://plausible.io/api/event';
