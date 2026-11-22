// Script de conteúdo: roda só nas páginas das lojas listadas no manifesto.
//
// O que ele faz, e nada mais:
//   1. pergunta ao service worker se este site tem seletores de preço;
//   2. se o caminho da página for de produto, lê o TEXTO de um único elemento
//      de preço (o primeiro seletor que achar algo visível);
//   3. manda esse texto ao service worker e mostra o selo que voltar.
//
// Não lê formulário, campo de digitação, cookie nem o resto da página. Não
// manda o endereço da página: o service worker só usa o nome do host, que o
// próprio Chrome informa. Qualquer erro termina em silêncio, sem selo e sem
// mexer na página. O selo fica num Shadow DOM fechado e todo texto entra por
// textContent.
//
// Script clássico (o Chrome não aceita import em script de conteúdo).
(() => {
  'use strict';

  const TAG = 'milhas-da-vez-selo';
  const INTERVALO_MS = 1500;
  const TAMANHO_MAXIMO = 80;
  // Elementos de onde nunca se lê nada, mesmo que o seletor aponte para eles:
  // campos de digitação e qualquer formulário de login ou de pagamento.
  const CAMPO = 'input, textarea, select, option, [contenteditable], iframe';
  const FORMULARIO_SENSIVEL = 'input[type="password"], [autocomplete^="cc-"], [autocomplete="current-password"], [autocomplete="one-time-code"]';

  let config = null;
  let caminho = null;
  let ultimoTexto = null;
  let fechadoEm = null;
  let host = null;

  function pedir(mensagem) {
    return new Promise((resolver) => {
      try {
        chrome.runtime.sendMessage(mensagem, (resposta) => {
          void chrome.runtime.lastError; // sem service worker: fica sem resposta
          resolver(resposta ?? null);
        });
      } catch {
        resolver(null); // extensão recarregada ou desligada
      }
    });
  }

  function visivel(no) {
    return no.getClientRects().length > 0;
  }

  function proibido(no) {
    if (no.closest(CAMPO)) return true;
    const formulario = no.closest('form');
    return Boolean(formulario && formulario.querySelector(FORMULARIO_SENSIVEL));
  }

  /** { texto, indice } do primeiro seletor que achar um preço, ou null. */
  function lerTextoDoPreco() {
    for (let indice = 0; indice < config.seletores.length; indice++) {
      const { css, atributo } = config.seletores[indice];
      let no;
      try {
        no = document.querySelector(css);
      } catch {
        continue; // seletor inválido no arquivo de dados: ignora
      }
      if (!no || proibido(no)) continue;
      let texto;
      if (atributo) texto = no.getAttribute(atributo);
      else if (visivel(no)) texto = no.textContent;
      if (typeof texto === 'string' && texto.trim()) return { texto: texto.trim().slice(0, TAMANHO_MAXIMO), indice };
    }
    return null;
  }

  function tirarSelo() {
    if (host) host.remove();
    host = null;
  }

  const ESTILO = `
    :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
    .selo {
      box-sizing: border-box; display: flex; gap: 8px; align-items: flex-start;
      max-width: min(340px, calc(100vw - 32px)); padding: 10px 8px 10px 12px;
      background: #fbf6ec; color: #1f2a22; border: 2px solid #1f6b3a; border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
      font: 14px/1.4 ui-rounded, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .marca { flex: none; width: 10px; height: 10px; margin-top: 5px; border-radius: 50%; background: #ffd25e; border: 2px solid #1f6b3a; }
    .textos { flex: 1; min-width: 0; }
    .titulo { margin: 0; font-weight: 700; color: #17542d; }
    .detalhe { margin: 2px 0 0; font-size: 13px; color: #4a564d; }
    .detalhe:empty { display: none; }
    .fechar {
      flex: none; width: 28px; height: 28px; margin: -4px 0 0; padding: 0; border: 0; border-radius: 6px;
      background: transparent; color: #1f2a22; font: 700 18px/28px system-ui, sans-serif; cursor: pointer;
    }
    .fechar:hover { background: #e2f0e4; }
    .fechar:focus-visible { outline: 3px solid #1e4e86; outline-offset: 1px; }
    @media (prefers-reduced-motion: no-preference) { .selo { animation: entra 160ms ease-out; } }
    @keyframes entra { from { opacity: 0; transform: translateY(6px); } }
  `;

  function mostrarSelo({ titulo, detalhe }) {
    tirarSelo();
    host = document.createElement(TAG);
    const raiz = host.attachShadow({ mode: 'closed' });
    // Folha de estilo construída: não depende da CSP da loja para estilo inline.
    const folha = new CSSStyleSheet();
    folha.replaceSync(ESTILO);
    raiz.adoptedStyleSheets = [folha];

    const caixa = document.createElement('aside');
    caixa.className = 'selo';
    caixa.setAttribute('aria-label', 'Milhas da Vez');
    caixa.setAttribute('role', 'status');
    const marca = document.createElement('span');
    marca.className = 'marca';
    marca.setAttribute('aria-hidden', 'true');
    const textos = document.createElement('div');
    textos.className = 'textos';
    const p1 = document.createElement('p');
    p1.className = 'titulo';
    p1.textContent = String(titulo);
    const p2 = document.createElement('p');
    p2.className = 'detalhe';
    p2.textContent = String(detalhe ?? '');
    textos.append(p1, p2);
    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'fechar';
    fechar.setAttribute('aria-label', 'Fechar o selo do Milhas da Vez');
    fechar.textContent = '×';
    fechar.addEventListener('click', () => {
      fechadoEm = location.pathname;
      tirarSelo();
    });
    caixa.append(marca, textos, fechar);
    raiz.append(caixa);
    (document.body ?? document.documentElement).append(host);
  }

  async function verificar() {
    if (location.pathname !== caminho) {
      caminho = location.pathname;
      ultimoTexto = null;
      fechadoEm = null;
      tirarSelo();
    }
    if (fechadoEm === caminho || !config.caminho.test(caminho)) return;
    const lido = lerTextoDoPreco();
    const chave = lido ? `${lido.indice}|${lido.texto}` : null;
    if (chave === ultimoTexto) return;
    ultimoTexto = chave;
    if (!lido) {
      tirarSelo();
      return;
    }
    const selo = await pedir({ tipo: 'preco', texto: lido.texto, indice: lido.indice });
    // A página pode ter mudado enquanto a conta era feita.
    if (chave !== ultimoTexto || location.pathname !== caminho) return;
    if (selo && typeof selo.titulo === 'string') mostrarSelo(selo);
    else tirarSelo();
  }

  async function iniciar() {
    const resposta = await pedir({ tipo: 'config' });
    if (!resposta || !Array.isArray(resposta.seletores) || typeof resposta.caminho_produto !== 'string') return;
    config = { seletores: resposta.seletores, caminho: new RegExp(resposta.caminho_produto) };
    const passo = () => { verificar().catch(() => tirarSelo()); };
    passo();
    // Lojas que trocam de produto sem recarregar a página, ou carregam o preço
    // depois: confere de novo de tempos em tempos (só um querySelector por vez).
    setInterval(passo, INTERVALO_MS);
  }

  try {
    iniciar().catch(() => {});
  } catch {
    // falha em silêncio
  }
})();
