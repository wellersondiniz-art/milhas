// Monta o relatório em português (Markdown) da proposta semanal. Função pura.
// comTrechos = true inclui os trechos da página que provam cada valor (versão
// local, para revisão). O texto do pull request vai sem trechos, para não
// copiar texto de sites para o GitHub.

const A_CONFIRMAR = 'A_CONFIRMAR';

export function dataBr(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return String(iso);
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

const numeroBr = (n) => String(n).replace('.', ',');

const ESCOPOS = {
  vendido_e_entregue_pela_loja: 'só produtos vendidos e entregues pela loja',
  todos_os_produtos: 'todos os produtos',
  categorias_selecionadas: 'só categorias selecionadas',
};

function valorBr(v) {
  if (v === undefined) return '(sem o campo)';
  if (v === A_CONFIRMAR) return 'A_CONFIRMAR';
  if (v === true) return 'sim';
  if (v === false) return 'não';
  if (typeof v === 'number') return numeroBr(v);
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? dataBr(v) : v;
  return JSON.stringify(v);
}

/** Nome legível de programa, loja e cartão a partir do cadastro. */
function nomes(dados) {
  const de = (lista, id) => lista.find((x) => x.id === id)?.nome ?? id;
  return {
    programa: (id) => de(dados.programas, id),
    loja: (id) => de(dados.lojas, id),
    cartao: (id) => de(dados.cartoes, id),
  };
}

function faixa(regra, n) {
  const partes = [];
  if (regra.condicao.clube_ativo) partes.push('com clube');
  if (regra.condicao.cartao_id) partes.push(`com ${n.cartao(regra.condicao.cartao_id)}`);
  const quem = partes.length ? partes.join(' e ') : 'sem exigência';
  return `${quem}: ${numeroBr(regra.pontos_por_real)} ponto(s) por real`;
}

function resumoOferta(o, n) {
  const linhas = [
    `- Faixas: ${o.regras.map((r) => faixa(r, n)).join('; ')}`,
    `- Período: ${valorBr(o.inicio)} a ${valorBr(o.fim)}`,
    `- Escopo: ${ESCOPOS[o.escopo] ?? valorBr(o.escopo)}${o.categorias_incluidas ? ` (${o.categorias_incluidas.join(', ')})` : ''}`,
    `- Soma com o ponto do cartão: ${valorBr(o.acumula_com_cartao)} · Cupom: ${valorBr(o.exige_cupom)}${o.cupom ? ` (${o.cupom})` : ''} · Crédito em: ${o.credito_prazo_dias === A_CONFIRMAR ? 'A_CONFIRMAR' : `${o.credito_prazo_dias} dias`}`,
    `- Link: ${valorBr(o.link_oferta)}`,
    `- Fonte: ${o.fonte_url}`,
  ];
  if (o.status === A_CONFIRMAR) linhas.push('- Status: A_CONFIRMAR (fica fora do ranking até alguém confirmar)');
  return linhas;
}

function trechos(id, evidencias) {
  const provas = evidencias[id] ?? [];
  if (provas.length === 0) return [];
  return ['- Trechos da página que mostram cada valor:', ...provas.map((p) => `  - ${p.campo} = ${valorBr(p.valor)}: "${p.trecho}"`)];
}

/**
 * @param {object} p
 * @param {string} p.data          data da coleta (AAAA-MM-DD)
 * @param {object} p.comparacao    resultado de compararOfertas
 * @param {object} p.dados         { programas, lojas, cartoes }
 * @param {object} p.evidencias    id → [{ campo, valor, trecho }]
 * @param {Array}  p.problemas     campos recusados na extração
 * @param {Array}  p.fontes        resumo da coleta/extração: [{ id, url, erro? }]
 * @param {string} p.codigo        código de aprovação
 * @param {boolean} [p.comTrechos]
 * @param {string} [p.aviso]       linha extra no topo (ex.: "demonstração")
 */
export function montarRelatorio({ data, comparacao: c, dados, evidencias, problemas, fontes, codigo, comTrechos = true, aviso }) {
  const n = nomes(dados);
  const titulo = (o) => `${n.programa(o.programa_id)} × ${n.loja(o.loja_id)} (\`${o.id}\`)`;
  const L = [];
  L.push(`# Proposta de atualização de ofertas: ${dataBr(data)}`, '');
  if (aviso) L.push(`> ${aviso}`, '');
  const falhas = fontes.filter((f) => f.erro);
  L.push(
    'Nada foi gravado em `dados/` nem enviado ao GitHub. Revise e, se estiver tudo certo, aprove com o comando no fim.',
    '',
    '## Resumo',
    '',
    `- Páginas lidas: ${fontes.length - falhas.length} de ${fontes.length}`,
    `- Ofertas novas: ${c.novas.length}`,
    `- Ofertas alteradas: ${c.alteradas.length}`,
    `- Ofertas encerradas: ${c.encerradas.length}`,
    `- Suspeitas (revise primeiro): ${c.suspeitas.length}`,
    `- Campos recusados (o modelo preencheu, a página não confirma): ${problemas.length}`,
    `- Sem mudança: ${c.iguais.length} · Não verificadas nesta semana (ficam como estão): ${c.naoVerificadas.length}`,
    '',
  );

  if (c.suspeitas.length) {
    L.push('## Suspeitas', '');
    for (const s of c.suspeitas) L.push(`- \`${s.id}\`: ${s.motivo}`);
    L.push('');
  }

  if (c.novas.length) {
    L.push('## Ofertas novas', '');
    for (const o of c.novas) {
      L.push(`### ${titulo(o)}`, '', ...resumoOferta(o, n));
      if (comTrechos) L.push(...trechos(o.id, evidencias));
      L.push('');
    }
  }

  if (c.alteradas.length) {
    L.push('## Ofertas alteradas', '');
    for (const { antes, mudancas, idProposta } of c.alteradas) {
      L.push(`### ${titulo(antes)}`, '', '| Campo | Antes | Depois |', '| --- | --- | --- |');
      for (const m of mudancas) {
        const fmt = (v) => (m.campo === 'regras' && Array.isArray(v) ? v.map((r) => faixa(r, n)).join('; ') : valorBr(v));
        L.push(`| ${m.campo} | ${fmt(m.antes)} | ${fmt(m.depois)} |`);
      }
      L.push('');
      if (comTrechos) L.push(...trechos(idProposta, evidencias), '');
    }
  }

  if (c.encerradas.length) {
    L.push('## Ofertas encerradas (saem do ofertas.json)', '');
    for (const { oferta, motivo } of c.encerradas) L.push(`- ${titulo(oferta)}: ${motivo}`);
    L.push('');
  }

  if (c.ignoradas.length) {
    L.push('## Encontradas na página, mas não propostas', '');
    for (const { oferta, motivo } of c.ignoradas) L.push(`- ${titulo(oferta)}: ${motivo}`);
    L.push('');
  }

  if (problemas.length) {
    L.push('## Campos recusados', '', 'O modelo preencheu estes campos, mas a conferência automática não achou a prova na página. Eles ficaram A_CONFIRMAR (ou fora da oferta).', '');
    for (const p of problemas) L.push(`- ${p.onde} › ${p.campo}${p.valor !== '' && p.valor !== undefined ? ` = "${p.valor}"` : ''}: ${p.motivo}`);
    L.push('');
  }

  if (falhas.length) {
    L.push('## Páginas que não deu para ler', '');
    for (const f of falhas) L.push(`- ${f.id} (${f.url}): ${f.erro}`);
    L.push('');
  }

  if (c.iguais.length || c.naoVerificadas.length) {
    L.push('## Sem mudança', '');
    for (const { antes } of c.iguais) L.push(`- ${titulo(antes)}: confirmada de novo (só muda verificado_em)`);
    for (const o of c.naoVerificadas) L.push(`- ${titulo(o)}: nenhuma página desta oferta foi lida nesta semana`);
    L.push('');
  }

  L.push(
    '## Como aprovar',
    '',
    'Se revisou e está tudo certo, rode:',
    '',
    '```',
    `node scripts/aprovar-mudancas.js --data ${data} --codigo ${codigo}`,
    '```',
    '',
    'O código muda se a proposta ou o `dados/ofertas.json` mudarem, então ele só aprova exatamente o que está neste relatório. O comando grava `dados/ofertas.json`, valida os dados, cria uma branch, faz o commit e abre o pull request. O merge continua com você.',
    '',
  );
  return L.join('\n');
}
