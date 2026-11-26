// Duas telas na mesma página: a inicial (#/) e "Meu perfil" (#/perfil).
// Tela inicial: 1) loja, 2) valor, 3) resultado.
// A conta vem sempre do motor (js/motor/). Aqui só se lê o formulário,
// chama o motor e mostra o que ele devolveu.
// Ficar numa página só deixa o perfil vivo na memória quando o navegador
// não deixa salvar (modo privado): trocar de tela não perde nada.

import { calcularJeitosDeComprar, dataHoraEmSaoPaulo, formatarCentavos, naLoja } from './motor/index.js';
import { criarBuscaDeLoja } from './tela/busca-loja.js';
import { aplicarMascara, erroDoValor, VALOR_MAXIMO_CENTAVOS } from './tela/moeda.js';
import { abrirArmazem, CHAVE, CHAVE_V1 } from './perfil/armazem.js';
import { dadosComCartoesDaPessoa, ehVazio, perfilDeTodos, perfilParaConta, perfilSemCartoesDaPessoa } from './perfil/formato.js';
import { montarTelaPerfil, resumoDoPerfil } from './tela/perfil-tela.js';
import { alerta, montarCarregando, montarResultado } from './tela/resultado.js';
import { anuncioDoResultado } from './tela/textos.js';
import { el } from './tela/dom.js';
import { montarAjusteRapido, montarValeAPena } from './tela/decisao-tela.js';
import { exemplosRapidos, juntarJeitosIguais, perfilComAjuste, premissasDaConta } from './tela/primeira-visita.js';
import { iniciarPwa } from './pwa/pwa.js';
import { montarLinkDeSaida } from './saida/links.js';
import { EXPLICAR_LIGADO } from './explicar/config.js';
import { montarExplicar } from './explicar/painel.js';
import { maisAntiga } from './pwa/textos.js';
import { criarMetricas, observarCliquesDeSaida, observarInstalacao } from './metricas/metricas.js';
import { ponteNativa } from './nativo/plataforma.js';
import { abrirArmazenamentoSeguro } from './nativo/armazem-seguro.js';
import { buscarDadosDoApp } from './nativo/dados.js';
import { ENDERECO_DO_SITE, ESPERA_DOS_DADOS_MS } from './nativo/config.js';

const ARQUIVOS = ['programas', 'cartoes', 'lojas', 'ofertas', 'cambio', 'links'];

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
const exemplos = $('exemplos');

let dados = null;
let perfilSalvo = null;
let mostrandoResultado = false;
let telaDoPerfil = null;
// Loja da última conta: vai junto com o clique de saída (taxa calcular → clicar).
let lojaDaConta = null;
// Métricas sem cookie: nunca levam valor, cartões nem programas (ver metricas.js).
// No app, elas não saem: só mandam no domínio do site (ver metricas/config.js).
const metricas = criarMetricas();
// Painel "O que a conta supôs": fica vivo entre uma conta e outra da mesma
// loja, para quem está mexendo nele não perder o foco.
let ajuste = null;
// No app das lojas (Android/iOS), o perfil vai para o cofre do sistema;
// no navegador, para o localStorage. Ver js/nativo/armazem-seguro.js.
const ponte = ponteNativa();
const armazem = abrirArmazem(ponte
  ? await abrirArmazenamentoSeguro(ponte, [CHAVE, CHAVE_V1], { aoFalhar: (erro) => console.error(erro) })
  : (() => { try { return globalThis.localStorage; } catch { return undefined; } })());
if (ponte) document.documentElement.dataset.app = ponte.getPlatform();

// ---------------------------------------------------------------------------
// Passo 1: loja

