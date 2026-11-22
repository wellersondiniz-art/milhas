// Duas telas na mesma página: a inicial (#/) e "Meu perfil" (#/perfil).
// Tela inicial: 1) loja, 2) valor, 3) resultado.
// A conta vem sempre do motor (js/motor/). Aqui só se lê o formulário,
// chama o motor e mostra o que ele devolveu.
// Ficar numa página só deixa o perfil vivo na memória quando o navegador
// não deixa salvar (modo privado): trocar de tela não perde nada.

import { calcularJeitosDeComprar, formatarCentavos } from './motor/index.js';
import { criarBuscaDeLoja } from './tela/busca-loja.js';
import { aplicarMascara, erroDoValor, VALOR_MAXIMO_CENTAVOS } from './tela/moeda.js';
import { abrirArmazem } from './perfil/armazem.js';
import { ehVazio, perfilDeTodos, perfilParaConta } from './perfil/formato.js';
import { montarTelaPerfil, resumoDoPerfil } from './tela/perfil-tela.js';
import { alerta, montarCarregando, montarResultado } from './tela/resultado.js';
import { agoraLocal, anuncioDoResultado } from './tela/textos.js';
import { el } from './tela/dom.js';
import { iniciarPwa } from './pwa/pwa.js';
import { maisAntiga } from './pwa/textos.js';

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
const anuncio = $('resultado-anuncio');
const convite = $('convite-perfil');
const telaInicio = $('tela-inicio');
const telaPerfil = $('tela-perfil');

let dados = null;
let perfilSalvo = null;
let mostrandoResultado = false;
let telaDoPerfil = null;
const armazem = abrirArmazem((() => { try { return globalThis.localStorage; } catch { return undefined; } })());

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

// Região role="status": o leitor de tela lê o texto quando ele muda.
// Esvazia antes e escreve depois de um instante, para repetir o aviso
// mesmo quando o texto é igual ao anterior.
let esperaAnuncio = 0;
function anunciar(texto) {
  clearTimeout(esperaAnuncio);
  anuncio.textContent = '';
  if (texto) esperaAnuncio = setTimeout(() => { anuncio.textContent = texto; }, 150);
}

function perfilDaConta() {
  return ehVazio(perfilSalvo)
    ? { perfil: perfilDeTodos(dados), semPerfil: true }
    : { perfil: perfilParaConta(perfilSalvo), semPerfil: false };
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
  const { perfil, semPerfil } = perfilDaConta();
  try {
    const jeitos = calcularJeitosDeComprar(
      perfil,
      { loja_id: loja.id, valor_centavos: centavos, tipo_vendedor: 'loja' },
      dados,
      agoraLocal(new Date()),
    );
    resultado.replaceChildren(montarResultado(jeitos, { loja, valorTexto, semPerfil }));
    anunciar(anuncioDoResultado(jeitos, { nomeLoja: loja.nome, valorTexto }));
  } catch (erro) {
    anunciar('');
    console.error(erro);
    mostrarErro('Não deu para calcular', 'Algo nos dados ou no valor não fechou. Confira o valor e tente de novo. Se continuar, o problema é nosso.', () => calcular());
  }
  if (focar) titulo.focus();
}

formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  calcular();
});

// ---------------------------------------------------------------------------
// Perfil: convite na tela inicial e tela "Meu perfil"

function hojeLocal() {
  return agoraLocal(new Date()).slice(0, 10);
}

// O convite aparece logo no começo, antes dos dados chegarem, para o formulário
// não pular para baixo quando eles chegam (CLS). Sem dados ainda, só dá para
// saber SE há perfil guardado; o resumo ("2 programas e 1 cartão") vem depois.
function mostrarConvite() {
  convite.hidden = false;
  const vazio = dados ? ehVazio(perfilSalvo) : !armazem.temAlgo();
  if (vazio) {
    convite.replaceChildren(alerta('info', 'Ainda não sabemos quais cartões você tem',
      el('p', {}, 'Tudo bem: a conta funciona assim mesmo, com as melhores opções entre todos os cartões e programas que conhecemos. Para ver só o que é seu, cadastre os seus cartões. Leva um minuto.'),
      el('a', { class: 'botao botao--secundario', href: '#/perfil' }, 'Cadastrar meus cartões')));
  } else {
    convite.replaceChildren(el('p', { class: 'texto-suave convite' },
      dados ? `A conta usa o seu perfil: ${resumoDoPerfil(perfilSalvo)}. ` : 'A conta usa o seu perfil. ',
      el('a', { href: '#/perfil' }, 'Mudar meu perfil')));
  }
}

