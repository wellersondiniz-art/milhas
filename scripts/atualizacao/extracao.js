// Etapa 2 do fluxo semanal: o modelo só COPIA texto da página para campos.
// Todo número, data e sim/não que entra numa oferta é lido e conferido aqui,
// por código determinístico: o trecho citado precisa existir na página e o
// valor precisa estar dentro do trecho. O que não passa vira "A_CONFIRMAR".
// O modelo nunca calcula pontos nem decide valores.

import { readFileSync } from 'node:fs';
import { contemTrecho, lerData, lerNumero, normalizar, numerosNoTexto } from './texto.js';

export const A_CONFIRMAR = 'A_CONFIRMAR';

// Modelo mais barato que dá conta de copiar texto para campos (Claude Haiku 5.5:
// US$ 0,10 por milhão de tokens de entrada e US$ 0,50 de saída). Troque com MODELO_EXTRACAO.
export const MODELO_PADRAO = 'claude-haiku-5-5';
export const ENDERECO_API = 'https://api.anthropic.com/v1/messages';
export const LIMITE_CARACTERES = 300_000;

export const PROMPT = readFileSync(new URL('./prompt-extracao.md', import.meta.url), 'utf8').trim();

const CAMPO = {
  type: 'object',
  additionalProperties: false,
  required: ['valor', 'trecho'],
  properties: { valor: { type: 'string' }, trecho: { type: 'string' } },
};

const CAMPOS_DA_OFERTA = [
  'escopo', 'categorias_incluidas', 'pontos_fora_do_escopo_por_real', 'acumula_com_cartao',
  'clube_ativo_ha_horas', 'exige_cupom', 'cupom', 'inicio', 'fim', 'credito_prazo_dias', 'link_oferta',
];

/** JSON Schema da resposta (structured outputs): só textos, nada de número. */
export const ESQUEMA_RESPOSTA = {
  type: 'object',
  additionalProperties: false,
  required: ['ofertas'],
  properties: {
    ofertas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['regras', ...CAMPOS_DA_OFERTA],
        properties: {
          regras: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['pontos_por_real', 'exige_clube', 'cartao'],
              properties: { pontos_por_real: CAMPO, exige_clube: CAMPO, cartao: CAMPO },
            },
          },
          ...Object.fromEntries(CAMPOS_DA_OFERTA.map((c) => [c, CAMPO])),
        },
      },
    },
  },
};

/** Corpo do pedido à API de mensagens. */
export function montarPedido({ texto, fonte, modelo = MODELO_PADRAO }) {
  return {
    model: modelo,
    max_tokens: 16000,
    system: PROMPT,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_RESPOSTA } },
    messages: [{
      role: 'user',
      content: `Programa: ${fonte.programa_id}. Loja: ${fonte.loja_id}. Endereço: ${fonte.url}\n<pagina>\n${texto}\n</pagina>`,
    }],
  };
}

/**
 * Chama o modelo e devolve { resposta, bruta }. A chave vem de ANTHROPIC_API_KEY
 * (nunca do repositório). `buscar` pode ser trocado nos testes.
 */
export async function chamarModelo({ texto, fonte, chave, modelo, buscar = fetch }) {
  if (!chave) throw new Error('falta a variável de ambiente ANTHROPIC_API_KEY');
  if (texto.length > LIMITE_CARACTERES) {
    throw new Error(`página com ${texto.length} caracteres, acima do limite de ${LIMITE_CARACTERES}; não cortamos texto, revise a fonte`);
  }
  const r = await buscar(ENDERECO_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(montarPedido({ texto, fonte, modelo })),
    signal: AbortSignal.timeout(120_000),
  });
  const bruta = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`a API respondeu ${r.status}: ${bruta?.error?.message ?? 'sem detalhe'}`);
  return { resposta: lerResposta(bruta), bruta };
}

/** Tira o JSON de dentro da resposta da API e confere o formato básico. */
export function lerResposta(bruta) {
  if (bruta?.stop_reason === 'refusal') throw new Error('o modelo recusou o pedido');
  if (bruta?.stop_reason === 'max_tokens') throw new Error('a resposta foi cortada (max_tokens)');
  const bloco = (bruta?.content ?? []).find((b) => b.type === 'text');
  if (!bloco) throw new Error('resposta sem texto');
  let json;
  try {
    json = JSON.parse(bloco.text);
  } catch {
    throw new Error('o modelo não devolveu JSON válido');
  }
  if (!json || !Array.isArray(json.ofertas)) throw new Error('JSON sem a lista "ofertas"');
  return json;
}

