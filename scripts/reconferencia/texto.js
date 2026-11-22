// Texto em português da lista de reconferência (scripts/reconferir.js).
import { formatarData } from '../../site/js/motor/formatar.js';
import { URGENCIAS } from './lista.js';

function situacao(i) {
  const quando = `conferido em ${formatarData(i.verificado_em)}, há ${i.dias} ${i.dias === 1 ? 'dia' : 'dias'}`;
  switch (i.urgencia) {
    case URGENCIAS.FORA_DO_RANKING: return `${quando}. JÁ SAIU DO RANKING: só volta depois de conferida.`;
    case URGENCIAS.SAI_DO_RANKING: return `${quando}. Sai do ranking se não for conferida até ${formatarData(i.conferir_ate)}.`;
    case URGENCIAS.ANTIGO: return `${quando}. Já aparece com aviso de dado antigo.`;
    default: return `${quando}. Ganha aviso de dado antigo se não for conferido até ${formatarData(i.conferir_ate)}.`;
  }
}

function linhas(itens) {
  return itens.flatMap((i) => [`   - ${i.nome}: ${situacao(i)}`, `     Fonte: ${i.fonte_url}`]);
}

export function textoDaReconferencia(lista) {
  const saida = [
    `O que reconferir na semana de ${formatarData(lista.semana.de)} a ${formatarData(lista.semana.ate)}`,
    'Ordem das lojas: campo "prioridade" de dados/lojas.json (1 = a mais buscada). É provisório e escolhido à mão,',
    'porque o site não mede buscas. Para reconferir: abra a fonte, confira os números e atualize "verificado_em".',
    '',
  ];
  if (!lista.total) {
    saida.push('Nada para reconferir esta semana.');
    return `${saida.join('\n')}\n`;
  }
  lista.lojas.forEach(({ loja, itens }, n) => {
    const prioridade = Number.isInteger(loja.prioridade) ? `prioridade ${loja.prioridade}` : 'sem prioridade';
    saida.push(`${n + 1}. ${loja.nome} (${prioridade})`, ...linhas(itens), '');
  });
  if (lista.geral.length) saida.push('Vale para todas as lojas', ...linhas(lista.geral), '');
  saida.push(`Total: ${lista.total} ${lista.total === 1 ? 'item' : 'itens'}.`);
  return `${saida.join('\n')}\n`;
}
