// Tela "Quanto rende abastecer" (abastecer/index.html).
// Lê o formulário, chama o motor (calcularAbastecimento) e mostra o que ele
// devolveu. Nenhuma conta aqui. O preço do litro digitado não é guardado:
// ele só existe no campo e na conta desta tela.

import { COMBUSTIVEIS, calcularAbastecimento, dataHoraEmSaoPaulo, formatarCentavos } from './motor/index.js';
import { abrirArmazem } from './perfil/armazem.js';
import { dadosComCartoesDaPessoa, ehVazio, perfilDeTodos, perfilParaConta } from './perfil/formato.js';
import { aplicarMascara, erroDoValor, VALOR_MAXIMO_CENTAVOS } from './tela/moeda.js';
import { alerta, montarCarregando } from './tela/resultado.js';
import { el } from './tela/dom.js';
import { anuncioDoAbastecimento, lerLitros, mascaraPreco, tituloDoAbastecimento } from './tela/abastecer-textos.js';
import { montarResultadoAbastecer } from './tela/abastecer-resultado.js';

const RAIZ = '../';
const ARQUIVOS = { programas: 'programas', cartoes: 'cartoes', cambio: 'cambio', redes_postos: 'redes-postos', regras_postos: 'regras-postos' };

const $ = (id) => document.getElementById(id);
const formulario = $('abastecer-formulario');
const campoRede = $('abastecer-rede');
const campoCombustivel = $('abastecer-combustivel');
const campoLitros = $('abastecer-litros');
const erroLitros = $('abastecer-litros-erro');
const campoReais = $('abastecer-reais');
const erroReais = $('abastecer-reais-erro');
const campoPreco = $('abastecer-preco');
const botao = $('abastecer-ver');
const passoResultado = $('abastecer-passo-resultado');
const titulo = $('abastecer-titulo');
const resultado = $('abastecer-resultado');
const anuncio = $('abastecer-anuncio');

let dados = null;
const armazem = abrirArmazem((() => { try { return globalThis.localStorage; } catch { return undefined; } })());

for (const [id, nome] of Object.entries(COMBUSTIVEIS)) campoCombustivel.append(el('option', { value: id }, nome));

function medida() {
  return formulario.querySelector('input[name="abastecer-medida"]:checked').value;
}

function marcarErro(campo, caixa, mensagem) {
  caixa.textContent = mensagem;
  if (mensagem) campo.setAttribute('aria-invalid', 'true');
  else campo.removeAttribute('aria-invalid');
}

for (const radio of formulario.querySelectorAll('input[name="abastecer-medida"]')) {
  radio.addEventListener('change', () => {
    const emLitros = medida() === 'litros';
    $('campo-litros').hidden = !emLitros;
    $('campo-reais').hidden = emLitros;
  });
}

campoReais.addEventListener('input', () => {
  const { texto, cortado } = aplicarMascara(campoReais.value);
  campoReais.value = texto;
  marcarErro(campoReais, erroReais, cortado ? `O valor máximo é ${formatarCentavos(VALOR_MAXIMO_CENTAVOS)}.` : '');
});

campoPreco.addEventListener('input', () => {
  campoPreco.value = mascaraPreco(campoPreco.value).texto;
});

let esperaAnuncio = 0;
function anunciar(texto) {
  clearTimeout(esperaAnuncio);
  anuncio.textContent = '';
  if (texto) esperaAnuncio = setTimeout(() => { anuncio.textContent = texto; }, 150);
}

function mostrarErro(tituloAlerta, mensagem, aoTentar) {
  const tentar = el('button', { type: 'button', class: 'botao botao--secundario' }, 'Tentar de novo');
  tentar.addEventListener('click', aoTentar);
  passoResultado.hidden = false;
  resultado.removeAttribute('aria-busy');
  resultado.replaceChildren(alerta('perigo', tituloAlerta, el('p', {}, mensagem), tentar));
}

