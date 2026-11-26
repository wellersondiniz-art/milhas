#!/usr/bin/env node
// Rodada semanal dos alertas por e-mail (roda no GitHub Actions depois que a
// atualização das ofertas entra na main: .github/workflows/alertas.yml).
//
// Usa o MESMO motor da calculadora (site/js/motor/), pelos módulos de
// servidor/alertas/. Lê as ofertas de dados/*.json, já validadas.
//
// Ambiente (segredos do GitHub, ambiente "alertas"):
//   SUPABASE_URL, SUPABASE_SECRET_KEY (chave secreta só para o GitHub),
//   RESEND_API_KEY, ALERTAS_REMETENTE, ALERTAS_SEGREDO (o mesmo da Cloudflare)
//   ALERTAS_URL_SITE (opcional; padrão: URL_BASE de scripts/paginas/config.js)
//
// Uso:
//   node scripts/alertas/enviar.js              envia de verdade
//   node scripts/alertas/enviar.js --simular    avalia e conta; não envia nem grava
// Sem configuração, avisa e sai com 0 (o robô não fica vermelho por isso).
// A saída só tem contagens: nada de e-mail, loja ou id por pessoa.

import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { lerDados } from '../gerar-paginas.js';
import { validarDados } from '../validar-dados.js';
import { URL_BASE } from '../paginas/config.js';
import { repositorioSupabase } from '../../servidor/alertas/supabase.js';
import { clienteResend } from '../../servidor/alertas/resend.js';
import { rodarAlertas } from '../../servidor/alertas/rodada.js';
import { dataHoraEmSaoPaulo } from '../../servidor/alertas/regras.js';

const RAIZ = new URL('../../', import.meta.url);
const NECESSARIAS = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'RESEND_API_KEY', 'ALERTAS_REMETENTE', 'ALERTAS_SEGREDO'];

/** Nomes das variáveis que faltam (nunca o valor). */
export function faltando(env, simular) {
  const precisa = simular ? ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] : NECESSARIAS;
  return precisa.filter((nome) => !env[nome]);
}

export function textoDoResumo(resumo) {
  return [
    resumo.simulacao ? 'Simulação: nada foi enviado nem gravado.' : 'Rodada de alertas concluída.',
    `Pedidos não confirmados apagados: ${resumo.pedidos_vencidos_apagados}`,
    `Contadores antigos do limite de pedidos apagados: ${resumo.contadores_antigos_apagados ?? 0}`,
    `E-mails com alerta: ${resumo.inscricoes}`,
    `Alertas avaliados: ${resumo.alertas_avaliados} (no alvo: ${resumo.alertas_no_alvo})`,
    `E-mails ${resumo.simulacao ? 'que seriam enviados' : 'enviados'}: ${resumo.emails_enviados}`,
    `Barrados pelo limite semanal: ${resumo.emails_barrados_pelo_limite}`,
    `Erros de envio: ${resumo.erros_de_envio}; erros de avaliação: ${resumo.erros_de_avaliacao}`,
  ].join('\n');
}

export async function principal({ env = process.env, argv = process.argv.slice(2), agora = new Date(), fetch: buscar = globalThis.fetch } = {}) {
  const { values } = parseArgs({ args: argv, options: { simular: { type: 'boolean', default: false } } });
  const falta = faltando(env, values.simular);
  if (falta.length) {
    console.log(`Alertas desligados: faltam ${falta.join(', ')}. Nada a fazer.`);
    return 0;
  }
  const pastaDados = new URL('dados/', RAIZ);
  const { erros } = await validarDados(pastaDados, { hoje: dataHoraEmSaoPaulo(agora).slice(0, 10) });
  if (erros.length) {
    console.error(`Dados inválidos (${erros.length} erro(s)); nenhum alerta foi enviado. Rode npm run validar.`);
    return 1;
  }
  const dados = await lerDados(pastaDados);
  const repo = repositorioSupabase({ url: env.SUPABASE_URL, chave: env.SUPABASE_SECRET_KEY, fetch: buscar });
  if (!repo) {
    console.error('SUPABASE_URL inválida (use https://<projeto>.supabase.co).');
    return 1;
  }
  const correio = values.simular ? null : clienteResend({ chave: env.RESEND_API_KEY, remetente: env.ALERTAS_REMETENTE, fetch: buscar });
  const urlSite = (env.ALERTAS_URL_SITE || URL_BASE).replace(/\/$/, '');
  try {
    const resumo = await rodarAlertas({ repo, correio, segredo: env.ALERTAS_SEGREDO ?? '', urlSite, dados, agora });
    console.log(textoDoResumo(resumo));
    return resumo.erros_de_envio || resumo.erros_de_avaliacao ? 1 : 0;
  } catch (erro) {
    // Só a mensagem nossa (status), nunca o corpo da resposta.
    console.error(`A rodada parou: ${erro.message}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await principal();
}
