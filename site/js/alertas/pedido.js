// Partes puras do formulário de alertas (testadas com node --test).
// A validação de verdade é a do servidor (servidor/alertas/regras.js); a da
// página só ajuda quem digita.

import { ehCartaoProprio } from '../perfil/formato.js';

/** Quanto tempo a página espera a resposta do servidor. */
export const ESPERA_MS = 15_000;

export const ERROS_LOCAIS = Object.freeze({
  loja_id: 'Escolha a loja.',
  pontos_por_real: 'Escreva um número, como 10 ou 2,5.',
  email: 'Escreva um e-mail válido, como nome@exemplo.com.br.',
  consentimento: 'Marque que quer receber os e-mails.',
});

/** Confere o básico antes de enviar. Devolve { campo: mensagem }. */
export function conferirCampos({ loja_id, pontos_por_real, email, consentimento }) {
  const erros = {};
  if (!loja_id) erros.loja_id = ERROS_LOCAIS.loja_id;
  if (!/^\s*\d{1,4}([.,]\d{1,2})?\s*$/.test(pontos_por_real ?? '') || /^\s*0+([.,]0+)?\s*$/.test(pontos_por_real)) {
    erros.pontos_por_real = ERROS_LOCAIS.pontos_por_real;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((email ?? '').trim())) erros.email = ERROS_LOCAIS.email;
  if (consentimento !== true) erros.consentimento = ERROS_LOCAIS.consentimento;
  return erros;
}

/**
 * Corpo do POST /api/alertas/inscrever. O perfil vai como está no aparelho;
 * o servidor guarda só ids, clube e data do clube.
 */
export function montarCorpo(campos, perfil, tempoNoFormularioMs) {
  return {
    email: campos.email.trim(),
    loja_id: campos.loja_id,
    programa_id: campos.programa_id || null,
    pontos_por_real: campos.pontos_por_real.trim(),
    consentimento: campos.consentimento === true,
    // Os cartões adicionados pela pessoa ("meu-1"…) não saem do aparelho.
    perfil: perfil ? { programas: perfil.programas, cartoes: perfil.cartoes.filter((id) => !ehCartaoProprio(id)) } : null,
    site: campos.site ?? '',
    tempo_no_formulario_ms: Math.max(0, Math.round(tempoNoFormularioMs)),
  };
}

/** "Azul Fidelidade (com clube) e Livelo; cartões: X e Y." */
export function resumoDoPerfil(perfil, dados) {
  if (!perfil || (perfil.programas.length === 0 && perfil.cartoes.length === 0)) return null;
  const nome = (lista, id) => lista.find((i) => i.id === id)?.nome ?? id;
  const juntar = (itens) => (itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`);
  const programas = perfil.programas.map((p) => `${nome(dados.programas, p.programa_id)}${p.clube_ativo ? ' (com clube)' : ''}`);
  const cartoes = perfil.cartoes.map((id) => nome(dados.cartoes, id));
  const partes = [];
  if (programas.length) partes.push(`Programas: ${juntar(programas)}.`);
  if (cartoes.length) partes.push(`Cartões: ${juntar(cartoes)}.`);
  return partes.join(' ');
}

/** Mensagem para a resposta do servidor (status + corpo JSON). */
export function mensagemDaResposta(status, corpo) {
  if (corpo && typeof corpo.mensagem === 'string') return { ok: Boolean(corpo.ok), texto: corpo.mensagem, erros: corpo.erros ?? {} };
  if (status === 429) return { ok: false, texto: 'Muitos pedidos agora. Tente de novo em alguns minutos.', erros: {} };
  return { ok: false, texto: 'Não conseguimos criar o alerta agora. Tente de novo em alguns minutos.', erros: {} };
}
