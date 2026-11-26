// Tela "Milhas em viagens": transferência com bônus, passagem e hotel.
// Só desenha: toda conta vem de motor/viagens.js e todo texto de
// tela/viagens-textos.js. Nada de innerHTML: elementos via el() e textContent.
// O perfil é só lido (localStorage, chave do perfil). As categorias que a pessoa
// marca aqui ficam no localStorage deste aparelho, numa chave própria.

import {
  calcularTransferencias, calcularViagem, campanhasDeHoje, niveisPorPrograma, origensDeTransferencia, vendedores,
} from './motor/viagens.js';
import { formatarData } from './motor/formatar.js';
import { aplicarMascara, erroDoValor, mascaraCotacao } from './tela/moeda.js';
import { abrirArmazem } from './perfil/armazem.js';
import { ehVazio, perfilParaConta } from './perfil/formato.js';
import { alerta } from './tela/resultado.js';
import { agoraLocal } from './tela/textos.js';
import { el } from './tela/dom.js';
import {
  TERMOS_VIAGEM, anuncioDaTransferencia, anuncioDaViagem, destaqueDaRota, destaqueDaViagem, erroDosPontos, fraseDaViagem,
  lerBonus, lerPontos, selosDaRota, textoDaCampanha, textoDasOutrasCampanhas, vereditoDaRota,
} from './tela/viagens-textos.js';

const ARQUIVOS = ['programas', 'cartoes', 'cambio', 'cotacoes', 'transferencias', 'bonus-transferencia', 'viagens'];
const CHAVE_CATEGORIAS = 'comprador-de-milhas:viagens:categorias';

const $ = (id) => document.getElementById(id);
const anuncio = $('viagens-anuncio');

let dados = null;
let perfil = null;
let niveis = lerCategorias();
const bonusDigitado = {};

function hoje() {
  return agoraLocal(new Date()).slice(0, 10);
}

function lerCategorias() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_CATEGORIAS) ?? '{}');
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
    return Object.fromEntries(Object.entries(bruto).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && v.length < 80));
  } catch {
    return {};
  }
}

function salvarCategorias() {
  try { localStorage.setItem(CHAVE_CATEGORIAS, JSON.stringify(niveis)); } catch { /* fica só nesta aba */ }
}

function termo(chave) {
  const [pergunta, resposta] = TERMOS_VIAGEM[chave];
  return el('details', { class: 'termo' }, el('summary', {}, pergunta), el('p', { class: 'termo__texto' }, resposta));
}

function anunciar(texto) {
  anuncio.textContent = '';
  // Um tique depois, para o leitor de tela perceber a mudança mesmo se o texto repetir.
  setTimeout(() => { anuncio.textContent = texto; }, 50);
}

function linkFonte(registro, rotulo = 'Fonte oficial') {
  return el('p', { class: 'texto-pequeno texto-suave' },
    el('a', { href: registro.fonte_url, rel: 'noopener noreferrer', target: '_blank' }, rotulo),
    ` · conferido em ${formatarData(registro.verificado_em)}`);
}

function blocoLista(titulo, itens, classe = 'resultado__avisos') {
  if (!itens.length) return null;
  return el('div', { class: classe },
    el('p', { class: 'resultado__subtitulo' }, titulo),
    el('ul', { class: 'resultado__lista' }, itens.map((t) => el('li', {}, t))));
}

function comoCalcular(passos) {
  return el('details', { class: 'termo resultado__detalhe' },
    el('summary', {}, 'Como calcular'),
    el('div', { class: 'termo__texto' }, el('ol', { class: 'resultado__passos' }, passos.map((p) => el('li', {}, p)))));
}

