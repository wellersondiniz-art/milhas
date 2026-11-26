// Formulário "Alerta de pontos por e-mail" (site/alertas/).
// Só DOM e rede; as partes puras ficam em pedido.js. Texto sempre por textContent.

import { abrirArmazem } from '../perfil/armazem.js';
import { conferirCampos, ESPERA_MS, montarCorpo, mensagemDaResposta, resumoDoPerfil } from './pedido.js';

const $ = (id) => document.getElementById(id);
const abertoEm = performance.now();

async function lerLista(nome) {
  const resposta = await fetch(`../dados/${nome}.json`, { cache: 'no-cache' });
  if (!resposta.ok) throw new Error(nome);
  return resposta.json();
}

function preencherSelect(select, itens) {
  const ordenados = [...itens].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  for (const item of ordenados) {
    const opcao = document.createElement('option');
    opcao.value = item.id;
    opcao.textContent = item.nome;
    select.append(opcao);
  }
}

function mostrarErros(erros) {
  const campos = { loja_id: 'alerta-loja', programa_id: 'alerta-programa', pontos_por_real: 'alerta-pontos', email: 'alerta-email', consentimento: 'alerta-consentimento' };
  let primeiro = null;
  for (const [campo, id] of Object.entries(campos)) {
    const entrada = $(id);
    const msg = erros[campo] ?? '';
    $(`${id}-erro`).textContent = msg;
    if (msg) {
      entrada.setAttribute('aria-invalid', 'true');
      primeiro ??= entrada;
    } else {
      entrada.removeAttribute('aria-invalid');
    }
  }
  primeiro?.focus();
  return Boolean(primeiro);
}

function status(texto, tipo) {
  const caixa = $('alerta-status');
  caixa.className = texto ? `alerta alerta--${tipo}` : '';
  caixa.textContent = texto;
}

async function iniciar() {
  const form = $('form-alerta');
  const botao = $('alerta-enviar');
  let dados;
  try {
    const [lojas, programas, cartoes] = await Promise.all(['lojas', 'programas', 'cartoes'].map(lerLista));
    dados = { lojas, programas, cartoes };
  } catch {
    $('perfil-resumo').textContent = 'Não conseguimos carregar a lista de lojas. Confira a internet e recarregue a página.';
    botao.disabled = true;
    return;
  }
  preencherSelect($('alerta-loja'), dados.lojas);
  preencherSelect($('alerta-programa'), dados.programas);
  const pedida = new URLSearchParams(location.search).get('loja');
  if (pedida && dados.lojas.some((l) => l.id === pedida)) $('alerta-loja').value = pedida;

  let armazem;
  try { armazem = abrirArmazem(window.localStorage); } catch { armazem = abrirArmazem(undefined); }
  const perfil = armazem.ler(dados);
  const resumo = resumoDoPerfil(perfil, dados);
  $('perfil-resumo').textContent = resumo
    ?? 'Você ainda não marcou nenhum programa ou cartão. O alerta precisa do seu perfil para fazer a conta: marque em Meu perfil e volte aqui.';
  if (!resumo) botao.disabled = true;

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    status('', 'sucesso');
    const campos = {
      loja_id: $('alerta-loja').value,
      programa_id: $('alerta-programa').value,
      pontos_por_real: $('alerta-pontos').value,
      email: $('alerta-email').value,
      consentimento: $('alerta-consentimento').checked,
      site: $('alerta-site').value,
    };
    if (mostrarErros(conferirCampos(campos))) return;
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), ESPERA_MS);
    try {
      const resposta = await fetch('/api/alertas/inscrever', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(montarCorpo(campos, perfil, performance.now() - abertoEm)),
        signal: controle.signal,
      });
      let corpo = null;
      try { corpo = await resposta.json(); } catch { corpo = null; }
      const { ok, texto, erros } = mensagemDaResposta(resposta.status, corpo);
      mostrarErros(erros);
      status(texto, ok ? 'sucesso' : 'perigo');
      if (ok) form.reset();
    } catch {
      status('Não conseguimos falar com o servidor. Confira a internet e tente de novo.', 'perigo');
    } finally {
      clearTimeout(relogio);
      botao.disabled = false;
      botao.textContent = 'Criar alerta';
    }
  });
}

iniciar();
