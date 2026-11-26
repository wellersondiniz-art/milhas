// Rodada de alertas: roda depois da atualização semanal das ofertas.
//
// Para cada e-mail confirmado:
//   1. avalia cada alerta com o motor (avaliar.js);
//   2. junta num e-mail só os alertas que bateram o alvo E que ainda não
//      foram avisados com a mesma oferta e os mesmos pontos;
//   3. respeita o limite de e-mails por semana (limite.js);
//   4. grava o que foi avisado. Alerta que deixou de bater o alvo volta a
//      poder avisar quando bater de novo.
// Também apaga os pedidos que ninguém confirmou no prazo.
//
// O resumo e o log só têm contagens: nada de e-mail, id ou loja por pessoa.

import { avaliarAlerta } from './avaliar.js';
import { alertaParaTexto, urlDeCancelar } from './fluxo.js';
import { emailDeAlerta } from './emails.js';
import { podeEnviarAlerta } from './limite.js';
import { limitesDeAlertas } from '../plano/regras.js';
import { assinaturaDeCancelamento } from './tokens.js';
import { dataHoraEmSaoPaulo } from './regras.js';

/**
 * @param {object} deps
 * @param {object} deps.repo
 * @param {object|null} deps.correio   null = simulação: avalia e conta, não envia nem grava
 * @param {string} deps.segredo
 * @param {string} deps.urlSite
 * @param {object} deps.dados
 * @param {Date} deps.agora
 */
export async function rodarAlertas({ repo, correio, segredo, urlSite, dados, agora }) {
  const simular = !correio;
  const hoje = dataHoraEmSaoPaulo(agora);
  const resumo = {
    simulacao: simular,
    pedidos_vencidos_apagados: 0,
    contadores_antigos_apagados: 0,
    inscricoes: 0,
    alertas_avaliados: 0,
    alertas_no_alvo: 0,
    emails_enviados: 0,
    emails_barrados_pelo_limite: 0,
    erros_de_envio: 0,
    erros_de_avaliacao: 0,
  };
  if (!simular) {
    resumo.pedidos_vencidos_apagados = await repo.apagarNaoConfirmadasVencidas(agora);
    // Contadores do limite de pedidos: só o dia de hoje e o de ontem importam.
    const anteontem = new Date(agora.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    resumo.contadores_antigos_apagados = await repo.apagarContadoresAntes(anteontem);
  }

  // Quem tem o plano pago pode receber mais e-mails por semana.
  const comPlano = (await repo.emailsComPlano?.(agora)) ?? new Set();

  for await (const inscricao of repo.inscricoesConfirmadas()) {
    resumo.inscricoes += 1;
    const disparos = [];
    const voltaramAoNormal = [];
    for (const alerta of inscricao.alertas) {
      resumo.alertas_avaliados += 1;
      let avaliacao;
      try {
        avaliacao = avaliarAlerta(alerta, inscricao.perfil, dados, hoje);
      } catch {
        resumo.erros_de_avaliacao += 1;
        continue;
      }
      if (!avaliacao.dispara) {
        if (alerta.ultimo_aviso_chave) voltaramAoNormal.push(alerta);
        continue;
      }
      resumo.alertas_no_alvo += 1;
      if (avaliacao.chave === alerta.ultimo_aviso_chave) continue; // já avisado
      disparos.push({ alerta, avaliacao });
    }

    if (!simular) {
      for (const alerta of voltaramAoNormal) await repo.atualizarAlerta(alerta.id, { ultimo_aviso_chave: null });
    }
    if (!disparos.length) continue;

    const limite = podeEnviarAlerta(inscricao.alertas_recentes, agora, limitesDeAlertas(comPlano.has(inscricao.email)).alertasPorSemana);
    if (!limite.ok) {
      // Não grava a chave: se continuar no alvo, avisa quando o limite liberar.
      resumo.emails_barrados_pelo_limite += 1;
      if (!simular) await repo.registrarEnvio({ tipo: 'alerta', resultado: 'limite', quantidade_alertas: disparos.length });
      continue;
    }
    if (simular) {
      resumo.emails_enviados += 1;
      continue;
    }

    const assinatura = await assinaturaDeCancelamento(segredo, inscricao.id);
    const email = emailDeAlerta({
      disparos: disparos.map(({ alerta, avaliacao }) => ({
        alerta: alertaParaTexto(alerta, dados),
        melhor: avaliacao.melhor,
        urlLoja: `${urlSite}/loja/${alerta.loja_id}/`,
      })),
      urlCancelar: urlDeCancelar(urlSite, inscricao.id, assinatura),
    });
    try {
      await correio.enviar({
        para: inscricao.email,
        ...email,
        // Mesma rodada repetida no mesmo dia não manda o e-mail duas vezes.
        idempotencia: `alerta-${inscricao.id}-${hoje.slice(0, 10)}`,
      });
    } catch (erro) {
      resumo.erros_de_envio += 1;
      await repo.registrarEnvio({ tipo: 'alerta', resultado: 'erro', quantidade_alertas: disparos.length, status_http: erro?.status ?? null });
      continue;
    }
    resumo.emails_enviados += 1;
    await repo.atualizarInscricao(inscricao.id, { alertas_recentes: limite.depois });
    for (const { alerta, avaliacao } of disparos) {
      await repo.atualizarAlerta(alerta.id, { ultimo_aviso_chave: avaliacao.chave, ultimo_aviso_em: agora.toISOString() });
    }
    await repo.registrarEnvio({ tipo: 'alerta', resultado: 'enviado', quantidade_alertas: disparos.length });
  }
  return resumo;
}
