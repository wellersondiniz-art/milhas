// Textos da tela "Milhas em viagens". Funções puras: recebem o que já saiu do
// motor das viagens e só escolhem as palavras. Nenhuma conta de pontos aqui.

import { ESCALA_PONTOS, formatarData, formatarPontos, formatarValor } from '../motor/formatar.js';

/** Até 9 dígitos: 999.999.999 pontos. */
export const MAX_DIGITOS_PONTOS = 9;

/** Termos explicados na primeira vez que aparecem (CLAUDE.md, seção 7). */
export const TERMOS_VIAGEM = {
  milheiro: ['O que é milheiro?', 'É quanto valem 1.000 pontos ou milhas. Se o milheiro sai por R$ 15,00 e vale R$ 20,00 em passagem, a transferência compensa.'],
  bonus: ['O que é bônus de transferência?', 'Quando você manda pontos do cartão (Livelo, Esfera e outros) para a companhia aérea, ela às vezes dá milhas a mais. Com 80% de bônus, 10.000 pontos viram 18.000 milhas.'],
  clube: ['O que é clube?', 'É uma assinatura mensal do programa de pontos. Quem assina costuma ganhar bônus maior nas transferências.'],
  categoria: ['O que é categoria?', 'É o nível que você tem no programa, pelo quanto voa ou gasta (por exemplo, Gold ou Diamante). Categoria mais alta ganha mais pontos por real.'],
};

/** Campo de pontos: só dígitos, com ponto de milhar. { pontos: number|null, texto } */
export function lerPontos(texto) {
  const digitos = String(texto ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITOS_PONTOS);
  if (!digitos) return { pontos: null, texto: '' };
  const pontos = Number(digitos);
  return { pontos, texto: formatarPontos(BigInt(pontos) * ESCALA_PONTOS) };
}

export function erroDosPontos(pontos) {
  if (pontos === null) return 'Digite quantos pontos você tem.';
  if (pontos === 0) return 'Os pontos precisam ser mais que zero.';
  return '';
}

/** Campo de bônus digitado (0 a 1000%). Vazio = usar a campanha cadastrada. */
export function lerBonus(texto) {
  const digitos = String(texto ?? '').replace(/\D/g, '').slice(0, 4);
  if (!digitos) return null;
  return Math.min(Number(digitos), 1000);
}

const pts = (esc) => formatarPontos(esc);

/** O número grande do card de transferência e a legenda. */
export function destaqueDaRota(opcao) {
  if (!opcao.calculavel) return { principal: 'A confirmar', legenda: opcao.motivo };
  const principal = `${pts(opcao.milhas_total)} pontos ${opcao.nome_destino}`;
  const partes = [];
  if (opcao.valor_destino !== null) partes.push(`Valem uns ${formatarValor(opcao.valor_destino)}.`);
  if (opcao.custo_milheiro_destino !== null) partes.push(`Cada 1.000 saem por ${formatarValor(opcao.custo_milheiro_destino)}.`);
  return { principal, legenda: partes.join(' ') };
}

/** Selos do card: posição, bônus e alertas curtos. */
export function selosDaRota(opcao, posicao) {
  const selos = [];
  if (!opcao.calculavel) {
    selos.push({ tipo: 'aviso', texto: 'Proporção a confirmar' });
    return selos;
  }
  if (posicao === 0 && !opcao.abaixo_do_minimo && !opcao.so_desconto) selos.push({ tipo: 'destaque', texto: 'Rende mais' });
  if (opcao.bonus_percentual > 0) {
    selos.push({ tipo: 'sucesso', texto: opcao.bonus_de === 'digitado' ? `Bônus de ${opcao.bonus_percentual}% (digitado)` : `Bônus de ${opcao.bonus_percentual}% hoje` });
  } else {
    selos.push({ tipo: 'info', texto: 'Sem bônus hoje' });
  }
  if (opcao.so_desconto) selos.push({ tipo: 'info', texto: 'Só vale como desconto em hotel' });
  if (opcao.abaixo_do_minimo) selos.push({ tipo: 'aviso', texto: 'Abaixo do mínimo' });
  return selos;
}

/**
 * Compensa? Compara o que os pontos de origem valem (ou custaram) com o que as
 * milhas valem. null quando falta um dos dois valores.
 */
