// Tela inicial: 1) loja, 2) valor, 3) resultado.
// A conta vem sempre do motor (js/motor/). Aqui só se lê o formulário,
// chama o motor e mostra o que ele devolveu.

import { calcularJeitosDeComprar, formatarCentavos } from './motor/index.js';
import { criarBuscaDeLoja } from './tela/busca-loja.js';
import { aplicarMascara, erroDoValor, VALOR_MAXIMO_CENTAVOS } from './tela/moeda.js';
import { apagarDoAparelho, lerDoAparelho, perfilDeTodos, salvarNoAparelho } from './tela/perfil.js';
import { montarPerfil } from './tela/perfil-tela.js';
import { alerta, montarCarregando, montarResultado } from './tela/resultado.js';
import { agoraLocal } from './tela/textos.js';
import { el } from './tela/dom.js';

const ARQUIVOS = ['programas', 'cartoes', 'lojas', 'ofertas'];

const $ = (id) => document.getElementById(id);
const formulario = $('formulario');
const campoLoja = $('loja');
const erroLoja = $('loja-erro');
const passoValor = $('passo-valor');
const campoValor = $('valor');
const erroValor = $('valor-erro');
const ajudaValor = $('valor-ajuda');
const botaoVer = $('ver-resultado');
const passoResultado = $('passo-resultado');
const titulo = $('resultado-titulo');
const resultado = $('resultado');
const perfilCaixa = $('perfil');
const perfilConteudo = $('perfil-conteudo');

let dados = null;
let perfilSalvo = null;
let mostrandoResultado = false;

// ---------------------------------------------------------------------------
// Passo 1: loja

const busca = criarBuscaDeLoja({
  campo: campoLoja,
  lista: $('loja-lista'),
  status: $('loja-status'),
  aoEscolher(loja) {
    if (!loja) return;
    marcarErro(campoLoja, erroLoja, '');
    if (passoValor.hidden) {
      passoValor.hidden = false;
      campoValor.focus();
    }
  },
});

// ---------------------------------------------------------------------------
// Passo 2: valor

campoValor.addEventListener('input', () => {
  const { texto, cortado } = aplicarMascara(campoValor.value);
  campoValor.value = texto;
  marcarErro(campoValor, erroValor, cortado ? `O valor máximo é ${formatarCentavos(VALOR_MAXIMO_CENTAVOS)}.` : '');
});

function marcarErro(campo, caixa, mensagem) {
  caixa.textContent = mensagem;
  if (mensagem) campo.setAttribute('aria-invalid', 'true');
  else campo.removeAttribute('aria-invalid');
}

// ---------------------------------------------------------------------------
// Passo 3: resultado

function perfilParaConta() {
  const vazio = !perfilSalvo || (!perfilSalvo.programas.length && !perfilSalvo.cartoes.length);
  return vazio ? { perfil: perfilDeTodos(dados), semPerfil: true } : { perfil: perfilSalvo, semPerfil: false };
}

function mostrarErro(tituloAlerta, mensagem, aoTentar) {
  const botao = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Tentar de novo');
  botao.addEventListener('click', aoTentar);
  resultado.replaceChildren(alerta('perigo', tituloAlerta, el('p', {}, mensagem), botao));
  resultado.removeAttribute('aria-busy');
}

function calcular({ focar } = { focar: true }) {
  const loja = busca.confirmar();
  const { centavos } = aplicarMascara(campoValor.value);
  const problemaLoja = loja ? '' : 'Escolha uma loja da lista.';
  const problemaValor = passoValor.hidden ? '' : erroDoValor(centavos);
  marcarErro(campoLoja, erroLoja, problemaLoja);
  if (!passoValor.hidden) marcarErro(campoValor, erroValor, problemaValor);
  if (problemaLoja) { if (focar) campoLoja.focus(); return; }
  if (passoValor.hidden) { passoValor.hidden = false; campoValor.focus(); return; }
  if (problemaValor) { if (focar) campoValor.focus(); return; }

  const valorTexto = formatarCentavos(centavos);
  passoResultado.hidden = false;
  mostrandoResultado = true;
  titulo.textContent = `${valorTexto.replace('R$ ', 'R$\u00a0')} na ${loja.nome}`;
  const { perfil, semPerfil } = perfilParaConta();
  try {
    const jeitos = calcularJeitosDeComprar(
      perfil,
      { loja_id: loja.id, valor_centavos: centavos, tipo_vendedor: 'loja' },
      dados,
      agoraLocal(new Date()),
    );
    resultado.replaceChildren(montarResultado(jeitos, { loja, valorTexto, semPerfil }));
  } catch (erro) {
    console.error(erro);
    mostrarErro('Não deu para calcular', 'Algo nos dados ou no valor não fechou. Confira o valor e tente de novo. Se continuar, o problema é nosso.', () => calcular());
  }
  if (focar) titulo.focus();
}

formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  calcular();
});

resultado.addEventListener('click', (evento) => {
  const link = evento.target.closest('[data-abrir-perfil]');
  if (!link) return;
  evento.preventDefault();
  perfilCaixa.open = true;
  perfilCaixa.querySelector('summary').focus();
  perfilCaixa.scrollIntoView({ block: 'start' });
});

// ---------------------------------------------------------------------------
// Perfil opcional

function aoMudarPerfil(novo) {
  let salvou;
  if (novo === null || (!novo.programas.length && !novo.cartoes.length)) {
    perfilSalvo = null;
    salvou = apagarDoAparelho();
  } else {
    perfilSalvo = novo;
    salvou = salvarNoAparelho(novo);
  }
  if (mostrandoResultado) calcular({ focar: false });
  return salvou;
}

// ---------------------------------------------------------------------------
// Carregar os dados

async function carregar() {
  campoLoja.disabled = true;
  botaoVer.disabled = true;
  passoResultado.hidden = false;
  titulo.textContent = 'Carregando as lojas e ofertas…';
  resultado.setAttribute('aria-busy', 'true');
  resultado.replaceChildren(montarCarregando());
  try {
    const listas = await Promise.all(ARQUIVOS.map(async (nome) => {
      const resposta = await fetch(`dados/${nome}.json`, { cache: 'no-cache' });
      if (!resposta.ok) throw new Error(`dados/${nome}.json respondeu ${resposta.status}`);
      const lista = await resposta.json();
      if (!Array.isArray(lista)) throw new Error(`dados/${nome}.json não é uma lista`);
      return lista;
    }));
    dados = Object.fromEntries(ARQUIVOS.map((nome, i) => [nome, listas[i]]));
  } catch (erro) {
    console.error(erro);
    titulo.textContent = 'Não deu para carregar';
    mostrarErro('A internet falhou ou o site está fora do ar', 'Não conseguimos buscar as lojas e ofertas. Confira a sua internet e tente de novo.', () => carregar());
    return;
  }
  busca.definirLojas(dados.lojas);
  perfilSalvo = lerDoAparelho(dados);
  montarPerfil(perfilConteudo, dados, perfilSalvo, aoMudarPerfil);
  campoLoja.disabled = false;
  botaoVer.disabled = false;
  resultado.removeAttribute('aria-busy');
  resultado.replaceChildren();
  passoResultado.hidden = true;
  ajudaValor.textContent = 'Só números. Os centavos entram sozinhos: para R$ 1.299,00, digite 129900.';
}

carregar();
