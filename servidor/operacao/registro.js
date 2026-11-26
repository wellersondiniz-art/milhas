// Registro de erros SEM dado pessoal.
//
// Todo erro das funções do servidor (functions/api/*) passa por aqui antes de
// ir para o log da Cloudflare e, se configurado, para a tabela
// public.operacao_erros do Supabase (supabase/migrations/). A regra é:
//
//   - só campos de uma lista fixa (quando, origem, rota, status, tipo,
//     mensagem, local): nunca o corpo do pedido, cabeçalhos, cookies, IP,
//     navegador ou a resposta de um serviço de fora;
//   - a rota vai sem "?..." e sem "#...", e pedaços que parecem código,
//     token ou número viram [id];
//   - a mensagem passa por limparTexto(), que troca e-mail, CPF, número de
//     cartão, telefone, IP, chaves e tokens por marcadores;
//   - tudo tem tamanho máximo.
//
// Mesmo assim, quem escreve código novo não deve pôr dado pessoal em mensagem
// de erro: esta limpeza é a segunda trava, não a primeira.

const MAX_MENSAGEM = 300;
const MAX_LOCAL = 120;
const MAX_ROTA = 120;

// Ordem importa: segredos e e-mails antes dos números soltos.
const TROCAS = [
  // Chaves e tokens conhecidos (Anthropic, Supabase, Stripe, Resend, GitHub, JWT, Bearer).
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [segredo]'],
  [/\b(sk|rk|pk)[-_](ant[-_])?(live|test|admin|api\d*)?[-_]?[A-Za-z0-9_-]{8,}/g, '[segredo]'],
  [/\b(sb_secret|sb_publishable|whsec|re|gh[pousr]|github_pat)_[A-Za-z0-9_]{8,}/g, '[segredo]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(\.[A-Za-z0-9_-]+)?/g, '[segredo]'],
  // Parâmetros de URL com valor (podem levar token, e-mail ou id de inscrição).
  [/([?&][A-Za-z0-9_.-]{1,40}=)[^&\s#"']*/g, '$1[valor]'],
  // E-mail.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // CPF formatado (o sem pontos cai na regra de números longos).
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[cpf]'],
  // IPv4 e IPv6.
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, '[ip]'],
  // Telefone brasileiro: (21) 99999-9999, +55 21 999999999...
  [/(\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]\d{4}\b/g, '[telefone]'],
  // Número de cartão com espaços ou traços (13 a 19 dígitos).
  [/\b\d(?:[ -]?\d){12,18}\b/g, '[numero]'],
  // Qualquer sequência de 6 ou mais dígitos (cartão, CPF sem pontos, celular...).
  [/\d{6,}/g, '[numero]'],
  // Códigos longos (ids, tokens sem prefixo conhecido): 24+ letras/números juntos.
  [/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}\b/g, '[id]'],
];

/** Tira dado pessoal e segredo de um texto livre. Sempre devolve texto curto. */
export function limparTexto(texto, maximo = MAX_MENSAGEM) {
  let t = String(texto ?? '')
    // Quebras de linha e caracteres de controle viram espaço (log de uma linha só).
    .replace(/[\u0000-\u001f\u007f]+/g, ' ');
  for (const [padrao, troca] of TROCAS) t = t.replace(padrao, troca);
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t.length > maximo ? `${t.slice(0, maximo - 1)}…` : t;
}

/** Caminho da URL, sem domínio, "?..." e "#...", com pedaços variáveis trocados por [id]. */
export function limparRota(url) {
  let caminho;
  try {
    caminho = new URL(String(url), 'https://x.invalid').pathname;
  } catch {
    return '[rota inválida]';
  }
  const partes = caminho.split('/').map((p) => {
    if (p === '') return p;
    let pedaco;
    try {
      pedaco = decodeURIComponent(p);
    } catch {
      return '[id]';
    }
    // Só nomes curtos e "de rota" passam; o resto (ids, tokens, e-mails) vira [id].
    return /^[a-z][a-z0-9-]{0,30}$/.test(pedaco) ? pedaco : '[id]';
  });
  const rota = partes.join('/') || '/';
  return rota.length > MAX_ROTA ? rota.slice(0, MAX_ROTA) : rota;
}

/** "origem" é um nome de módulo escrito no código: só letras, números, ponto e traço. */
function nomeCurto(valor, padrao) {
  const t = String(valor ?? '').toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,39}$/.test(t) ? t : padrao;
}

/** Primeira linha "arquivo:linha" da pilha, sem caminho da máquina. */
export function localDoErro(erro) {
  const pilha = typeof erro?.stack === 'string' ? erro.stack.split('\n').slice(1) : [];
  for (const linha of pilha) {
    const achado = linha.match(/([A-Za-z0-9_.-]+\.m?js):(\d+)(?::\d+)?\)?\s*$/);
    if (achado) return limparTexto(`${achado[1]}:${achado[2]}`, MAX_LOCAL);
  }
  return null;
}

/**
 * Monta o registro de um erro. Só estes campos saem daqui.
 * @param {object} o
 * @param {string} o.origem   módulo que falhou, ex.: "alertas", "explicar", "middleware"
 * @param {string} [o.url]    URL do pedido (só o caminho é guardado)
 * @param {number} [o.status] status HTTP devolvido
 * @param {unknown} [o.erro]  o erro capturado (Error ou outra coisa)
 * @param {Date} [o.agora]
 */
export function registroDeErro({ origem, url, status, erro, agora = new Date() }) {
  const ehErro = erro instanceof Error;
  const tipo = ehErro ? nomeCurto(erro.name, 'error') : erro === undefined ? 'resposta' : 'valor';
  const mensagem = ehErro ? limparTexto(erro.message) : erro === undefined ? '' : limparTexto(typeof erro === 'string' ? erro : 'valor não-Error lançado');
  const st = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  return {
    quando: agora.toISOString(),
    origem: nomeCurto(origem, 'desconhecida'),
    rota: url === undefined ? null : limparRota(url),
    status: st,
    tipo,
    mensagem,
    local: ehErro ? localDoErro(erro) : null,
  };
}

/** Uma linha de JSON para o log da Cloudflare (Functions → Real-time logs). */
export function linhaDeLog(registro) {
  return JSON.stringify({ erro_operacao: registro });
}

/**
 * Grava o registro na tabela public.operacao_erros pelo PostgREST do Supabase.
 * Devolve null (desligado) se faltar URL ou chave. Nunca lança: se o banco
 * falhar, o erro original continua no log da Cloudflare.
 * @param {{ url?: string, chave?: string, fetch?: typeof fetch }} o
 */
export function gravadorSupabase({ url, chave, fetch: buscar = globalThis.fetch }) {
  const base = String(url ?? '').replace(/\/$/, '');
  if (!chave || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(base)) return null;
  return async (registro) => {
    try {
      const resposta = await buscar(`${base}/rest/v1/operacao_erros`, {
        method: 'POST',
        headers: { apikey: chave, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          origem: registro.origem,
          rota: registro.rota,
          status: registro.status,
          tipo: registro.tipo,
          mensagem: registro.mensagem,
          local: registro.local,
        }),
      });
      return resposta.ok;
    } catch {
      return false;
    }
  };
}

/**
 * Registra um erro: limpa, escreve no log e (se houver gravador) guarda no banco.
 * Devolve a promessa da gravação, para usar em context.waitUntil().
 */
export function registrarErro(dados, { log = console.error, gravar = null } = {}) {
  const registro = registroDeErro(dados);
  log(linhaDeLog(registro));
  return gravar ? gravar(registro) : Promise.resolve(false);
}