export function vereditoDaRota(opcao) {
  if (!opcao.calculavel || opcao.ganho === null) return null;
  if (opcao.ganho > 0n) {
    return { tipo: 'sucesso', titulo: 'Compensa', texto: `As milhas valem ${formatarValor(opcao.ganho)} a mais do que os pontos ${opcao.nome_origem} que você manda.` };
  }
  if (opcao.ganho === 0n) {
    return { tipo: 'info', titulo: 'Empata', texto: 'As milhas valem o mesmo que os pontos que você manda. Só vale se você já tem um uso para elas.' };
  }
  return {
    tipo: 'aviso',
    titulo: 'Hoje não compensa',
    texto: `Os pontos ${opcao.nome_origem} valem ${formatarValor(-opcao.ganho)} a mais do que as milhas que chegam. Se puder, espere um bônus maior.`,
  };
}

/** Quando foi a última campanha e quando começa a próxima (se cadastradas). */
export function textoDasOutrasCampanhas(opcao) {
  const textos = [];
  const maior = (c) => Math.max(...c.faixas.map((f) => (typeof f.bonus_percentual === 'number' ? f.bonus_percentual : 0)));
  if (opcao.proxima_campanha) textos.push(`Próxima campanha cadastrada: começa em ${formatarData(opcao.proxima_campanha.inicio)}, com até ${maior(opcao.proxima_campanha)}% de bônus.`);
  if (opcao.ultima_campanha) textos.push(`Última campanha que vimos: até ${formatarData(opcao.ultima_campanha.fim)}, com até ${maior(opcao.ultima_campanha)}% de bônus.`);
  return textos;
}

/** Uma linha da lista "Bônus de transferência hoje". */
export function textoDaCampanha(item) {
  const titulo = item.maior_bonus === null
    ? `${item.nome_origem} → ${item.nome_destino}: bônus a confirmar`
    : `${item.nome_origem} → ${item.nome_destino}: até ${item.maior_bonus}% de bônus`;
  const fim = item.campanha.fim === 'A_CONFIRMAR'
    ? 'Fim da campanha a confirmar.'
    : item.termina_hoje ? 'Termina hoje.' : `Vai até ${formatarData(item.campanha.fim)}.`;
  const detalhes = [`${item.faixas_texto.charAt(0).toUpperCase()}${item.faixas_texto.slice(1)}.`, fim];
  if (item.campanha.exige_cadastro) detalhes.push('Precisa se cadastrar na campanha antes de transferir.');
  return { titulo, detalhes };
}

/** Anúncio curto para leitor de tela depois de calcular a transferência. */
export function anuncioDaTransferencia(resultado) {
  const melhor = resultado.opcoes.find((o) => o.calculavel && !o.abaixo_do_minimo);
  if (!melhor) return 'Nenhum destino deu para calcular com esses pontos. Veja os avisos.';
  return `Rende mais na ${melhor.nome_destino}: ${pts(melhor.milhas_total)} pontos.`;
}

/** O número grande do card de passagem ou hotel. */
export function destaqueDaViagem(jeito) {
  if (jeito.pontos === null) return { principal: 'A confirmar', legenda: 'Falta um dado para a conta; veja o aviso abaixo.' };
  const principal = `${pts(jeito.pontos)} pontos ${jeito.nome_programa}`;
  const partes = [];
  if (jeito.valor !== null) partes.push(`Valem uns ${formatarValor(jeito.valor)}.`);
  if (jeito.cartao) {
    partes.push(`Mais ${pts(jeito.cartao.esc)} pontos ${jeito.cartao.nome_programa} pelo cartão ${jeito.cartao.cartao.nome}.`);
    if (jeito.valor_total !== null) partes.push(`Total: uns ${formatarValor(jeito.valor_total)}.`);
  }
  return { principal, legenda: partes.join(' ') };
}

/** Frase "faça assim" do card de passagem ou hotel. */
export function fraseDaViagem(jeito) {
  const onde = jeito.regra.tipo === 'hotel' ? `Reserve em ${jeito.regra.vendedor}` : `Compre com a ${jeito.regra.vendedor}`;
  const cartao = jeito.cartao ? ` e pague com o cartão ${jeito.cartao.cartao.nome}` : '';
  return `${onde}${cartao}, informando o seu número de cliente ${jeito.nome_programa}.`;
}

export function anuncioDaViagem(resultado) {
  const melhor = resultado.jeitos.find((j) => j.pontos !== null);
  if (!melhor) return 'Não deu para calcular. Veja os avisos.';
  return `Rende ${pts(melhor.pontos)} pontos ${melhor.nome_programa}.`;
}
