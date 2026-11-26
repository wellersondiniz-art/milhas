// Regras dos alertas por e-mail ("me avise quando a [loja] tiver [X] pontos
// por real ou mais para o meu perfil"). Funções puras: nada de rede, relógio
// ou banco aqui. Quem chama passa a data e os dados.
//
// Unidades (iguais às da tabela alertas do modelo de contas):
//   - pontos por real mínimo em CENTÉSIMOS inteiros: 250 = 2,5 pontos por real;
//   - dinheiro em centavos inteiros.

import { limparPerfil } from '../../site/js/perfil/formato.js';

export const LIMITES = Object.freeze({
  /** Corpo do pedido de inscrição, em bytes. Um perfil real tem poucos KB. */
  corpoBytes: 8192,
  /** Alertas guardados por e-mail. */
  alertasPorEmail: 10,
  /** E-mails de alerta por pessoa (e-mail) em 7 dias corridos. */
  alertasPorSemana: 2,
  /** E-mails de confirmação para o mesmo endereço em 24 horas. */
  confirmacoesPorDia: 3,
  /** Pedidos de inscrição aceitos do mesmo endereço de internet (IP) por dia. */
  pedidosPorIpPorDia: 10,
  /**
   * Pedidos de inscrição aceitos por dia, somando todo mundo. Teto contra quem
   * troca de IP: segura o gasto de e-mail e a reputação do domínio. O plano
   * grátis do Resend manda 100 e-mails por dia; 80 deixa folga.
   */
  pedidosPorDiaNoTotal: 80,
  /** Validade do link de confirmação, em horas. */
  horasParaConfirmar: 48,
  /** Mínimo aceito, em centésimos de ponto por real: de 0,01 a 1.000. */
  minimoCentesimos: 1,
  maximoCentesimos: 100_000,
  /** Programas e cartões no retrato do perfil (iguais aos limites das contas). */
  programasNoPerfil: 30,
  cartoesNoPerfil: 50,
  /** Tempo mínimo preenchendo o formulário (contra robô), em ms. */
  tempoMinimoMs: 2000,
});

/**
 * Valor de compra usado para medir "pontos por real": R$ 1.000,00.
 * O motor é linear no valor, então qualquer valor daria o mesmo resultado,
 * menos no cartão em dólar (a divisão pela cotação corta casas). Com R$ 1.000
 * o corte some na casa dos centésimos.
 */
export const VALOR_DE_REFERENCIA_CENTAVOS = 100_000;

/** Mesmo formato dos ids dos JSON e do domain id_cadastro do banco. */
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEIS_DIGITOS = /[0-9]{6}/;

export function idValido(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 64 && ID.test(id) && !SEIS_DIGITOS.test(id);
}

// E-mail: conferência simples (o duplo opt-in prova que o endereço existe).
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Minúsculas e sem espaços nas pontas; null se não parecer e-mail. */
export function normalizarEmail(texto) {
  if (typeof texto !== 'string') return null;
  const email = texto.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL.test(email)) return null;
  if (email.split('@')[0].length > 64) return null;
  return email;
}

/**
 * "2,5" ou "2.5" ou 2.5 → 250 (centésimos). Aceita até 2 casas.
 * null se não for número ou se passar dos limites.
 */
export function lerMinimo(valor) {
  const texto = typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : valor;
  if (typeof texto !== 'string') return null;
  const m = /^\s*(\d{1,4})(?:[.,](\d{1,2}))?\s*$/.exec(texto);
  if (!m) return null;
  const centesimos = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (centesimos < LIMITES.minimoCentesimos || centesimos > LIMITES.maximoCentesimos) return null;
  return centesimos;
}

/** 250 → "2,5"; 1200 → "12"; 1234 → "12,34". */
export function formatarMinimo(centesimos) {
  const inteiro = Math.trunc(centesimos / 100);
  const resto = centesimos % 100;
  const milhar = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (resto === 0) return milhar;
  return `${milhar},${String(resto).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * Retrato do perfil que vai para o servidor: só ids, clube e data do clube.
 * Sem milheiro (o alerta é sobre pontos) e sem cotação (vale a do site).
 * null se o perfil não tiver nada marcado.
 */
export function retratoDoPerfil(bruto, dados) {
  const limpo = limparPerfil(bruto, dados);
  if (!limpo || (limpo.programas.length === 0 && limpo.cartoes.length === 0)) return null;
  if (limpo.programas.length > LIMITES.programasNoPerfil || limpo.cartoes.length > LIMITES.cartoesNoPerfil) return null;
  if (![...limpo.programas.map((p) => p.programa_id), ...limpo.cartoes].every(idValido)) return null;
  return {
    programas: limpo.programas.map((p) => (p.clube_ativo_desde
      ? { programa_id: p.programa_id, clube_ativo: p.clube_ativo, clube_ativo_desde: p.clube_ativo_desde }
      : { programa_id: p.programa_id, clube_ativo: p.clube_ativo })),
    cartoes: limpo.cartoes,
  };
}

export const MENSAGENS_DE_CAMPO = Object.freeze({
  email: 'Escreva um e-mail válido, como nome@exemplo.com.br.',
  loja_id: 'Escolha uma loja da lista.',
  programa_id: 'Escolha um programa da lista, ou deixe "qualquer programa".',
  pontos_por_real: `Escreva um número de ${formatarMinimo(LIMITES.minimoCentesimos)} a ${formatarMinimo(LIMITES.maximoCentesimos)}, com até 2 casas depois da vírgula.`,
  perfil: 'Marque pelo menos um programa ou cartão em "Meu perfil" antes de criar o alerta.',
  consentimento: 'Para receber o alerta, marque que concorda em receber e-mails do site.',
});

/**
 * Confere o pedido de inscrição contra os dados publicados.
 * Entrada: { email, loja_id, programa_id?, pontos_por_real, perfil, consentimento }
 * @returns {{ok: true, pedido: object} | {ok: false, erros: Record<string, string>}}
 */
export function validarInscricao(entrada, dados) {
  const erros = {};
  const email = normalizarEmail(entrada.email);
  if (!email) erros.email = MENSAGENS_DE_CAMPO.email;
  const loja = idValido(entrada.loja_id) ? dados.lojas.find((l) => l.id === entrada.loja_id) : null;
  if (!loja) erros.loja_id = MENSAGENS_DE_CAMPO.loja_id;
  let programaId = null;
  if (entrada.programa_id !== undefined && entrada.programa_id !== null && entrada.programa_id !== '') {
    const programa = idValido(entrada.programa_id) ? dados.programas.find((p) => p.id === entrada.programa_id) : null;
    if (programa) programaId = programa.id;
    else erros.programa_id = MENSAGENS_DE_CAMPO.programa_id;
  }
  const minimo = lerMinimo(entrada.pontos_por_real);
  if (minimo === null) erros.pontos_por_real = MENSAGENS_DE_CAMPO.pontos_por_real;
  const perfil = retratoDoPerfil(entrada.perfil, dados);
  if (!perfil) erros.perfil = MENSAGENS_DE_CAMPO.perfil;
  if (entrada.consentimento !== true) erros.consentimento = MENSAGENS_DE_CAMPO.consentimento;
  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    pedido: { email, loja_id: loja.id, programa_id: programaId, minimo_centesimos: minimo, perfil },
  };
}

/** Data AAAA-MM-DD e hora HH:MM em São Paulo (a mesma regra da calculadora). */
export function dataHoraEmSaoPaulo(agora) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}
