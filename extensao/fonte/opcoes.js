// Página de opções: escolher cartões e programas, ou trazer o perfil exportado
// pelo site. O perfil fica só em chrome.storage.local, no mesmo formato do
// arquivo "Exportar perfil" do site (versão 2), lido e validado pelo mesmo
// código do site (perfil/formato.js).

import { DADOS } from './dados.js';
import { limparPerfil, perfilVazio, validarImportacao } from './perfil/formato.js';
import { agoraEmSaoPaulo } from './relogio.js';

const CHAVE = 'perfil';
const $ = (id) => document.getElementById(id);

function el(tag, atributos = {}, ...filhos) {
  const no = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos)) if (v !== false && v != null) no.setAttribute(k, v === true ? '' : String(v));
  for (const f of filhos) no.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return no;
}

const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');

async function lerPerfil() {
  try {
    const guardado = await chrome.storage.local.get(CHAVE);
    return limparPerfil(guardado[CHAVE], DADOS) ?? perfilVazio();
  } catch {
    return perfilVazio();
  }
}

function avisar(texto) {
  $('aviso').textContent = texto;
}

function mostrar(perfil) {
  const programas = new Map(perfil.programas.map((p) => [p.programa_id, p]));
  const cartoes = new Set(perfil.cartoes);

  $('programas').replaceChildren(...[...DADOS.programas].sort(porNome).map((p) => {
    const marcado = programas.get(p.id);
    const tem = el('input', { type: 'checkbox', name: 'programa', value: p.id, id: `p-${p.id}`, checked: Boolean(marcado) });
    const clube = el('input', { type: 'checkbox', name: 'clube', value: p.id, id: `c-${p.id}`, checked: Boolean(marcado?.clube_ativo) });
    return el('li', {},
      el('label', { for: `p-${p.id}` }, tem, p.nome),
      el('label', { for: `c-${p.id}`, class: 'clube' }, clube, `Tenho o clube ${p.nome}`));
  }));

  $('cartoes').replaceChildren(...[...DADOS.cartoes].sort(porNome).map((c) => el('li', {},
    el('label', { for: `k-${c.id}` },
      el('input', { type: 'checkbox', name: 'cartao', value: c.id, id: `k-${c.id}`, checked: cartoes.has(c.id) }),
      c.nome))));
}

async function salvar(perfil) {
  await chrome.storage.local.set({ [CHAVE]: perfil });
}

async function iniciar() {
  let atual = await lerPerfil();
  mostrar(atual);

  $('formulario').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const form = new FormData(evento.target);
    const clubes = new Set(form.getAll('clube'));
    const antes = new Map(atual.programas.map((p) => [p.programa_id, p]));
    const programas = form.getAll('programa').map((id) => {
      const item = { programa_id: id, clube_ativo: clubes.has(id) };
      const desde = antes.get(id)?.clube_ativo_desde;
      if (item.clube_ativo && desde) item.clube_ativo_desde = desde;
      return item;
    });
    // Milheiro e cotação do dólar só chegam pelo arquivo do site: ficam como estavam.
    atual = limparPerfil({ ...atual, programas, cartoes: form.getAll('cartao') }, DADOS);
    await salvar(atual);
    avisar('Pronto, salvo neste navegador.');
  });

  $('apagar').addEventListener('click', async () => {
    await chrome.storage.local.remove(CHAVE);
    atual = perfilVazio();
    mostrar(atual);
    avisar('Perfil apagado deste navegador.');
  });

  $('arquivo').addEventListener('change', async (evento) => {
    const arquivo = evento.target.files?.[0];
    $('erros').replaceChildren();
    if (!arquivo) return;
    const texto = await arquivo.text();
    const hoje = agoraEmSaoPaulo(new Date()).slice(0, 10);
    const resultado = validarImportacao(texto, DADOS, hoje);
    evento.target.value = '';
    if (!resultado.ok) {
      $('erros').replaceChildren(...resultado.erros.map((e) => el('li', {}, e)));
      avisar('');
      return;
    }
    atual = resultado.perfil;
    await salvar(atual);
    mostrar(atual);
    avisar('Perfil do site trazido e salvo neste navegador.');
  });
}

iniciar().catch(() => avisar('Não deu para abrir o perfil. Feche esta aba e tente de novo.'));
