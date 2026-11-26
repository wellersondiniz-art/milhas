// Datas do motor. Funções puras: nunca leem o relógio do sistema.
// Toda data entra como texto ISO: "AAAA-MM-DD" ou "AAAA-MM-DDTHH:MM[:SS]".
// As contas usam Date.UTC só como calendário (sem fuso), então o resultado
// é o mesmo no navegador e no Node, em qualquer fuso.

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const MS_POR_HORA = 3_600_000;
const MS_POR_DIA = 24 * MS_POR_HORA;

/** true se o texto traz hora ("AAAA-MM-DDTHH:MM"). */
export function temHora(texto) {
  return typeof texto === 'string' && texto.length > 10;
}

/** Converte "AAAA-MM-DD[THH:MM[:SS]]" em milissegundos de calendário. Lança erro se a data não existe. */
export function lerDataHora(texto) {
  const m = typeof texto === 'string' ? FORMATO.exec(texto) : null;
  if (!m) throw new Error(`data inválida: ${String(texto)} (use AAAA-MM-DD)`);
  const [ano, mes, dia, hora, minuto, segundo] = m.slice(1).map((x) => Number(x ?? 0));
  const ms = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo);
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia ||
    d.getUTCHours() !== hora || d.getUTCMinutes() !== minuto || d.getUTCSeconds() !== segundo
  ) {
    throw new Error(`data inválida: ${texto} (essa data não existe)`);
  }
  return ms;
}

/** Só a parte da data ("AAAA-MM-DD"). */
export function soData(texto) {
  return texto.slice(0, 10);
}

/** Dias de calendário de `de` até `ate` (pode ser negativo). Ignora as horas. */
export function diasEntre(de, ate) {
  return Math.round((lerDataHora(soData(ate)) - lerDataHora(soData(de))) / MS_POR_DIA);
}

/**
 * Horas que, com certeza, o clube já está ativo no momento `agora`.
 * Conservador: sem a hora da assinatura, contamos como se tivesse sido no fim
 * do dia; sem a hora da compra, como se fosse no começo do dia.
 */
export function horasGarantidasDesde(desde, agora) {
  const inicio = lerDataHora(desde) + (temHora(desde) ? 0 : MS_POR_DIA);
  return (lerDataHora(agora) - inicio) / MS_POR_HORA;
}

const RELOGIO_SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/**
 * Data e hora de um instante no horário de São Paulo: "AAAA-MM-DDTHH:MM".
 * As datas das ofertas são de Brasília; assim a virada do dia é a mesma para
 * todo mundo, em qualquer fuso do aparelho. Recebe o instante (Date ou
 * milissegundos): quem chama decide qual é o "agora".
 */
export function dataHoraEmSaoPaulo(instante) {
  const partes = {};
  for (const { type, value } of RELOGIO_SAO_PAULO.formatToParts(instante)) partes[type] = value;
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}

/** "AAAA-MM-DD" + n dias de calendário → "AAAA-MM-DD". */
export function somarDias(data, n) {
  return new Date(lerDataHora(soData(data)) + n * MS_POR_DIA).toISOString().slice(0, 10);
}