// ---------------------------------------------------------------------------
// Conversão determinística: texto copiado → registro de ofertas.json

function preenchido(c) {
  return c && typeof c.valor === 'string' && c.valor.trim() !== '' && typeof c.trecho === 'string'
    && c.trecho.trim() !== '' && c.trecho.trim() !== A_CONFIRMAR;
}

/**
 * Converte a resposta do modelo em ofertas no formato de ofertas.json.
 * Devolve { ofertas, problemas, evidencias }. `problemas` lista cada campo recusado e o
 * motivo; `evidencias[id]` lista, para cada valor aceito, o trecho da página que o mostra.
 */
export function converterExtracao({ resposta, fonte, texto, cartoes, data }) {
  const problemas = [];
  const ofertas = [];
  const evidencias = {};
  const ids = new Set();

  (resposta.ofertas ?? []).forEach((bruta, n) => {
    const onde = `${fonte.id}, oferta ${n + 1}`;
    const recusar = (campo, valor, motivo) => problemas.push({ fonte: fonte.id, onde, campo, valor, motivo });
    const provas = [];
    const aceitar = (campo, c, valor) => { provas.push({ campo, valor, trecho: c.trecho.trim() }); return valor; };

    /** Confere trecho na página. Devolve o campo ou null (vazio ou recusado). */
    const conferido = (nome, c) => {
      if (!preenchido(c)) return null;
      if (!contemTrecho(texto, c.trecho)) {
        recusar(nome, c.valor, 'o trecho citado não está na página');
        return null;
      }
      return c;
    };
    const numero = (nome, c, { inteiro = false } = {}) => {
      const ok = conferido(nome, c);
      if (!ok) return A_CONFIRMAR;
      const v = lerNumero(ok.valor);
      if (v === null) { recusar(nome, ok.valor, 'não é um número'); return A_CONFIRMAR; }
      if (inteiro && !Number.isInteger(v)) { recusar(nome, ok.valor, 'deveria ser número inteiro'); return A_CONFIRMAR; }
      if (!numerosNoTexto(ok.trecho).includes(v)) { recusar(nome, ok.valor, 'o número não aparece no trecho citado'); return A_CONFIRMAR; }
      return aceitar(nome, ok, v);
    };
    const simNao = (nome, c) => {
      const ok = conferido(nome, c);
      if (!ok) return A_CONFIRMAR;
      const v = normalizar(ok.valor);
      if (v === 'sim') return aceitar(nome, ok, true);
      if (v === 'nao') return aceitar(nome, ok, false);
      recusar(nome, ok.valor, 'deveria ser "sim" ou "nao"');
      return A_CONFIRMAR;
    };
    const dataLida = (nome, c) => {
      const ok = conferido(nome, c);
      if (!ok) return A_CONFIRMAR;
      const d = lerData(ok.valor);
      if (!d) { recusar(nome, ok.valor, 'data sem dia, mês e ano escritos'); return A_CONFIRMAR; }
      if (!contemTrecho(ok.trecho, ok.valor)) { recusar(nome, ok.valor, 'a data não aparece no trecho citado'); return A_CONFIRMAR; }
      return aceitar(nome, ok, d);
    };

    // Regras (faixas de pontos)
    const regras = [];
    for (const r of bruta.regras ?? []) {
      const pontos = numero('pontos_por_real', r.pontos_por_real);
      if (pontos === A_CONFIRMAR) continue;
      const condicao = {};
      const clube = conferido('exige_clube', r.exige_clube);
      if (clube && normalizar(clube.valor) === 'sim') condicao.clube_ativo = aceitar('exige_clube', clube, true);
      if (preenchido(r.cartao)) {
        const c = conferido('cartao', r.cartao);
        if (!c) continue;
        const cartao = cartoes.find((k) => normalizar(k.nome) === normalizar(c.valor))
          ?? cartoes.find((k) => normalizar(c.valor).includes(normalizar(k.nome)));
        if (!cartao) { recusar('cartao', c.valor, 'cartão não cadastrado em cartoes.json; faixa ignorada'); continue; }
        condicao.cartao_id = aceitar('cartao', c, cartao.id);
      }
      const regra = { condicao, pontos_por_real: pontos };
      if (!regras.some((x) => JSON.stringify(x) === JSON.stringify(regra))) regras.push(regra);
    }
    if (regras.length === 0) {
      recusar('regras', '', 'nenhuma faixa de pontos por real confirmada na página; oferta não proposta');
      return;
    }

    let status;
    const marcarAConfirmar = (campo, motivo) => { status = A_CONFIRMAR; recusar(campo, '', motivo); };

    // Escopo e categorias
    const escopoOk = conferido('escopo', bruta.escopo);
    let escopo = escopoOk?.valor.trim();
    const categorias = (conferido('categorias_incluidas', bruta.categorias_incluidas)?.valor ?? '')
      .split(';').map((s) => s.trim()).filter((s) => s && contemTrecho(texto, s));
    if (!['vendido_e_entregue_pela_loja', 'todos_os_produtos', 'categorias_selecionadas'].includes(escopo)) {
      escopo = 'vendido_e_entregue_pela_loja';
      marcarAConfirmar('escopo', 'escopo não escrito na página; usei o mais restrito e a oferta fica A_CONFIRMAR (fora do ranking)');
    } else if (escopo === 'categorias_selecionadas' && categorias.length === 0) {
      escopo = 'vendido_e_entregue_pela_loja';
      marcarAConfirmar('categorias_incluidas', 'categorias não escritas na página; oferta fica A_CONFIRMAR');
    } else {
      aceitar('escopo', escopoOk, escopo);
    }

    const inicio = dataLida('inicio', bruta.inicio);
    let fim = dataLida('fim', bruta.fim);
    if (inicio !== A_CONFIRMAR && fim !== A_CONFIRMAR && fim < inicio) {
      recusar('fim', fim, `fim antes do início (${inicio}); fim fica A_CONFIRMAR`);
      fim = A_CONFIRMAR;
    }

    let exigeCupom = simNao('exige_cupom', bruta.exige_cupom);
    const cupomOk = conferido('cupom', bruta.cupom);
    let cupom;
    if (cupomOk) {
      if (contemTrecho(cupomOk.trecho, cupomOk.valor)) cupom = aceitar('cupom', cupomOk, cupomOk.valor.trim());
      else recusar('cupom', cupomOk.valor, 'o cupom não aparece no trecho citado');
    }
    if (exigeCupom === true && !cupom) {
      exigeCupom = A_CONFIRMAR;
      marcarAConfirmar('cupom', 'a página exige cupom mas o código não foi confirmado; oferta fica A_CONFIRMAR');
    }

    let link = A_CONFIRMAR;
    const linkOk = conferido('link_oferta', bruta.link_oferta);
    if (linkOk) {
      const v = linkOk.valor.trim();
      if (/^https:\/\/\S+$/.test(v) && contemTrecho(texto, v)) link = aceitar('link_oferta', linkOk, v);
      else recusar('link_oferta', v, 'link não começa com https:// ou não está na página');
    }

    const mes = (inicio !== A_CONFIRMAR ? inicio : data).slice(0, 7);
    let id = `${fonte.programa_id}-${fonte.loja_id}-${mes}`;
    for (let k = 2; ids.has(id); k++) id = `${fonte.programa_id}-${fonte.loja_id}-${mes}-${k}`;
    ids.add(id);

    const oferta = {
      id,
      loja_id: fonte.loja_id,
      programa_id: fonte.programa_id,
      regras,
      escopo,
    };
    if (escopo === 'categorias_selecionadas') oferta.categorias_incluidas = categorias;
    oferta.pontos_fora_do_escopo_por_real = numero('pontos_fora_do_escopo_por_real', bruta.pontos_fora_do_escopo_por_real);
    oferta.acumula_com_cartao = simNao('acumula_com_cartao', bruta.acumula_com_cartao);
    if (regras.some((r) => r.condicao.clube_ativo)) {
      oferta.clube_ativo_ha_horas = numero('clube_ativo_ha_horas', bruta.clube_ativo_ha_horas, { inteiro: true });
    }
    oferta.exige_cupom = exigeCupom;
    if (cupom) oferta.cupom = cupom;
    oferta.inicio = inicio;
    oferta.fim = fim;
    oferta.credito_prazo_dias = numero('credito_prazo_dias', bruta.credito_prazo_dias, { inteiro: true });
    oferta.link_oferta = link;
    oferta.fonte_url = fonte.url;
    oferta.verificado_em = data;
    oferta.observacoes = `Proposta pelo fluxo semanal em ${data} (fonte "${fonte.id}").`;
    if (status) oferta.status = status;
    ofertas.push(oferta);
    evidencias[id] = provas;
  });

  return { ofertas, problemas, evidencias };
}
