// "Agora" no horário de São Paulo, no formato que o motor recebe
// ("AAAA-MM-DDTHH:MM"). As datas das ofertas são de Brasília, então o dia
// vira à meia-noite de São Paulo, em qualquer fuso do computador.
//
// Recebe o instante: quem chama decide qual é o "agora" (o motor nunca lê o
// relógio). Quando o PR do ciclo de vida das ofertas entrar na main, o motor
// passa a exportar dataHoraEmSaoPaulo, que faz o mesmo; aí este arquivo pode
// sair e o service worker importa de lá.

const RELOGIO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** @param {Date|number} instante */
export function agoraEmSaoPaulo(instante) {
  const p = {};
  for (const { type, value } of RELOGIO.formatToParts(instante)) p[type] = value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