function definirPerfil(novo) {
  perfilSalvo = novo;
  const salvou = novo === null ? (armazem.apagar(), !armazem.emMemoria) : armazem.salvar(novo);
  mostrarConvite();
  if (mostrandoResultado) calcular({ focar: false });
  return { salvou, emMemoria: armazem.emMemoria };
}

// ---------------------------------------------------------------------------
// Telas: #/ (inicial) e #/perfil. Outros "#" (como #conteudo) não trocam de tela.

function rotaAtual() {
  const h = location.hash;
  if (h === '#/perfil') return 'perfil';
  if (h === '' || h === '#' || h === '#/') return 'inicio';
  return null;
}

function mostrarTela(rota, { focar }) {
  const perfil = rota === 'perfil';
  telaInicio.hidden = perfil;
  telaPerfil.hidden = !perfil;
  for (const link of document.querySelectorAll('[data-rota]')) {
    if (link.dataset.rota === rota) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = perfil ? 'Meu perfil · Milhas da Vez' : 'Milhas da Vez';
  if (perfil && telaDoPerfil) telaDoPerfil.abrir(armazem.emMemoria);
  if (focar) (perfil ? $('perfil-titulo') : document.querySelector('#tela-inicio h1')).focus();
}

let primeiraVez = true;
function aoMudarRota() {
  const rota = rotaAtual();
  if (!rota) return;
  // Sem dados ainda, a tela do perfil espera a carga terminar.
  if (rota === 'perfil' && !dados) return;
  mostrarTela(rota, { focar: !primeiraVez });
  primeiraVez = false;
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', aoMudarRota);

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
    const salvosEm = [];
    const listas = await Promise.all(ARQUIVOS.map(async (nome) => {
      const resposta = await fetch(`dados/${nome}.json`, { cache: 'no-cache' });
      if (!resposta.ok) throw new Error(`dados/${nome}.json respondeu ${resposta.status}`);
      // Veio da cópia guardada pelo service worker? Ele marca a hora em X-Salvo-Em.
      salvosEm.push(resposta.headers.get('X-Salvo-Em'));
      const lista = await resposta.json();
      if (!Array.isArray(lista)) throw new Error(`dados/${nome}.json não é uma lista`);
      return lista;
    }));
    dados = Object.fromEntries(ARQUIVOS.map((nome, i) => [nome, listas[i]]));
    pwa.definirDadosSalvosEm(maisAntiga(salvosEm));
  } catch (erro) {
    console.error(erro);
    titulo.textContent = 'Não deu para carregar';
    mostrarErro('A internet falhou ou o site está fora do ar', 'Não conseguimos buscar as lojas e ofertas. Confira a sua internet e tente de novo.', () => carregar());
    return;
  }
  busca.definirLojas(dados.lojas);
  perfilSalvo = armazem.ler(dados);
  telaDoPerfil = montarTelaPerfil({
    elementos: {
      formulario: $('perfil-formulario'),
      aviso: $('perfil-aviso'),
      status: $('perfil-status'),
      exportar: $('perfil-exportar'),
      importar: $('perfil-importar'),
      arquivo: $('perfil-arquivo'),
      resultadoImportacao: $('perfil-importacao'),
      apagar: $('perfil-apagar'),
      confirmarApagar: $('perfil-confirmar'),
      simApagar: $('perfil-sim-apagar'),
      naoApagar: $('perfil-nao-apagar'),
    },
    dados,
    hoje: hojeLocal,
    obterPerfil: () => perfilSalvo,
    definirPerfil,
  });
  mostrarConvite();
  campoLoja.disabled = false;
  botaoVer.disabled = false;
  resultado.removeAttribute('aria-busy');
  resultado.replaceChildren();
  passoResultado.hidden = true;
  ajudaValor.textContent = 'Só números. Os centavos entram sozinhos: para R$ 1.299,00, digite 129900.';
  // Vindo de uma página de loja ("?loja=magalu"), a loja já chega escolhida.
  const lojaDaUrl = new URLSearchParams(location.search).get('loja');
  if (lojaDaUrl && rotaAtual() === 'inicio') busca.escolherPorId(lojaDaUrl);
  aoMudarRota();
}

const pwa = iniciarPwa({ avisoVersao: $('aviso-versao'), avisoConexao: $('aviso-conexao') });

mostrarConvite();
aoMudarRota();
carregar();
