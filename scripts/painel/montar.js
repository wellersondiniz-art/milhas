// Monta o painel semanal em Markdown a partir dos eventos já contados.
// Função pura: recebe os números e os dados do site, devolve o texto.

import { calcularJeitosDeComprar } from '../../site/js/motor/index.js';
import { perfilDeTodos } from '../../site/js/perfil/formato.js';

const DIA = 24 * 60 * 60 * 1000;

/** Semana fechada que termina ontem: { inicio, fim } em AAAA-MM-DD. */
export function semanaAte(hoje, fim = null) {
  const somar = (data, dias) => new Date(Date.parse(`${data}T00:00:00Z`) + dias * DIA).toISOString().slice(0, 10);
  const ultimo = fim ?? somar(hoje, -1);
  return { inicio: somar(ultimo, -6), fim: ultimo };
}

/** Ids das lojas que têm alguma oferta valendo hoje (pela conta do motor, com todos os cartões e programas). */
export function lojasComOferta(dados, hoje) {
  const perfil = perfilDeTodos(dados);
  const com = new Set();
  for (const loja of dados.lojas) {
    const jeitos = calcularJeitosDeComprar(perfil, { loja_id: loja.id, valor_centavos: 10000, tipo_vendedor: 'loja' }, dados, `${hoje}T12:00`);
    if (jeitos.some((j) => j.tipo === 'oferta')) com.add(loja.id);
  }
  return com;
}

const numero = (n) => n.toLocaleString('pt-BR');
const data = (iso) => iso.split('-').reverse().join('/');
const celula = (t) => String(t ?? '').replace(/\|/g, '\\|');
const porcento = (parte, todo) => (todo ? `${(Math.round((parte / todo) * 1000) / 10).toLocaleString('pt-BR')}%` : '—');

function tabela(cabecalho, linhas, vazio) {
  if (!linhas.length) return `_${vazio}_\n`;
  const fila = (c) => `| ${c.map(celula).join(' | ')} |`;
  return [fila(cabecalho), fila(cabecalho.map(() => '---')), ...linhas.map(fila)].join('\n') + '\n';
}

/** Soma os totais por uma chave (ou função) das propriedades. */
function somarPor(linhas, chave) {
  const soma = new Map();
  for (const { props, total } of linhas) {
    const k = typeof chave === 'function' ? chave(props) : props[chave];
    soma.set(k, (soma.get(k) ?? 0) + total);
  }
  return soma;
}

const total = (linhas) => linhas.reduce((s, l) => s + l.total, 0);
const ordenar = (mapa) => [...mapa].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

/** Loja do destino de um clique, pelo domínio de lojas.json. */
function lojaDoDestino(destino, lojas) {
  if (!destino) return null;
  return lojas.find((l) => {
    const d = l.dominio.replace(/^www\./, '');
    return destino === d || destino.endsWith(`.${d}`);
  }) ?? null;
}

/**
 * @param {object} p
 *   periodo   { inicio, fim }
 *   eventos   { busca_loja, calculo, clique_saida, instalacao, oferta_vencida_vista }: [{ props, total }]
 *   lojas     dados/lojas.json
 *   comOferta Set de ids de loja com oferta valendo hoje
 *   site      nome do site no Plausible
 *   geradoEm  AAAA-MM-DD
 *   limite    quantas lojas na lista das mais buscadas (padrão 15)
 */