const busca = criarBuscaDeLoja({
  campo: campoLoja,
  lista: $('loja-lista'),
  status: $('loja-status'),
  aoEscolher(loja) {
    if (!loja) return;
    metricas.registrar('busca_loja', { loja: loja.id, origem: 'calculadora' }, { umaVez: true });
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

/** Os dados do site com os cartões que a pessoa adicionou em "Meu perfil". */
function dadosDaConta() {
  return dadosComCartoesDaPessoa(dados, perfilSalvo);
}

function perfilDaConta() {
  return ehVazio(perfilSalvo)
    ? { perfil: perfilDeTodos(dadosDaConta(), perfilSalvo?.cotacao_dolar), semPerfil: true }
    : { perfil: perfilParaConta(perfilSalvo), semPerfil: false };
}

function mostrarErro(tituloAlerta, mensagem, aoTentar) {
  const botao = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Tentar de novo');
  botao.addEventListener('click', aoTentar);
  resultado.replaceChildren(alerta('perigo', tituloAlerta, el('p', {}, mensagem), botao));
  resultado.removeAttribute('aria-busy');
}

// `contar`: conta como "cálculo feito" (não conta quando a conta é refeita
// sozinha porque o perfil mudou).
function calcular({ focar = true, contar = true } = {}) {
  const loja = busca.confirmar();
  const { centavos } = aplicarMascara(campoValor.value);
  const problemaLoja = loja ? '' : 'Escolha uma loja da lista.';
  const problemaValor = passoValor.hidden ? '' : erroDoValor(centavos);
  marcarErro(campoLoja, erroLoja, problemaLoja);
  if (!passoValor.hidden) marcarErro(campoValor, erroValor, problemaValor);
  if (problemaLoja) {
    // Digitou uma loja que não está na lista: conta sem mandar o que foi digitado.
    if (campoLoja.value.trim()) metricas.registrar('busca_loja', { loja: 'fora-da-lista', origem: 'calculadora' }, { umaVez: true });
    if (focar) campoLoja.focus();
    return;
  }
  if (passoValor.hidden) { passoValor.hidden = false; campoValor.focus(); return; }
  if (problemaValor) { if (focar) campoValor.focus(); return; }

  // Lojas já chegaram, mas programas, cartões ou ofertas ainda não:
  // mostra "carregando" e faz a conta assim que chegarem.
  if (!dados) {
    calcularQuandoChegar = true;
    mostrarCarregando('Só um instante, buscando as ofertas…');
    if (focar) titulo.focus();
    return;
  }

  const valorTexto = formatarCentavos(centavos);
  passoResultado.hidden = false;
  mostrandoResultado = true;
  titulo.textContent = `${valorTexto.replace('R$ ', 'R$\u00a0')} ${naLoja(loja)}`;
  const { perfil, semPerfil } = perfilDaConta();
  const dadosComMeus = dadosDaConta();
  try {
    // As datas das ofertas são de Brasília: o dia vira à meia-noite de São Paulo.
    const hoje = dataHoraEmSaoPaulo(new Date());
    const jeitos = calcularJeitosDeComprar(
      perfil,
      { loja_id: loja.id, valor_centavos: centavos, tipo_vendedor: 'loja' },
      dadosComMeus,
      hoje,
    );
    if (!ajuste || ajuste.lojaId !== loja.id) {
      ajuste = {
        lojaId: loja.id,
        ...montarAjusteRapido({
          dados: dadosComMeus, perfilSalvo, perfilDaConta: perfil, semPerfil, lojaId: loja.id, hoje: hoje.slice(0, 10), aoAjustar: ajustar,
        }),
      };
    }
    const premissas = premissasDaConta({ dados: dadosComMeus, perfil, semPerfil, jeitos });
    ajuste.atualizarPremissas(premissas);
    const ativo = document.activeElement;
    // Na tela, a mesma oferta repetida para cada cartão vira um card só.
    const naTela = juntarJeitosIguais(jeitos);
    resultado.replaceChildren(montarResultado(naTela, {
      loja,
      valorTexto,
      semPerfil,
      ajuste: ajuste.elemento,
      valeAPena: montarValeAPena({ jeitos, valorCentavos: centavos, dados: dadosComMeus, perfil }),
      faltaDolar: premissas.some((p) => p.chave === 'dolar' && p.falta),
      nomePrograma: (id) => dados.programas.find((p) => p.id === id)?.nome ?? id,
      // A ordem já veio do motor. O link de saída só entra depois, sem mexer nela.
      saida: montarLinkDeSaida(loja.id, dados),
    }));
    // Quem estava mexendo no painel continua onde estava.
    if (ativo && ajuste.elemento.contains(ativo)) ativo.focus();
    // O "Explica pra mim" refaz a conta no servidor, que não conhece os cartões
    // adicionados pela pessoa (eles não saem do aparelho).
    if (EXPLICAR_LIGADO && jeitos.length && jeitos[0].cartao?.informado_pela_pessoa !== true) {
      resultado.append(montarExplicar({ lojaId: loja.id, centavos, perfil: perfilSemCartoesDaPessoa(perfilSalvo), melhor: jeitos[0] }));
    }
    anunciar(anuncioDoResultado(naTela, { nomeLoja: loja, valorTexto }));
    lojaDaConta = loja.id;
    if (contar) metricas.registrar('calculo', { loja: loja.id });
  } catch (erro) {
    anunciar('');
    console.error(erro);
    mostrarErro('Não deu para calcular', 'Algo nos dados ou no valor não fechou. Confira o valor e tente de novo. Se continuar, o problema é nosso.', () => calcular());
  }
  if (focar) titulo.focus();
}

/** Ajuste rápido ("O que a conta supôs"): salva no perfil e refaz a conta sem mexer no foco. */
function ajustar(mudanca) {
  perfilSalvo = perfilComAjuste(perfilSalvo, dadosDaConta(), mudanca);
  const salvou = armazem.salvar(perfilSalvo);
  mostrarConvite();
  calcular({ focar: false });
  ajuste?.avisar(salvou ? 'Pronto: a conta foi refeita e o ajuste ficou salvo neste aparelho.' : 'Pronto: a conta foi refeita. Este navegador não deixa guardar, então o ajuste vale só nesta aba.');
}

// ---------------------------------------------------------------------------
// Exemplos de um toque: resultado sem digitar nada.

function mostrarExemplos(lojas, ofertas) {
  if (!exemplos) return;
  const lista = exemplosRapidos(lojas, ofertas, hojeLocal());
  exemplos.replaceChildren(...lista.map((ex) => {
    const botao = el('button', { type: 'button', class: 'botao botao--secundario exemplos__botao' }, ex.texto);
    botao.addEventListener('click', () => {
      busca.escolherPorId(ex.loja.id);
      passoValor.hidden = false;
      campoValor.value = aplicarMascara(String(ex.valor_centavos)).texto;
      marcarErro(campoValor, erroValor, '');
      calcular();
    });
    return botao;
  }));
  exemplos.closest('.exemplos').hidden = !lista.length;
}

formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  calcular();
});

// ---------------------------------------------------------------------------
// Perfil: convite na tela inicial e tela "Meu perfil"

function hojeLocal() {
  return dataHoraEmSaoPaulo(new Date()).slice(0, 10);
}

// O convite aparece logo no começo, antes dos dados chegarem, para o formulário
// não pular para baixo quando eles chegam (CLS). Sem dados ainda, só dá para
// saber SE há perfil guardado; o resumo ("2 programas e 1 cartão") vem depois.
function mostrarConvite() {
  convite.hidden = false;
  const vazio = dados ? ehVazio(perfilSalvo) : !armazem.temAlgo();
  if (vazio) {
    convite.replaceChildren(el('p', { class: 'texto-suave convite' },
      'Não precisa cadastrar nada: a conta usa padrões que aparecem junto com o resultado, e você muda ali mesmo. ',
      el('a', { href: '#/perfil' }, 'Cadastrar meus cartões')));
  } else {
    convite.replaceChildren(el('p', { class: 'texto-suave convite' },
      dados ? `A conta usa o seu perfil: ${resumoDoPerfil(perfilSalvo)}. ` : 'A conta usa o seu perfil. ',
      el('a', { href: '#/perfil' }, 'Mudar meu perfil')));
  }
}

function definirPerfil(novo) {
  perfilSalvo = novo;
  ajuste = null;
  const salvou = novo === null ? (armazem.apagar(), !armazem.emMemoria) : armazem.salvar(novo);
  mostrarConvite();
  if (mostrandoResultado) calcular({ focar: false, contar: false });
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
//
// Os quatro arquivos são pedidos juntos, mas a tela não espera todos:
// com dados/lojas.json o campo da loja já fica liberado (passo 1). Programas,
// cartões e ofertas chegam por trás e só fazem falta na hora da conta ou na
// tela do perfil. Em rede lenta, a pessoa vai digitando enquanto o resto chega.
// O index.html já pede dados/lojas.json com <link rel="preload">, junto com o JS.

/** Busca dados/<nome>.json. Devolve { lista, salvoEm }. */
async function buscarLista(nome) {
  // No app, tenta os dados do site primeiro (as ofertas mudam toda semana).
  const resposta = ponte
    ? (await buscarDadosDoApp(nome, { buscar: fetch, endereco: ENDERECO_DO_SITE, espera: ESPERA_DOS_DADOS_MS })).resposta
    : await fetch(`dados/${nome}.json`, { cache: 'no-cache' });
  if (!resposta.ok) throw new Error(`dados/${nome}.json respondeu ${resposta.status}`);
  // Veio da cópia guardada pelo service worker? Ele marca a hora em X-Salvo-Em.
  const salvoEm = resposta.headers.get('X-Salvo-Em');
  const lista = await resposta.json();
  if (!Array.isArray(lista)) throw new Error(`dados/${nome}.json não é uma lista`);
  return { lista, salvoEm };
}

let calcularQuandoChegar = false;

function mostrarCarregando(texto) {
  passoResultado.hidden = false;
  titulo.textContent = texto;
  resultado.setAttribute('aria-busy', 'true');
  resultado.replaceChildren(montarCarregando());
}

function esconderCarregando() {
  resultado.removeAttribute('aria-busy');
  resultado.replaceChildren();
  passoResultado.hidden = true;
}

function falhouCarga(erro) {
  console.error(erro);
  calcularQuandoChegar = false;
  passoResultado.hidden = false;
  titulo.textContent = 'Não deu para carregar';
  mostrarErro('A internet falhou ou o site está fora do ar', 'Não conseguimos buscar as lojas e ofertas. Confira a sua internet e tente de novo.', () => carregar());
}

/** Programas, cartões e ofertas chegaram: monta perfil e conta. */
function aoChegaremOsDados(pedidos) {
  dados = Object.fromEntries(ARQUIVOS.map((nome, i) => [nome, pedidos[i].lista]));
  pwa.definirDadosSalvosEm(maisAntiga(pedidos.map((p) => p.salvoEm)));
  perfilSalvo = armazem.ler(dados);
  telaDoPerfil = montarTelaPerfil({
    elementos: {
      formulario: $('perfil-formulario'),
      aviso: $('perfil-aviso'),
      vencimentos: $('perfil-vencimentos'),
      meuCartao: $('perfil-meu-cartao'),
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
  mostrarExemplos(dados.lojas, dados.ofertas);
  if (calcularQuandoChegar) {
    calcularQuandoChegar = false;
    calcular();
  }
  // Quem abriu direto em "Meu perfil" estava esperando os dados. Na tela
  // inicial não mexe: a pessoa pode estar digitando no campo da loja.
  if (rotaAtual() === 'perfil') aoMudarRota();
}

async function carregar() {
  campoLoja.disabled = true;
  botaoVer.disabled = true;
  mostrarCarregando('Carregando as lojas e ofertas…');
  const pedidos = ARQUIVOS.map((nome) => buscarLista(nome));
  // Quem falhar é tratado abaixo; isto só evita o aviso de "promessa sem catch".
  for (const p of pedidos) p.catch(() => {});

  let lojas;
  try {
    lojas = await pedidos[ARQUIVOS.indexOf('lojas')];
  } catch (erro) {
    falhouCarga(erro);
    return;
  }
  busca.definirLojas(lojas.lista);
  mostrarExemplos(lojas.lista, null);
  campoLoja.disabled = false;
  botaoVer.disabled = false;
  esconderCarregando();
  ajudaValor.textContent = 'Só números. Os centavos entram sozinhos: para R$ 1.299,00, digite 129900.';
  // Vindo de uma página de loja ("?loja=magalu"), a loja já chega escolhida.
  const lojaDaUrl = new URLSearchParams(location.search).get('loja');
  if (lojaDaUrl && rotaAtual() === 'inicio') busca.escolherPorId(lojaDaUrl);

  try {
    aoChegaremOsDados(await Promise.all(pedidos));
  } catch (erro) {
    falhouCarga(erro);
  }
}

// No app, os arquivos já estão dentro dele: sem service worker (versão nova
// chega pela loja). O aviso de "sem internet" continua.
const pwa = iniciarPwa({
  avisoVersao: $('aviso-versao'),
  avisoConexao: $('aviso-conexao'),
  navegador: ponte ? { onLine: navigator.onLine } : navigator,
});
// No app, baixar arquivo pelo navegador não funciona: exportar fica no site.
if (ponte) {
  $('perfil-exportar').hidden = true;
  $('perfil-transferir').textContent = 'Para levar o perfil para o app, exporte no site e toque em "Importar perfil" aqui. Importar substitui o que está marcado aqui.';
}
observarCliquesDeSaida({ metricas, pagina: 'inicio', loja: () => lojaDaConta });
observarInstalacao({ metricas });

mostrarConvite();
aoMudarRota();
carregar();
