// Salas VIP pelo cartão. Funções puras: recebem os dados (cartoes, salas-vip)
// e devolvem listas prontas para a tela. Nenhuma conta de dinheiro aqui.
//
// Ordem dos cartões: primeiro o que dá mais acesso grátis por ano
// (ilimitado > número maior > ilimitado só em caso restrito > sem número
// confirmado), depois o nome. "Ilimitado só em caso restrito" é o ilimitado
// com condição (só voando com a companhia, só num terminal, com gasto mínimo):
// vale menos que qualquer número de acessos que serve em qualquer viagem.

export const A_CONFIRMAR = 'A_CONFIRMAR';
export const ILIMITADO = 'ilimitado';

/** Peso de um registro para ordenar: ilimitado vale mais que qualquer número, se não tiver condição. */
export const PESO_ILIMITADO_COM_CONDICAO = 0.5;

export function pesoDosAcessos(sala) {
  if (sala.status === A_CONFIRMAR) return -1;
  if (sala.acessos_por_ano === ILIMITADO) return sala.condicoes ? PESO_ILIMITADO_COM_CONDICAO : Number.MAX_SAFE_INTEGER;
  return Number.isSafeInteger(sala.acessos_por_ano) ? sala.acessos_por_ano : -1;
}

/** "2 acessos grátis por ano", "Acesso ilimitado", "Número de acessos a confirmar". */
export function textoDosAcessos(sala) {
  if (sala.status === A_CONFIRMAR || sala.acessos_por_ano === A_CONFIRMAR) return 'Número de acessos a confirmar';
  if (sala.acessos_por_ano === ILIMITADO) return sala.condicoes ? 'Acesso ilimitado, com condições' : 'Acesso ilimitado';
  const n = sala.acessos_por_ano;
  return `${n} ${n === 1 ? 'acesso grátis' : 'acessos grátis'} por ano`;
}

/** Texto curto para o campo que pode estar A_CONFIRMAR. */
export function ouAConfirmar(valor, texto = 'A confirmar') {
  return valor === A_CONFIRMAR || valor === undefined || valor === null ? texto : valor;
}

function lista(dados, nome) {
  const v = dados?.[nome];
  return Array.isArray(v) ? v : [];
}

/**
 * Cartões do cadastro com as salas de cada um, do que dá mais acesso ao que dá menos.
 *
 * @param {object} dados   { cartoes, 'salas-vip' }
 * @param {object} [filtro]
 * @param {string[]} [filtro.cartoes]  só estes cartões (ex.: os do perfil)
 * @returns {{ comSala: Array<{ cartao, salas, peso }>, semInformacao: object[] }}
 *   semInformacao: cartões do cadastro (dentro do filtro) sem nenhum registro de sala.
 */
export function cartoesComSalaVip(dados, filtro = {}) {
  const salas = lista(dados, 'salas-vip');
  const quais = Array.isArray(filtro.cartoes) ? new Set(filtro.cartoes) : null;
  const cartoes = lista(dados, 'cartoes').filter((c) => !quais || quais.has(c.id));
  const porCartao = new Map();
  for (const s of salas) {
    if (!porCartao.has(s.cartao_id)) porCartao.set(s.cartao_id, []);
    porCartao.get(s.cartao_id).push(s);
  }
  const comSala = [];
  const semInformacao = [];
  for (const cartao of cartoes) {
    const delas = porCartao.get(cartao.id);
    if (!delas) { semInformacao.push(cartao); continue; }
    const ordenadas = [...delas].sort((a, b) => pesoDosAcessos(b) - pesoDosAcessos(a) || a.id.localeCompare(b.id));
    const pesos = ordenadas.map(pesoDosAcessos);
    // Peso do cartão: a melhor sala, e a soma dos números para desempatar.
    const soma = pesos.filter((p) => p >= 1 && p < Number.MAX_SAFE_INTEGER).reduce((t, p) => t + p, 0);
    comSala.push({ cartao, salas: ordenadas, peso: Math.max(...pesos), soma });
  }
  comSala.sort((a, b) => b.peso - a.peso || b.soma - a.soma || a.cartao.nome.localeCompare(b.cartao.nome, 'pt-BR'));
  semInformacao.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { comSala: comSala.map(({ soma, ...resto }) => resto), semInformacao };
}

/** Data mais recente de conferência entre as salas (para "conferido em"). */
export function ultimaConferencia(dados) {
  const datas = lista(dados, 'salas-vip').map((s) => s.verificado_em).filter((d) => typeof d === 'string').sort();
  return datas.length ? datas[datas.length - 1] : null;
}
