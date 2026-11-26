// Esconde o preço de produto que passou da validade (no máximo 24 horas).
//
// As páginas de loja são estáticas e podem ficar guardadas no aparelho (para
// funcionar sem internet). Se o site não for montado de novo a tempo, o
// preço velho não pode continuar na tela: este script troca o preço e os
// pontos pelo aviso "confira na loja". Sem dado pessoal, sem rede.

/** O preço que vale até `validoAte` (ISO) já venceu em `agoraMs`? Data ruim conta como vencida. */
export function precoVencido(validoAte, agoraMs) {
  const ate = Date.parse(validoAte);
  return !Number.isFinite(ate) || agoraMs >= ate;
}

/** Esconde preço e pontos dos produtos vencidos. Devolve quantos esconderam. */
export function esconderPrecosVencidos(raiz, agoraMs) {
  let escondidos = 0;
  for (const produto of raiz.querySelectorAll('[data-valido-ate]')) {
    if (!precoVencido(produto.getAttribute('data-valido-ate'), agoraMs)) continue;
    for (const parte of produto.querySelectorAll('[data-some-se-vencido]')) parte.hidden = true;
    const aviso = produto.querySelector('[data-aviso-vencido]');
    if (aviso) aviso.hidden = false;
    escondidos += 1;
  }
  return escondidos;
}

/* node:coverage disable */
if (typeof document !== 'undefined') {
  const conferir = () => esconderPrecosVencidos(document, Date.now());
  conferir();
  // A aba pode ficar aberta por horas: confere de novo ao voltar para ela e a cada minuto.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') conferir(); });
  setInterval(conferir, 60_000);
}
/* node:coverage enable */
