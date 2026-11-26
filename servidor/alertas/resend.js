// Envio pelo Resend (https://resend.com/docs/api-reference/emails/send-email).
// A chave vem do ambiente do servidor (RESEND_API_KEY); nunca do código.
// Um e-mail por chamada e UM destinatário por e-mail: o campo "to" nunca tem
// mais de um endereço, e não usamos cc nem bcc.

export class ErroDeEnvio extends Error {
  constructor(status) {
    super(`Resend recusou o envio (status ${status})`);
    this.status = status;
  }
}

/**
 * @param {object} o
 * @param {string} o.chave       RESEND_API_KEY
 * @param {string} o.remetente   ex.: "Milhas da Vez <alertas@milhasdavez.com.br>"
 * @param {typeof fetch} [o.fetch]
 */
export function clienteResend({ chave, remetente, fetch: buscar = globalThis.fetch }) {
  if (!chave || !remetente) return null;
  return {
    async enviar({ para, assunto, texto, html, cabecalhos, idempotencia }) {
      if (typeof para !== 'string' || para.includes(',')) throw new Error('um destinatário por e-mail');
      const resposta = await buscar('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${chave}`,
          'Content-Type': 'application/json',
          ...(idempotencia ? { 'Idempotency-Key': idempotencia } : {}),
        },
        body: JSON.stringify({ from: remetente, to: [para], subject: assunto, text: texto, html, headers: cabecalhos }),
      });
      // O corpo da resposta não vai para o log: pode repetir o endereço.
      if (!resposta.ok) throw new ErroDeEnvio(resposta.status);
      return true;
    },
  };
}
