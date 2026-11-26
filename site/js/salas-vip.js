// Tela "Salas VIP pelo cartão". Só desenha: a ordem e os textos dos acessos
// vêm de motor/salas-vip.js. Nada de innerHTML: elementos via el() e textContent.
// O perfil é só lido (localStorage), para o filtro "Só os cartões do meu perfil".

import { cartoesComSalaVip, ouAConfirmar, textoDosAcessos } from './motor/salas-vip.js';
import { formatarCentavos, formatarData } from './motor/formatar.js';
import { abrirArmazem } from './perfil/armazem.js';
import { alerta } from './tela/resultado.js';
import { el } from './tela/dom.js';

const ARQUIVOS = ['programas', 'cartoes', 'salas-vip'];
const $ = (id) => document.getElementById(id);
const caixa = $('salas-lista');
const anuncio = $('salas-anuncio');

let dados = null;
let meusCartoes = [];

function linkFonte(url, rotulo, data) {
  return el('p', { class: 'texto-pequeno texto-suave' },
    el('a', { href: url, rel: 'noopener noreferrer', target: '_blank' }, rotulo),
    data ? ` · conferido em ${formatarData(data)}` : null);
}

function linha(rotulo, valor) {
  return el('li', {}, el('strong', {}, `${rotulo}: `), valor);
}

function blocoSala(sala) {
  const confirmado = sala.status !== 'A_CONFIRMAR';
  return el('div', { class: 'card__bloco pilha--sm' },
    el('p', { class: 'resultado__subtitulo' }, ouAConfirmar(sala.rede, 'Rede a confirmar')),
    el('p', {}, el('span', { class: `selo ${confirmado ? 'selo--sucesso' : 'selo--aviso'}` }, textoDosAcessos(sala))),
    el('ul', { class: 'resultado__lista' },
      linha('Quem usa', ouAConfirmar(sala.quem_usa)),
      linha('Acompanhantes', ouAConfirmar(sala.acompanhantes)),
      sala.condicoes ? linha('Condições', sala.condicoes) : null),
    sala.observacoes ? el('p', { class: 'texto-pequeno' }, sala.observacoes) : null,
    linkFonte(sala.fonte_url, 'Fonte oficial', sala.verificado_em),
    sala.regras_url ? linkFonte(sala.regras_url, 'Regras da sala') : null);
}

function cardDoCartao({ cartao, salas }) {
  const programa = dados.programas.find((p) => p.id === cartao.programa_id);
  const bandeira = cartao.bandeira && cartao.bandeira !== 'A_CONFIRMAR' ? cartao.bandeira : null;
  const anuidade = Number.isSafeInteger(cartao.anuidade_brl) ? `anuidade ${formatarCentavos(cartao.anuidade_brl)}` : null;
  const detalhes = [cartao.emissor, bandeira, programa ? `junta ${programa.nome}` : null, anuidade].filter(Boolean).join(' · ');
  return el('li', { class: 'card pilha--sm' },
    el('h3', { class: 'card__titulo' }, cartao.nome),
    el('p', { class: 'texto-pequeno texto-suave' }, detalhes),
    salas.map(blocoSala));
}

function desenhar() {
  const soMeus = $('salas-so-meus').checked;
  const { comSala, semInformacao } = cartoesComSalaVip(dados, soMeus ? { cartoes: meusCartoes } : {});
  caixa.removeAttribute('aria-busy');
  const partes = [];
  if (comSala.length) {
    partes.push(el('ul', { class: 'pilha lista-limpa' }, comSala.map(cardDoCartao)));
  } else {
    partes.push(alerta('info', 'Nenhum dos seus cartões tem sala VIP no nosso cadastro',
      el('p', {}, 'Tire a marca de "Só os cartões do meu perfil" para ver todos.')));
  }
  if (semInformacao.length) {
    partes.push(el('div', { class: 'pilha--sm' },
      el('h2', { class: 'resultado__subtitulo' }, 'Sem sala VIP confirmada'),
      el('p', { class: 'texto-pequeno texto-suave' },
        'Não achamos acesso grátis a sala VIP na página oficial destes cartões. Pode ser que não tenham, ou que a gente ainda não tenha conferido.'),
      el('ul', { class: 'resultado__lista' }, semInformacao.map((c) => el('li', {}, c.nome)))));
  }
  caixa.replaceChildren(...partes);
  anuncio.textContent = '';
  setTimeout(() => {
    anuncio.textContent = `${comSala.length} ${comSala.length === 1 ? 'cartão com sala VIP' : 'cartões com sala VIP'}.`;
  }, 50);
}

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
    caixa.removeAttribute('aria-busy');
    caixa.replaceChildren(alerta('perigo', 'Não deu para carregar', el('p', {}, 'Confira a sua internet e recarregue a página.')));
    return;
  }
  const salvo = abrirArmazem(globalThis.localStorage).ler(dados);
  meusCartoes = salvo?.cartoes ?? [];
  const filtro = $('salas-filtro');
  const soMeus = $('salas-so-meus');
  if (meusCartoes.length) {
    filtro.hidden = false;
    $('salas-so-meus-ajuda').textContent = `Você marcou ${meusCartoes.length} ${meusCartoes.length === 1 ? 'cartão' : 'cartões'} em Meu perfil.`;
    soMeus.setAttribute('aria-describedby', 'salas-so-meus-ajuda');
    soMeus.addEventListener('change', desenhar);
    filtro.addEventListener('submit', (e) => e.preventDefault());
  }
  desenhar();
}

iniciar();
