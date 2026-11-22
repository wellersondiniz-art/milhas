// Service worker da extensão (módulo ES). Faz a conta com o motor do site e
// devolve só o texto do selo para a página de conteúdo.
//
// Não acessa rede: a CSP da extensão tem connect-src 'none', e os dados
// (lojas, cartões, programas, ofertas) vêm dentro do pacote (dados.js).
// O endereço da aba nunca sai daqui: só o nome do host é usado, para achar a loja.

import { DADOS, SELETORES } from './dados.js';
import { calcularSelo, configuracaoPara } from './nucleo.js';
import { agoraEmSaoPaulo } from './relogio.js';

export const CHAVE_PERFIL = 'perfil';

function hostDe(remetente) {
  // Só aceita mensagens dos scripts de conteúdo desta própria extensão, vindas de uma aba.
  if (remetente.id !== chrome.runtime.id || !remetente.tab || typeof remetente.url !== 'string') return null;
  try {
    const url = new URL(remetente.url);
    return url.protocol === 'https:' ? url.hostname : null;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  const host = hostDe(remetente);
  if (!host || !mensagem || typeof mensagem !== 'object') return false;

  if (mensagem.tipo === 'config') {
    responder(configuracaoPara(host, SELETORES));
    return false;
  }
  if (mensagem.tipo === 'preco') {
    chrome.storage.local.get(CHAVE_PERFIL)
      .then((guardado) => {
        let selo = null;
        try {
          selo = calcularSelo(mensagem, host, guardado[CHAVE_PERFIL], DADOS, SELETORES, agoraEmSaoPaulo(new Date()));
        } catch {
          selo = null; // falha em silêncio: sem selo
        }
        responder(selo);
      })
      .catch(() => responder(null));
    return true; // resposta assíncrona
  }
  return false;
});

// Na instalação, abre a página de opções para a pessoa escolher cartões e programas.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage().catch(() => {});
});

// Clique no ícone da extensão: abre a mesma página de opções.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage().catch(() => {});
});