function mostrar(caixa, ...filhos) {
  caixa.hidden = false;
  caixa.replaceChildren(...filhos.filter(Boolean));
  caixa.focus({ preventScroll: true });
  caixa.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------------
// Bônus de hoje

function desenharBonusDeHoje() {
  const caixa = $('bonus-hoje-lista');
  caixa.removeAttribute('aria-busy');
  const lista = campanhasDeHoje(dados, hoje());
  if (!lista.length) {
    caixa.replaceChildren(
      el('p', {}, 'Nenhuma campanha de bônus cadastrada para hoje. Elas aparecem quase toda semana: volte depois ou confira nos programas.'),
      termo('bonus'),
    );
    return;
  }
  caixa.replaceChildren(
    el('ul', { class: 'pilha--sm lista-limpa' }, lista.map((item) => {
      const t = textoDaCampanha(item);
      return el('li', { class: 'card pilha--sm' },
        el('p', { class: 'resultado__subtitulo' }, t.titulo),
        ...t.detalhes.map((d) => el('p', { class: 'texto-pequeno' }, d)),
        linkFonte(item.campanha, 'Ver a campanha'));
    })),
    termo('bonus'),
  );
}

// ---------------------------------------------------------------------------
// Transferir

const campoOrigem = $('transferir-origem');
const campoPontos = $('transferir-pontos');
const erroPontos = $('transferir-pontos-erro');
const campoClube = $('transferir-clube');
const campoCusto = $('transferir-custo');
const caixaTransferir = $('transferir-resultado');

campoPontos.addEventListener('input', () => {
  const { texto } = lerPontos(campoPontos.value);
  campoPontos.value = texto;
  erroPontos.textContent = '';
  campoPontos.removeAttribute('aria-invalid');
});
campoCusto.addEventListener('input', () => { campoCusto.value = aplicarMascara(campoCusto.value).texto; });

function cardDaRota(opcao, posicao, entrada) {
  const id = `rota-${posicao}`;
  const d = destaqueDaRota(opcao);
  const veredito = vereditoDaRota(opcao);
  const campoBonus = el('input', {
    class: 'campo__entrada campo__entrada--curta', id: `${id}-bonus`, type: 'text', inputmode: 'numeric', autocomplete: 'off',
    placeholder: 'Ex.: 80', 'aria-describedby': `${id}-bonus-ajuda`,
  });
  if (Number.isSafeInteger(bonusDigitado[opcao.destino_id])) campoBonus.value = String(bonusDigitado[opcao.destino_id]);
  const recalcular = el('button', { class: 'botao botao--secundario', type: 'button' }, 'Refazer a conta');
  recalcular.addEventListener('click', () => {
    const v = lerBonus(campoBonus.value);
    if (v === null) delete bonusDigitado[opcao.destino_id];
    else bonusDigitado[opcao.destino_id] = v;
    calcularTransferencia(entrada.origem_id, entrada.pontos);
  });
  return el('article', { class: `card resultado__card${posicao === 0 && opcao.calculavel ? ' card--destaque' : ''}`, 'aria-labelledby': `${id}-titulo ${id}-valor` },
    el('div', { class: 'card__topo' }, selosDaRota(opcao, posicao).map((s) => el('span', { class: `selo selo--${s.tipo}` }, s.texto))),
    el('h3', { class: 'resultado__subtitulo', id: `${id}-titulo` }, `${opcao.nome_origem} → ${opcao.nome_destino}`),
    el('p', { class: 'card__valor card__valor--pontos', id: `${id}-valor` }, d.principal),
    d.legenda ? el('p', { class: 'card__legenda' }, d.legenda) : null,
    veredito ? alerta(veredito.tipo, veredito.titulo, el('p', {}, veredito.texto)) : null,
    opcao.calculavel && opcao.rota.prazo && opcao.rota.prazo !== 'A_CONFIRMAR'
      ? el('p', { class: 'texto-pequeno' }, `As milhas chegam em ${opcao.rota.prazo}.`) : null,
    blocoLista('Fique de olho', opcao.avisos),
    blocoLista('Outras campanhas', textoDasOutrasCampanhas(opcao), 'resultado__datas texto-pequeno'),
    linkFonte(opcao.rota, 'Regras da transferência'),
    opcao.campanha ? linkFonte(opcao.campanha, 'Regras da campanha de bônus') : null,
    el('div', { class: 'card__acoes' },
      opcao.calculavel ? comoCalcular(opcao.passos) : null,
      opcao.calculavel
        ? el('details', { class: 'termo resultado__detalhe' },
          el('summary', {}, 'Viu outro bônus? Refaça a conta'),
          el('div', { class: 'termo__texto pilha--sm' },
            el('label', { class: 'campo__rotulo', for: `${id}-bonus` }, `Bônus da ${opcao.nome_destino} hoje, em %`),
            campoBonus,
            el('span', { class: 'campo__ajuda', id: `${id}-bonus-ajuda` }, 'Deixe vazio para usar a campanha que cadastramos.'),
            recalcular))
        : null));
}

function calcularTransferencia(origemId, pontos) {
  const custo = aplicarMascara(campoCusto.value).centavos;
  const entrada = {
    origem_id: origemId,
    pontos,
    faixa: campoClube.checked ? 'maior' : 'todos',
    custo_milheiro_origem: custo ?? null,
    bonus_manual: { ...bonusDigitado },
  };
  const resultado = calcularTransferencias(entrada, perfil, dados, hoje());
  const cards = resultado.opcoes.map((o, i) => cardDaRota(o, i, entrada));
  mostrar(caixaTransferir,
    el('h3', {}, `Para onde mandar ${lerPontos(String(pontos)).texto} pontos ${resultado.nome_origem}`),
    el('p', { class: 'texto-suave texto-pequeno' }, 'Do que rende mais para o que rende menos, pelo valor estimado das milhas.'),
    termo('milheiro'),
    campoClube.checked ? null : termo('clube'),
    ...cards);
  anunciar(anuncioDaTransferencia(resultado));
}

$('transferir-form').addEventListener('submit', (evento) => {
  evento.preventDefault();
  const { pontos } = lerPontos(campoPontos.value);
  const msg = erroDosPontos(pontos);
  if (msg) {
    erroPontos.textContent = msg;
    campoPontos.setAttribute('aria-invalid', 'true');
    campoPontos.focus();
    return;
  }
  calcularTransferencia(campoOrigem.value, pontos);
});

// ---------------------------------------------------------------------------
// Passagem e hotel

function perguntasNaTela(caixa, perguntas, respostas, nome, aoMudar) {
  caixa.replaceChildren(...perguntas.map((p) => {
    const id = `${nome}-${p.pergunta_id}`;
    const select = el('select', { class: 'campo__entrada', id },
      p.respostas.map((r) => el('option', { value: r.id, selected: respostas[p.pergunta_id] === r.id }, r.texto)));
    select.addEventListener('change', aoMudar);
    return el('div', { class: 'campo', 'data-pergunta': p.pergunta_id },
      el('label', { class: 'campo__rotulo', for: id }, p.pergunta), select);
  }));
}

function respostasDaTela(caixa) {
  const r = {};
  for (const bloco of caixa.querySelectorAll('[data-pergunta]')) r[bloco.dataset.pergunta] = bloco.querySelector('select').value;
  return r;
}

function cardDaViagem(jeito, posicao, nome) {
  const id = `${nome}-${posicao}`;
  const d = destaqueDaViagem(jeito);
  return el('article', { class: `card resultado__card${posicao === 0 && jeito.pontos !== null ? ' card--destaque' : ''}`, 'aria-labelledby': `${id}-frase ${id}-valor` },
    el('div', { class: 'card__topo' },
      posicao === 0 && jeito.pontos !== null
        ? el('span', { class: 'selo selo--destaque' }, el('span', { 'aria-hidden': 'true' }, '★'), ' Rende mais')
        : el('span', { class: 'selo' }, `${posicao + 1}º jeito`),
      el('span', { class: 'selo selo--info' }, `Categoria ${jeito.nivel.nome}`)),
    el('p', { class: 'card__valor card__valor--pontos', id: `${id}-valor` }, d.principal),
    d.legenda ? el('p', { class: 'card__legenda' }, d.legenda) : null,
    el('p', { id: `${id}-frase` }, fraseDaViagem(jeito)),
    jeito.regra.observacoes && jeito.regra.observacoes !== 'A_CONFIRMAR' ? el('p', { class: 'texto-pequeno' }, jeito.regra.observacoes) : null,
    blocoLista('Fique de olho', jeito.avisos),
    linkFonte(jeito.regra, 'Regra oficial'),
    el('div', { class: 'card__acoes' }, comoCalcular(jeito.passos)));
}

function montarViagem({ tipo, nome, form, caixaPerguntas, campoValor, erroValor, campoTaxas, campoDolar, caixa, botao, entradaExtra }) {
  const aoMudar = () => { if (!caixa.hidden) calcular(); };
  function desenharPerguntas() {
    const r = calcularViagem({ tipo, valor_centavos: 0, ...entradaExtra(), respostas: respostasDaTela(caixaPerguntas), niveis }, perfil, dados, hoje());
    perguntasNaTela(caixaPerguntas, r.perguntas, r.respostas, nome, aoMudar);
  }
  function calcular() {
    const { centavos } = aplicarMascara(campoValor.value);
    const msg = erroDoValor(centavos).replace('a compra', tipo === 'hotel' ? 'a hospedagem' : 'a passagem');
    if (msg) {
      erroValor.textContent = msg;
      campoValor.setAttribute('aria-invalid', 'true');
      campoValor.focus();
      return;
    }
    const taxas = campoTaxas ? aplicarMascara(campoTaxas.value).centavos ?? 0 : 0;
    const dolar = campoDolar ? mascaraCotacao(campoDolar.value).valor : null;
    const r = calcularViagem({
      tipo, valor_centavos: centavos, taxas_centavos: taxas, ...entradaExtra(), respostas: respostasDaTela(caixaPerguntas), niveis,
      cotacoes: dolar ? { USD: dolar } : {},
    }, perfil, dados, hoje());
    const extras = [];
    if (r.sem_cartao_no_perfil) {
      extras.push(alerta('info', 'Some os pontos do cartão',
        el('p', {}, 'Marque seus cartões em ', el('a', { href: '../#/perfil' }, 'Meu perfil'), ' para ver também os pontos que o cartão dá nesta compra.')));
    }
    mostrar(caixa,
      el('h3', {}, tipo === 'hotel' ? 'Onde a hospedagem rende mais' : 'Quantas milhas a passagem rende'),
      ...extras,
      ...r.jeitos.map((j, i) => cardDaViagem(j, i, nome)),
      termo('categoria'));
    anunciar(anuncioDaViagem(r));
  }
  campoValor.addEventListener('input', () => {
    campoValor.value = aplicarMascara(campoValor.value).texto;
    erroValor.textContent = '';
    campoValor.removeAttribute('aria-invalid');
  });
  campoTaxas?.addEventListener('input', () => { campoTaxas.value = aplicarMascara(campoTaxas.value).texto; });
  campoDolar?.addEventListener('input', () => { campoDolar.value = mascaraCotacao(campoDolar.value).texto; });
  form.addEventListener('submit', (e) => { e.preventDefault(); calcular(); });
  desenharPerguntas();
  botao.disabled = false;
  return { desenharPerguntas, recalcularSeAberto: aoMudar };
}

// ---------------------------------------------------------------------------
// Categorias

function desenharCategorias(aoMudar) {
  const form = $('categorias-form');
  const lista = niveisPorPrograma(dados);
  form.replaceChildren(...lista.map((p) => {
    const id = `categoria-${p.programa_id}`;
    const select = el('select', { class: 'campo__entrada', id },
      p.niveis.map((n) => el('option', { value: n.id, selected: niveis[p.programa_id] === n.id }, n.nome)));
    select.addEventListener('change', () => {
      niveis = { ...niveis, [p.programa_id]: select.value };
      salvarCategorias();
      anunciar(`Categoria ${p.nome} guardada neste aparelho.`);
      aoMudar();
    });
    return el('div', { class: 'campo' }, el('label', { class: 'campo__rotulo', for: id }, p.nome), select);
  }));
  form.addEventListener('submit', (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// Carga

async function buscar(nome) {
  const r = await fetch(`../dados/${nome}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`dados/${nome}.json respondeu ${r.status}`);
  const lista = await r.json();
  if (!Array.isArray(lista)) throw new Error(`dados/${nome}.json não é uma lista`);
  return lista;
}

async function iniciar() {
  try {
    const listas = await Promise.all(ARQUIVOS.map(buscar));
    dados = Object.fromEntries(ARQUIVOS.map((n, i) => [n, listas[i]]));
  } catch (erro) {
    console.error(erro);
    $('bonus-hoje-lista').removeAttribute('aria-busy');
    $('bonus-hoje-lista').replaceChildren(alerta('perigo', 'Não deu para carregar', el('p', {}, 'Confira a sua internet e recarregue a página.')));
    return;
  }
  const salvo = abrirArmazem(globalThis.localStorage).ler(dados);
  perfil = salvo && !ehVazio(salvo) ? perfilParaConta(salvo) : (salvo?.cotacao_dolar ? { cotacao_dolar: salvo.cotacao_dolar } : null);

  desenharBonusDeHoje();

  campoOrigem.replaceChildren(...origensDeTransferencia(dados).map((o) => el('option', { value: o.id }, o.nome)));
  campoOrigem.disabled = false;
  $('transferir-ver').disabled = false;
  campoOrigem.addEventListener('change', () => { if (!caixaTransferir.hidden) caixaTransferir.hidden = true; });

  const companhia = $('passagem-companhia');
  companhia.replaceChildren(...vendedores(dados, 'passagem').map((v) => el('option', { value: v }, v)));
  companhia.disabled = false;
  const trechos = () => document.querySelector('input[name="passagem-trechos"]:checked').value;
  const passagem = montarViagem({
    tipo: 'passagem',
    nome: 'passagem',
    form: $('passagem-form'),
    caixaPerguntas: $('passagem-perguntas'),
    campoValor: $('passagem-valor'),
    erroValor: $('passagem-valor-erro'),
    campoTaxas: $('passagem-taxas'),
    campoDolar: $('passagem-dolar'),
    caixa: $('passagem-resultado'),
    botao: $('passagem-ver'),
    entradaExtra: () => ({ trechos: trechos(), vendedor: companhia.value }),
  });
  const aoTrocarCompra = () => { passagem.desenharPerguntas(); passagem.recalcularSeAberto(); };
  companhia.addEventListener('change', aoTrocarCompra);
  for (const r of document.querySelectorAll('input[name="passagem-trechos"]')) r.addEventListener('change', aoTrocarCompra);

  const hotel = montarViagem({
    tipo: 'hotel',
    nome: 'hotel',
    form: $('hotel-form'),
    caixaPerguntas: $('hotel-perguntas'),
    campoValor: $('hotel-valor'),
    erroValor: $('hotel-valor-erro'),
    caixa: $('hotel-resultado'),
    botao: $('hotel-ver'),
    entradaExtra: () => ({}),
  });

  desenharCategorias(() => { passagem.recalcularSeAberto(); hotel.recalcularSeAberto(); });
}

iniciar();
