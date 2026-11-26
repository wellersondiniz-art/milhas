// Estamos dentro do app das lojas (Capacitor) ou num navegador comum?
//
// O app não carrega nenhuma biblioteca do Capacitor no site: quem cria
// window.Capacitor é o próprio app (Android/iOS), antes de a página abrir.
// No navegador, nada disto existe e o site segue igual.

/**
 * Devolve a ponte com o app nativo, ou null no navegador.
 * @param {object} [janela] normalmente globalThis
 * @returns {{ getPlatform(): string, nativePromise(plugin: string, metodo: string, opcoes?: object): Promise<any> } | null}
 */
export function ponteNativa(janela = globalThis) {
  const cap = janela?.Capacitor;
  try {
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
    if (typeof cap.nativePromise !== 'function') return null;
    const temCofre = Array.isArray(cap.PluginHeaders) && cap.PluginHeaders.some((p) => p?.name === 'SecureStorage');
    return temCofre ? cap : null;
  } catch {
    return null;
  }
}
