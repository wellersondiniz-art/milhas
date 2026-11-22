// Onde o perfil fica guardado: só no localStorage deste aparelho.
// Se o navegador não deixar (modo privado, armazenamento cheio ou bloqueado),
// o perfil passa a viver só na memória desta aba e a tela avisa.

import { limparPerfil, migrar } from './formato.js';

export const CHAVE = 'comprador-de-milhas:perfil';
/** Chave usada pela versão 1 (tela inicial, antes de "Meu perfil"). */
export const CHAVE_V1 = 'comprador-de-milhas:perfil:v1';
const CHAVE_TESTE = 'comprador-de-milhas:teste';

function funciona(armazenamento) {
  try {
    armazenamento.setItem(CHAVE_TESTE, '1');
    armazenamento.removeItem(CHAVE_TESTE);
    return true;
  } catch {
    return false;
  }
}

function memoria() {
  const mapa = new Map();
  return {
    getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
    setItem: (k, v) => { mapa.set(k, String(v)); },
    removeItem: (k) => { mapa.delete(k); },
  };
}

/**
 * @param {Storage|undefined} armazenamento  normalmente o localStorage
 * @returns {{ emMemoria: boolean, temAlgo(): boolean, ler(dados): object|null, salvar(perfil): boolean, apagar(): void }}
 *   salvar devolve false quando o aparelho parou de aceitar e o perfil foi
 *   para a memória (aí emMemoria vira true).
 */
export function abrirArmazem(armazenamento) {
  let alvo = armazenamento;
  let emMemoria = false;
  try {
    if (!alvo || !funciona(alvo)) { alvo = memoria(); emMemoria = true; }
  } catch {
    alvo = memoria(); emMemoria = true;
  }

  function irParaMemoria(texto) {
    alvo = memoria();
    emMemoria = true;
    if (texto !== undefined) alvo.setItem(CHAVE, texto);
  }

  return {
    get emMemoria() { return emMemoria; },

    /**
     * Tem algum perfil guardado? Só olha se a chave existe, sem ler nem validar.
     * Serve para desenhar a tela certa antes de os dados chegarem.
     */
    temAlgo() {
      try { return alvo.getItem(CHAVE) !== null || alvo.getItem(CHAVE_V1) !== null; } catch { return false; }
    },

    /** Perfil salvo, já migrado para a versão atual e limpo. null se não houver. */
    ler(dados) {
      try {
        let texto = alvo.getItem(CHAVE);
        let veioDaV1 = false;
        if (texto === null) {
          texto = alvo.getItem(CHAVE_V1);
          veioDaV1 = texto !== null;
        }
        if (texto === null) return null;
        const perfil = limparPerfil(JSON.parse(texto), dados);
        if (veioDaV1 && perfil) {
          // Migração: grava no formato novo e tira a chave velha.
          alvo.setItem(CHAVE, JSON.stringify(perfil));
          alvo.removeItem(CHAVE_V1);
        }
        return perfil;
      } catch {
        return null;
      }
    },

    salvar(perfil) {
      const texto = JSON.stringify(migrar(perfil));
      try {
        alvo.setItem(CHAVE, texto);
        return !emMemoria;
      } catch {
        irParaMemoria(texto);
        return false;
      }
    },

    apagar() {
      try { alvo.removeItem(CHAVE); } catch { /* nada a apagar */ }
      try { alvo.removeItem(CHAVE_V1); } catch { /* idem */ }
    },
  };
}
