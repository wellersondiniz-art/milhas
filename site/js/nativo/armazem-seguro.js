// Armazenamento seguro do perfil no app (Android e iOS).
//
// No navegador o perfil fica no localStorage. No app, fica no cofre do sistema:
//   - iOS: Keychain, só neste aparelho e só com o aparelho desbloqueado
//     (não vai para o iCloud nem para outro iPhone);
//   - Android: criptografado com uma chave do Android Keystore (a chave nunca
//     sai do aparelho). O backup do app está desligado no AndroidManifest.
// Quem faz isso é o plugin @aparajita/capacitor-secure-storage, que vem
// compilado dentro do app. Aqui só se conversa com ele pela ponte nativa.
//
// O resto do site (perfil/armazem.js) espera um armazenamento síncrono, como o
// localStorage. Por isso este módulo lê o cofre UMA vez, ao abrir o app, e
// guarda uma cópia na memória: ler é instantâneo e salvar grava na memória na
// hora e no cofre logo em seguida.

const PLUGIN = 'SecureStorage';
// O plugin junta este prefixo às chaves (é o padrão dele; mantido igual).
const PREFIXO = 'capacitor-storage_';
// 1 = KeychainAccess.whenUnlockedThisDeviceOnly no plugin (não sai do aparelho).
const ACESSO_SO_NESTE_APARELHO = 1;

/**
 * @param {{ nativePromise(plugin: string, metodo: string, opcoes?: object): Promise<any> }} ponte
 * @param {string[]} chaves  chaves que vão para o cofre (as do perfil). Outras ficam só na memória.
 * @param {{ aoFalhar?: (erro: unknown) => void }} [opcoes]
 * @returns {Promise<Storage-like>} objeto com getItem, setItem e removeItem síncronos
 */
export async function abrirArmazenamentoSeguro(ponte, chaves, { aoFalhar = () => {} } = {}) {
  const guardadas = new Set(chaves);
  const copia = new Map();
  const chamar = (metodo, opcoes) => ponte.nativePromise(PLUGIN, metodo, { sync: false, ...opcoes });

  for (const chave of chaves) {
    try {
      const { data } = await chamar('internalGetItem', { prefixedKey: PREFIXO + chave });
      if (typeof data === 'string') copia.set(chave, data);
    } catch (erro) {
      // Dado ilegível (por exemplo, chave do Keystore perdida): começa sem perfil.
      aoFalhar(erro);
    }
  }

  // As gravações saem na ordem em que foram pedidas, uma de cada vez.
  let fila = Promise.resolve();
  function enfileirar(metodo, opcoes) {
    fila = fila.then(() => chamar(metodo, opcoes)).catch(aoFalhar);
    return fila;
  }

  return {
    getItem(chave) {
      return copia.has(chave) ? copia.get(chave) : null;
    },
    setItem(chave, valor) {
      const texto = String(valor);
      copia.set(chave, texto);
      if (guardadas.has(chave)) {
        enfileirar('internalSetItem', { prefixedKey: PREFIXO + chave, data: texto, access: ACESSO_SO_NESTE_APARELHO });
      }
    },
    removeItem(chave) {
      copia.delete(chave);
      if (guardadas.has(chave)) enfileirar('internalRemoveItem', { prefixedKey: PREFIXO + chave });
    },
    /** Espera as gravações pendentes (usado nos testes). */
    esperarGravacoes() {
      return fila;
    },
  };
}
