// Inscrição com duplo opt-in, confirmação e cancelamento.
//
// O repositório e o correio chegam de fora (Supabase e Resend no ar; versões
// em memória nos testes). Nada aqui escreve e-mail em log.
//
// Contra enumeração de e-mails: a inscrição responde sempre a mesma coisa,
// exista o e-mail ou não, esteja confirmado ou não, tenha estourado o limite
// ou não. O pedido só vale depois do clique no link enviado AO PRÓPRIO
// endereço, então ninguém muda o alerta de outra pessoa.

import { LIMITES } from './regras.js';
import { limitesDeAlertas } from '../plano/regras.js';
import { podeEnviarConfirmacao, validadeDaConfirmacao } from './limite.js';
import { assinaturaDeCancelamento, conferirCancelamento, novoToken, resumo, TOKEN, UUID } from './tokens.js';
import { emailDeConfirmacao } from './emails.js';

export function urlDeCancelar(urlSite, inscricaoId, assinatura) {
  return `${urlSite}/api/alertas/cancelar?i=${encodeURIComponent(inscricaoId)}&a=${encodeURIComponent(assinatura)}`;
}

function nomeDe(lista, id) {
  return lista.find((item) => item.id === id)?.nome ?? id;
}

export function alertaParaTexto(alerta, dados) {
  return {
    loja: nomeDe(dados.lojas, alerta.loja_id),
    programa: alerta.programa_id ? nomeDe(dados.programas, alerta.programa_id) : null,
    minimo_centesimos: alerta.minimo_centesimos,
  };
}

/**
 * @param {object} pedido  saída de validarInscricao
 * @param {object} deps    { repo, correio, segredo, urlSite, dados, agora: Date }
 * @returns {Promise<{resultado: 'enviado'|'limite'|'erro_envio'}>}
 *   Só para log e testes: a resposta ao navegador é sempre a mesma.
 */
export async function inscrever(pedido, { repo, correio, segredo, urlSite, dados, agora }) {
  const pendente = {
    loja_id: pedido.loja_id,
    programa_id: pedido.programa_id,
    minimo_centesimos: pedido.minimo_centesimos,
    perfil: pedido.perfil,
  };
  let inscricao = await repo.inscricaoPorEmail(pedido.email);
  if (!inscricao) {
    // Já nasce com prazo: se ninguém confirmar, a rodada semanal apaga.
    inscricao = await repo.criarInscricao({
      email: pedido.email, pendente: null, confirmacoes_recentes: [], token_expira_em: validadeDaConfirmacao(agora).toISOString(),
    })
      // Duas inscrições ao mesmo tempo: a segunda acha a primeira.
      ?? await repo.inscricaoPorEmail(pedido.email);
  }
  const limite = podeEnviarConfirmacao(inscricao.confirmacoes_recentes, agora);
  if (!limite.ok) {
    await repo.registrarEnvio({ tipo: 'confirmacao', resultado: 'limite', quantidade_alertas: 1 });
    return { resultado: 'limite' };
  }
  const token = novoToken();
  await repo.atualizarInscricao(inscricao.id, {
    token_hash: await resumo(token),
    token_expira_em: validadeDaConfirmacao(agora).toISOString(),
    pendente,
    confirmacoes_recentes: limite.depois,
  });
  const assinatura = await assinaturaDeCancelamento(segredo, inscricao.id);
  const email = emailDeConfirmacao({
    urlConfirmar: `${urlSite}/api/alertas/confirmar?t=${token}`,
    urlCancelar: urlDeCancelar(urlSite, inscricao.id, assinatura),
    alerta: alertaParaTexto(pendente, dados),
    horas: LIMITES.horasParaConfirmar,
  });
  try {
    await correio.enviar({ para: pedido.email, ...email });
  } catch (erro) {
    await repo.registrarEnvio({ tipo: 'confirmacao', resultado: 'erro', quantidade_alertas: 1, status_http: erro?.status ?? null });
    return { resultado: 'erro_envio' };
  }
  await repo.registrarEnvio({ tipo: 'confirmacao', resultado: 'enviado', quantidade_alertas: 1 });
  return { resultado: 'enviado' };
}

/**
 * Aplica o pedido pendente da inscrição dona do token.
 * @returns {Promise<{resultado: 'confirmado'|'invalido'|'limite_de_alertas', alerta?: object}>}
 */
export async function confirmar(token, { repo, agora }) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return { resultado: 'invalido' };
  const inscricao = await repo.inscricaoPorToken(await resumo(token));
  if (!inscricao || !inscricao.pendente || !inscricao.token_expira_em || new Date(inscricao.token_expira_em) < agora) {
    return { resultado: 'invalido' };
  }
  const { pendente } = inscricao;
  const alertas = await repo.alertasDe(inscricao.id);
  const igual = alertas.find((a) => a.loja_id === pendente.loja_id && (a.programa_id ?? null) === (pendente.programa_id ?? null));
  // O link vale uma vez só, mesmo quando o pedido é recusado.
  const usarToken = { token_hash: null, token_expira_em: null, pendente: null };
  // O plano pago aumenta o limite; o grátis segue em LIMITES.alertasPorEmail.
  const { alertasPorEmail } = limitesDeAlertas(Boolean(await repo.temPlano?.(inscricao.email, agora)));
  if (!igual && alertas.length >= alertasPorEmail) {
    await repo.atualizarInscricao(inscricao.id, usarToken);
    return { resultado: 'limite_de_alertas', limite: alertasPorEmail };
  }
  if (igual) {
    await repo.atualizarAlerta(igual.id, { minimo_centesimos: pendente.minimo_centesimos, ultimo_aviso_chave: null });
  } else {
    await repo.criarAlerta({
      inscricao_id: inscricao.id,
      loja_id: pendente.loja_id,
      programa_id: pendente.programa_id ?? null,
      minimo_centesimos: pendente.minimo_centesimos,
    });
  }
  await repo.atualizarInscricao(inscricao.id, {
    ...usarToken,
    perfil: pendente.perfil, // o perfil mais recente vale para todos os alertas do e-mail
    confirmado_em: inscricao.confirmado_em ?? agora.toISOString(),
  });
  return { resultado: 'confirmado', alerta: pendente };
}

/**
 * Cancela tudo do e-mail: apaga a inscrição, e o banco apaga os alertas junto.
 * Responde igual exista a inscrição ou não.
 * @returns {Promise<{resultado: 'cancelado'|'invalido'}>}
 */
export async function cancelar(inscricaoId, assinatura, { repo, segredo }) {
  if (typeof inscricaoId !== 'string' || !UUID.test(inscricaoId)) return { resultado: 'invalido' };
  if (!await conferirCancelamento(segredo, inscricaoId, assinatura)) return { resultado: 'invalido' };
  await repo.apagarInscricao(inscricaoId);
  await repo.registrarEnvio({ tipo: 'cancelamento', resultado: 'feito', quantidade_alertas: 0 });
  return { resultado: 'cancelado' };
}