export function montarPainel({ periodo, eventos, lojas, comOferta, site, geradoEm, limite = 15 }) {
  const nomeDaLoja = new Map(lojas.map((l) => [l.id, l.nome]));
  const nome = (id) => nomeDaLoja.get(id) ?? id ?? '(sem loja)';
  const { busca_loja: buscas = [], calculo: calculos = [], clique_saida: cliques = [] } = eventos;
  const instalacoes = total(eventos.instalacao ?? []);
  const vencidas = eventos.oferta_vencida_vista ?? [];

  const daLista = buscas.filter((l) => l.props.loja && l.props.loja !== 'fora-da-lista');
  const foraDaLista = total(buscas.filter((l) => l.props.loja === 'fora-da-lista'));
  const buscasPorLoja = somarPor(daLista, 'loja');
  const naCalculadora = somarPor(daLista.filter((l) => l.props.origem === 'calculadora'), 'loja');
  const pelasPaginas = somarPor(daLista.filter((l) => l.props.origem === 'pagina-da-loja'), 'loja');
  const contasPorLoja = somarPor(calculos, 'loja');
  const cliquesNaCalculadora = cliques.filter((l) => l.props.pagina === 'inicio');
  const cliquesCalcPorLoja = somarPor(cliquesNaCalculadora, 'loja');
  const totalContas = total(calculos);
  const totalCliquesCalc = total(cliquesNaCalculadora);

  const partes = [];
  partes.push(`# Painel semanal: ${data(periodo.inicio)} a ${data(periodo.fim)}\n`);
  partes.push(`Números do Plausible (site ${site}), gerado em ${data(geradoEm)}. Cada número conta eventos, não pessoas: quem buscou a mesma loja duas vezes conta duas vezes.\n`);

  partes.push('## Resumo\n');
  partes.push(tabela(['O quê', 'Na semana'], [
    ['Buscas por loja', numero(total(buscas))],
    ['Contas feitas', numero(totalContas)],
    ['Cliques de saída (todos)', numero(total(cliques))],
    ['Cliques de saída na calculadora', numero(totalCliquesCalc)],
    ['Taxa calcular → clicar', porcento(totalCliquesCalc, totalContas)],
    ['Instalações do app', numero(instalacoes)],
    ['Ofertas vencidas vistas', numero(total(vencidas))],
  ], ''));
  partes.push('Taxa calcular → clicar = cliques para fora feitos na calculadora ÷ contas feitas.\n');

  partes.push(`## Lojas mais buscadas\n`);
  partes.push(tabela(['#', 'Loja', 'Buscas', 'Na calculadora', 'Pela página da loja', 'Contas', 'Oferta hoje?'],
    ordenar(buscasPorLoja).slice(0, limite).map(([id, n], i) => [
      i + 1, nome(id), numero(n), numero(naCalculadora.get(id) ?? 0), numero(pelasPaginas.get(id) ?? 0),
      numero(contasPorLoja.get(id) ?? 0), comOferta.has(id) ? 'sim' : '**não**',
    ]), 'Nenhuma busca na semana.'));

  partes.push('## Lojas sem oferta (para cadastrar)\n');
  partes.push('Lojas buscadas na semana que não têm nenhuma oferta valendo hoje nos dados, da mais buscada para a menos.\n');
  partes.push(tabela(['Loja', 'Buscas', 'Contas'],
    ordenar(buscasPorLoja).filter(([id]) => !comOferta.has(id)).map(([id, n]) => [nome(id), numero(n), numero(contasPorLoja.get(id) ?? 0)]),
    'Todas as lojas buscadas têm oferta valendo hoje.'));
  if (foraDaLista) {
    partes.push(`Além disso, ${numero(foraDaLista)} ${foraDaLista === 1 ? 'vez alguém digitou' : 'vezes alguém digitou'} uma loja que não está na lista. O site não manda o que foi digitado, então não dá para saber qual.\n`);
  }

  partes.push('## Cliques de saída\n');
  const porDestino = somarPor(cliques, (p) => p.destino);
  const daCalc = somarPor(cliquesNaCalculadora, (p) => p.destino);
  partes.push(tabela(['Site de destino', 'Loja', 'Cliques', 'Da calculadora', 'Das outras páginas'],
    ordenar(porDestino).map(([destino, n]) => {
      const c = daCalc.get(destino) ?? 0;
      return [destino ?? '(desconhecido)', lojaDoDestino(destino, lojas)?.nome ?? '—', numero(n), numero(c), numero(n - c)];
    }), 'Nenhum clique para fora na semana.'));

  partes.push('## Taxa calcular → clicar por loja\n');
  partes.push(tabela(['Loja', 'Contas', 'Cliques na calculadora', 'Taxa'],
    ordenar(contasPorLoja).map(([id, n]) => {
      const c = cliquesCalcPorLoja.get(id) ?? 0;
      return [nome(id), numero(n), numero(c), porcento(c, n)];
    }), 'Nenhuma conta na semana.'));

  partes.push('## Ofertas vencidas vistas\n');
  partes.push('Páginas onde alguém viu uma oferta que já acabou: bom lugar para conferir primeiro.\n');
  const rotulo = (p) => (p.loja ? `Loja: ${nome(p.loja)}` : p.pagina === 'ofertas' ? 'Página de ofertas' : `Página: ${p.pagina ?? '?'}`);
  partes.push(tabela(['Onde', 'Vezes'], ordenar(somarPor(vencidas, rotulo)).map(([r, n]) => [r, numero(n)]),
    'Ninguém viu oferta vencida na semana.'));

  partes.push('## Para ler direito\n');
  partes.push([
    '- Quem pede para não ser rastreado (Do Not Track ou Global Privacy Control) e quem usa bloqueador não entra nos números.',
    '- O Safari (iPhone) não avisa quando o app é instalado: as instalações são só as do Chrome e do Android.',
    '- "Oferta hoje?" usa os dados de hoje do repositório, não os da semana.',
  ].join('\n') + '\n');
  return partes.join('\n');
}
