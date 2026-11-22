// Liga o modo app (PWA) na página: registra o service worker, mostra
// "Atualizar agora" quando há versão nova (sem forçar) e o aviso
// "Sem internet: dados de ..." quando a conta usa a cópia guardada.
//
// Nada de perfil passa por aqui: o perfil fica no localStorage e o service
// worker não guarda nem lê esse dado.

import { alerta } from '../tela/resultado.js';
import { el } from '../tela/dom.js';
import { avisoSemInternet } from './textos.js';

export function iniciarPwa({ avisoVersao, avisoConexao, navegador = globalThis.navigator, janela = globalThis.window }) {
  let salvoEm = null;
  let semRede = navegador && navegador.onLine === false;
  let recarregando = false;

  function mostrarConexao() {
    if (!semRede) { avisoConexao.replaceChildren(); return; }
    const { titulo, texto } = avisoSemInternet(salvoEm, new Date());
    avisoConexao.replaceChildren(alerta('aviso', titulo, el('p', {}, texto)));
  }

  janela.addEventListener('offline', () => { semRede = true; mostrarConexao(); });
  janela.addEventListener('online', () => { semRede = false; mostrarConexao(); });

  const sw = navegador && navegador.serviceWorker;
  if (sw) {
    sw.addEventListener('message', (evento) => {
      if (evento.data?.tipo !== 'dados-sem-rede') return;
      semRede = true;
      salvoEm = salvoEm ?? evento.data.salvoEm ?? null;
      mostrarConexao();
    });
    // Só recarrega quando a própria pessoa pediu a versão nova.
    sw.addEventListener('controllerchange', () => {
      if (!recarregando) return;
      janela.location.reload();
    });
    registrar(sw).catch(() => { /* sem service worker o site funciona igual, só sem modo offline */ });
  }

  async function registrar(container) {
    const registro = await container.register('sw.js');
    const temControle = () => Boolean(container.controller);
    if (registro.waiting && temControle()) mostrarVersaoNova(registro.waiting);
    registro.addEventListener('updatefound', () => {
      const novo = registro.installing;
      if (!novo) return;
      novo.addEventListener('statechange', () => {
        if (novo.state === 'installed' && temControle()) mostrarVersaoNova(novo);
      });
    });
    // Ao voltar para o app, procura versão nova (o navegador também procura ao abrir).
    janela.document.addEventListener('visibilitychange', () => {
      if (janela.document.visibilityState === 'visible') registro.update().catch(() => {});
    });
  }

  function mostrarVersaoNova(trabalhador) {
    const atualizar = el('button', { type: 'button', class: 'botao' }, 'Atualizar agora');
    const depois = el('button', { type: 'button', class: 'botao botao--fantasma' }, 'Agora não');
    atualizar.addEventListener('click', () => {
      recarregando = true;
      atualizar.disabled = true;
      atualizar.textContent = 'Atualizando…';
      trabalhador.postMessage({ tipo: 'atualizar-agora' });
    });
    depois.addEventListener('click', () => avisoVersao.replaceChildren());
    avisoVersao.replaceChildren(alerta('info', 'Tem uma versão nova do site',
      el('p', {}, 'Atualize quando quiser. O que você marcou no seu perfil continua aqui.'),
      el('div', { class: 'linha' }, atualizar, depois)));
  }

  return {
    /** Hora em que os dados usados na conta foram guardados (cabeçalho X-Salvo-Em). */
    definirDadosSalvosEm(iso) {
      salvoEm = iso;
      mostrarConexao();
    },
  };
}