/** Lê o formulário. Devolve o abastecimento para o motor, ou null (e marca o erro). */
function lerFormulario() {
  const base = {
    tipo: 'combustivel',
    combustivel: campoCombustivel.value,
    rede_id: campoRede.value || null,
    preco_litro_milesimos: mascaraPreco(campoPreco.value).milesimos,
  };
  if (medida() === 'litros') {
    marcarErro(campoReais, erroReais, '');
    const { ml, erro } = lerLitros(campoLitros.value);
    marcarErro(campoLitros, erroLitros, erro);
    if (erro) { campoLitros.focus(); return null; }
    return { ...base, litros_ml: ml };
  }
  marcarErro(campoLitros, erroLitros, '');
  const { centavos } = aplicarMascara(campoReais.value);
  const erro = erroDoValor(centavos).replace('a compra', 'o abastecimento');
  marcarErro(campoReais, erroReais, erro);
  if (erro) { campoReais.focus(); return null; }
  return { ...base, valor_centavos: centavos };
}

function calcular() {
  const abastecimento = lerFormulario();
  if (!abastecimento || !dados) return;
  const semPerfil = ehVazio(perfilSalvo());
  // Os cartões que a pessoa adicionou em "Meu perfil" entram como os do cadastro.
  const dadosDaConta = dadosComCartoesDaPessoa(dados, perfilSalvo());
  const perfil = semPerfil ? perfilDeTodos(dadosDaConta, perfilSalvo()?.cotacao_dolar) : perfilParaConta(perfilSalvo());
  passoResultado.hidden = false;
  try {
    const r = calcularAbastecimento(perfil, abastecimento, dadosDaConta, dataHoraEmSaoPaulo(new Date()));
    const nomeRede = dados.redes_postos.find((x) => x.id === abastecimento.rede_id)?.nome;
    const texto = tituloDoAbastecimento(r.abastecimento, nomeRede);
    titulo.textContent = texto[0].toUpperCase() + texto.slice(1);
    resultado.replaceChildren(montarResultadoAbastecer(r, { semPerfil, raiz: RAIZ }));
    anunciar(anuncioDoAbastecimento(r, texto));
  } catch (erro) {
    console.error(erro);
    anunciar('');
    titulo.textContent = 'Não deu para calcular';
    mostrarErro('Não deu para calcular', 'Algo nos dados ou no que foi digitado não fechou. Confira e tente de novo. Se continuar, o problema é nosso.', () => calcular());
  }
  titulo.focus();
}

formulario.addEventListener('submit', (evento) => {
  evento.preventDefault();
  calcular();
});

let perfilEmMemoria;
function perfilSalvo() {
  if (perfilEmMemoria === undefined) perfilEmMemoria = armazem.ler(dados);
  return perfilEmMemoria;
}

async function buscarLista(nome) {
  const resposta = await fetch(`${RAIZ}dados/${nome}.json`, { cache: 'no-cache' });
  if (!resposta.ok) throw new Error(`dados/${nome}.json respondeu ${resposta.status}`);
  const lista = await resposta.json();
  if (!Array.isArray(lista)) throw new Error(`dados/${nome}.json não é uma lista`);
  return lista;
}

async function carregar() {
  botao.disabled = true;
  passoResultado.hidden = false;
  titulo.textContent = 'Carregando as redes de postos…';
  resultado.setAttribute('aria-busy', 'true');
  resultado.replaceChildren(montarCarregando());
  try {
    const listas = await Promise.all(Object.values(ARQUIVOS).map(buscarLista));
    dados = Object.fromEntries(Object.keys(ARQUIVOS).map((chave, i) => [chave, listas[i]]));
  } catch (erro) {
    console.error(erro);
    titulo.textContent = 'Não deu para carregar';
    mostrarErro('A internet falhou ou o site está fora do ar', 'Não conseguimos buscar as redes de postos. Confira a sua internet e tente de novo.', () => carregar());
    return;
  }
  for (const rede of [...dados.redes_postos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))) {
    const apelidos = rede.outros_nomes?.length ? ` (${rede.outros_nomes.join(', ')})` : '';
    campoRede.append(el('option', { value: rede.id }, `${rede.nome}${apelidos}`));
  }
  campoRede.disabled = false;
  botao.disabled = false;
  resultado.removeAttribute('aria-busy');
  resultado.replaceChildren();
  passoResultado.hidden = true;
}

carregar();
