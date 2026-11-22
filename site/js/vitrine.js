// Vitrine de estilo: alterna entre tema claro e escuro.
// Não guarda nada; ao recarregar, volta a seguir o tema do aparelho.

const raiz = document.documentElement;
const botao = document.getElementById('trocar-tema');

function temaAtual() {
  if (raiz.dataset.tema) return raiz.dataset.tema;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
}

function atualizarBotao() {
  const escuro = temaAtual() === 'escuro';
  botao.textContent = escuro ? 'Ver tema claro' : 'Ver tema escuro';
}

if (botao) {
  botao.addEventListener('click', () => {
    raiz.dataset.tema = temaAtual() === 'escuro' ? 'claro' : 'escuro';
    atualizarBotao();
  });
  atualizarBotao();
}
