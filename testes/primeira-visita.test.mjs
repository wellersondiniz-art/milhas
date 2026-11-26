// Primeira visita e "vale a pena?" (site/js/tela/primeira-visita.js): padrões
// da conta, ajuste rápido, exemplos de um toque e textos da anuidade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularAnuidade, calcularJeitosDeComprar } from '../site/js/motor/index.js';
import { fraseDoJeito } from '../site/js/tela/textos.js';
import { perfilDeTodos } from '../site/js/perfil/formato.js';
import {
  JEITOS_ABERTOS, VALOR_EXEMPLO_CENTAVOS, cartaoSugerido, cotacaoDe, escolhaDeCartao, exemplosRapidos, fraseSemPontos,
  juntarJeitosIguais, lerPorcento, lojasComOferta, milheiroDe, perfilComAjuste, premissasDaConta, programasComOfertaNaLoja, separarJeitos,
  textoAnuidade,
} from '../site/js/tela/primeira-visita.js';

const FONTE = 'https://exemplo.invalid/teste';
const HOJE = '2026-11-10';

function dados({ cotacao = 'A_CONFIRMAR' } = {}) {
  return {
    programas: [
      { id: 'alfa', nome: 'Alfa', valor_milheiro_brl: 2000, valor_milheiro_origem: 'estimativa_editavel', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'beta', nome: 'Beta', valor_milheiro_brl: 'A_CONFIRMAR', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'gama', nome: 'Gama', valor_milheiro_brl: 1500, fonte_url: FONTE, verificado_em: HOJE },
    ],
    cartoes: [
      { id: 'c-alfa', nome: 'Cartão Alfa', programa_id: 'alfa', pontos_por_real: 2, anuidade_brl: 60000, status: 'confirmado', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'c-beta', nome: 'Cartão Beta', programa_id: 'beta', pontos_por_real: 3, anuidade_brl: 'A_CONFIRMAR', status: 'confirmado', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'c-dolar', nome: 'Cartão Dólar', programa_id: 'alfa', pontos_por_real: 'A_CONFIRMAR', pontos_por_dolar: 3, anuidade_brl: 100000, status: 'confirmado', fonte_url: FONTE, verificado_em: HOJE },
    ],
    lojas: [
      { id: 'sem', nome: 'Loja Sem', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'com', nome: 'Loja Com', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'velha', nome: 'Loja Velha', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'outra', nome: 'Loja Outra', fonte_url: FONTE, verificado_em: HOJE },
    ],
    ofertas: [
      { id: 'o1', loja_id: 'com', programa_id: 'alfa', regras: [{ condicao: {}, pontos_por_real: 5 }], escopo: 'tudo', acumula_com_cartao: true, inicio: '2026-11-01', fim: '2026-11-30', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'o2', loja_id: 'velha', programa_id: 'alfa', regras: [{ condicao: {}, pontos_por_real: 5 }], escopo: 'tudo', inicio: '2026-10-01', fim: '2026-10-30', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'o3', loja_id: 'outra', programa_id: 'gama', regras: [{ condicao: {}, pontos_por_real: 5 }], escopo: 'tudo', status: 'A_CONFIRMAR', inicio: 'A_CONFIRMAR', fim: 'A_CONFIRMAR', fonte_url: FONTE, verificado_em: HOJE },
      { id: 'o4', loja_id: 'outra', programa_id: 'beta', regras: [{ condicao: {}, pontos_por_real: 5 }], escopo: 'tudo', inicio: '2026-12-01', fim: 'A_CONFIRMAR', fonte_url: FONTE, verificado_em: HOJE },
    ],
    cambio: [{ id: 'usd-brl', reais_por_dolar: cotacao, data_referencia: cotacao === 'A_CONFIRMAR' ? 'A_CONFIRMAR' : '2026-11-19', fonte_url: FONTE, verificado_em: HOJE }],
  };
}

// ---------------------------------------------------------------------------
// Exemplos

test('exemplos: lojas com oferta valendo hoje vêm primeiro', () => {
  const d = dados();
  assert.deepEqual([...lojasComOferta(d.ofertas, HOJE)], ['com']);
  const ex = exemplosRapidos(d.lojas, d.ofertas, HOJE);
  assert.deepEqual(ex.map((e) => e.loja.id), ['com', 'sem', 'velha']);
  assert.equal(ex[0].temOferta, true);
  assert.equal(ex[0].valor_centavos, VALOR_EXEMPLO_CENTAVOS);
  assert.equal(ex[0].texto, 'Loja Com · R$ 1.000,00');
  // Sem ofertas ainda (carregando): ordem do cadastro.
  assert.deepEqual(exemplosRapidos(d.lojas, null, HOJE, 2).map((e) => e.loja.id), ['sem', 'com']);
  assert.deepEqual(lojasComOferta(undefined, HOJE), new Set());
});

test('programas com oferta na loja: só o que vale hoje', () => {
  const d = dados();
  assert.deepEqual(programasComOfertaNaLoja(d, 'com', HOJE).map((p) => p.id), ['alfa']);
  assert.deepEqual(programasComOfertaNaLoja(d, 'outra', HOJE), []);
  assert.deepEqual(programasComOfertaNaLoja(d, 'velha', HOJE), []);
});

// ---------------------------------------------------------------------------
// Milheiro e cotação

test('milheiro e cotação: o do perfil vence o do cadastro', () => {
  const d = dados({ cotacao: 58889 });
  assert.deepEqual(milheiroDe('alfa', null, d), { centavos: 2000, doPerfil: false, estimativa: true });
  assert.deepEqual(milheiroDe('alfa', { valor_milheiro_brl: { alfa: 2500 } }, d), { centavos: 2500, doPerfil: true });
  assert.equal(milheiroDe('beta', null, d), null);
  assert.equal(milheiroDe('nao-existe', null, d), null);
  assert.equal(cotacaoDe(null, d).x10000, 58889);
  assert.deepEqual(cotacaoDe({ cotacao_dolar: 50000 }, d), { x10000: 50000, doPerfil: true, registro: null });
  assert.equal(cotacaoDe(null, dados()), null);
  assert.equal(cotacaoDe({}, { cambio: undefined }), null);
});

// ---------------------------------------------------------------------------
// Premissas

function conta(d, perfil, lojaId = 'com') {
  return calcularJeitosDeComprar(perfil, { loja_id: lojaId, valor_centavos: 100000, tipo_vendedor: 'loja' }, d, HOJE);
}

test('premissas sem perfil: todos os cartões, sem clube, milheiro estimado e falta do dólar', () => {
  const d = dados();
  const perfil = perfilDeTodos(d);
  const lista = premissasDaConta({ dados: d, perfil, semPerfil: true, jeitos: conta(d, perfil) });
  const textos = lista.map((p) => p.texto);
  assert.equal(textos[0], 'Produto vendido e entregue pela própria loja, não por um vendedor parceiro.');
  assert.ok(textos.includes('Todos os 3 cartões de pontos que conhecemos. Escolha o seu abaixo para ver só o que é seu.'));
  assert.ok(textos.includes('Sem assinatura de clube de pontos.'));
  assert.ok(textos.includes('1.000 pontos Alfa valem uns R$ 20,00 (estimativa média).'));
  assert.ok(textos.includes('Beta: ainda sem valor de milheiro confirmado, então mostramos só os pontos.'));
  const dolar = lista.find((p) => p.chave === 'dolar');
  assert.equal(dolar.falta, true);
});

test('premissas com perfil: um cartão, clube, milheiro do perfil e dólar informado', () => {
  const d = dados({ cotacao: 58889 });
  const perfil = { programas: [{ programa_id: 'alfa', clube_ativo: true }], cartoes: ['c-dolar'], valor_milheiro_brl: { alfa: 2500 }, cotacao_dolar: 50000 };
  const textos = premissasDaConta({ dados: d, perfil, semPerfil: false, jeitos: conta(d, perfil) }).map((p) => p.texto);
  assert.ok(textos.includes('Pagando com o cartão Cartão Dólar.'));
  assert.ok(textos.includes('Com clube ativo: Alfa.'));
  assert.ok(textos.includes('1.000 pontos Alfa valem R$ 25,00 (valor que você informou).'));
  assert.ok(textos.includes('Dólar a R$ 5,0000 (valor que você informou).'));
  // Sem dólar no perfil: a PTAX do cadastro, com a data.
  const semDolar = { ...perfil, cotacao_dolar: undefined, valor_milheiro_brl: {} };
  delete semDolar.cotacao_dolar;
  const t2 = premissasDaConta({ dados: d, perfil: semDolar, semPerfil: false, jeitos: conta(d, semDolar) }).map((p) => p.texto);
  assert.ok(t2.includes('Dólar a R$ 5,8889 (PTAX do Banco Central de 19/11/2026).'));
});

test('premissas: nenhum cartão, vários cartões e milheiro sem "estimativa"', () => {
  const d = dados();
  const nenhum = { programas: [{ programa_id: 'alfa', clube_ativo: false }], cartoes: [], valor_milheiro_brl: {} };
  const t1 = premissasDaConta({ dados: d, perfil: nenhum, semPerfil: false, jeitos: conta(d, nenhum) }).map((p) => p.texto);
  assert.ok(t1.includes('Sem cartão de pontos: contamos só os pontos da oferta da loja.'));
  assert.ok(!t1.some((t) => t.startsWith('Dólar') || t.startsWith('Falta')));
  const dois = { programas: [{ programa_id: 'gama', clube_ativo: false }], cartoes: ['c-alfa', 'c-beta'], valor_milheiro_brl: {} };
  const jeitosGama = [{ total_pontos: 10, programa: { id: 'gama' }, pontos_do_cartao: 0, cartao: null }, { total_pontos: 5, programa: { id: 'x' }, pontos_do_cartao: 5, cartao: { id: 'nao-existe' } }];
  const t2 = premissasDaConta({ dados: d, perfil: dois, semPerfil: false, jeitos: jeitosGama }).map((p) => p.texto);
  assert.ok(t2.includes('Os 2 cartões do seu perfil.'));
  assert.ok(t2.includes('1.000 pontos Gama valem uns R$ 15,00.'));
  assert.ok(t2.includes('x: ainda sem valor de milheiro confirmado, então mostramos só os pontos.'));
  const clubeSemNome = { programas: [{ programa_id: 'sumiu', clube_ativo: true }], cartoes: [], valor_milheiro_brl: {} };
  assert.ok(premissasDaConta({ dados: d, perfil: clubeSemNome, semPerfil: false, jeitos: [] }).some((p) => p.texto === 'Com clube ativo: sumiu.'));
});

// ---------------------------------------------------------------------------
// Ajuste rápido

test('escolha de cartão reflete o perfil', () => {
  const d = dados();
  const p = (cartoes) => ({ programas: [], cartoes, valor_milheiro_brl: {} });
  assert.equal(escolhaDeCartao(p([]), d, true), 'todos');
  assert.equal(escolhaDeCartao(p([]), d, false), 'nenhum');
  assert.equal(escolhaDeCartao(p(['c-beta']), d, false), 'c-beta');
  assert.equal(escolhaDeCartao(p(['c-alfa', 'c-beta', 'c-dolar']), d, false), 'todos');
  assert.equal(escolhaDeCartao(p(['c-alfa', 'c-beta']), d, false), 'meus');
});

test('ajuste sem perfil parte de todos os programas, e o cartão escolhido vira o único', () => {
  const d = dados();
  const novo = perfilComAjuste(null, d, { cartao: 'c-beta' });
  assert.equal(novo.versao, 2);
  assert.deepEqual(novo.cartoes, ['c-beta']);
  assert.deepEqual(novo.programas.map((p) => p.programa_id), ['alfa', 'beta', 'gama']);
  assert.ok(novo.programas.every((p) => p.clube_ativo === false));
  assert.deepEqual(perfilComAjuste(null, d, { cartao: 'nenhum' }).cartoes, []);
  assert.deepEqual(perfilComAjuste(null, d, { cartao: 'todos' }).cartoes, ['c-alfa', 'c-beta', 'c-dolar']);
  // Id que não existe e "meus" não mexem nos cartões.
  assert.deepEqual(perfilComAjuste(null, d, { cartao: 'inventado' }).cartoes, ['c-alfa', 'c-beta', 'c-dolar']);
  assert.deepEqual(perfilComAjuste(null, d, { cartao: 'meus' }).cartoes, ['c-alfa', 'c-beta', 'c-dolar']);
});

test('ajuste com perfil: preserva o resto, inclui o programa do cartão e não muda o original', () => {
  const d = dados();
  const atual = { versao: 2, programas: [{ programa_id: 'gama', clube_ativo: true, clube_ativo_desde: '2026-11-01' }], cartoes: ['c-alfa'], valor_milheiro_brl: { gama: 1800 }, cotacao_dolar: 50000 };
  const copia = structuredClone(atual);
  const novo = perfilComAjuste(atual, d, { cartao: 'c-beta' });
  assert.deepEqual(atual, copia);
  assert.deepEqual(novo.cartoes, ['c-beta']);
  assert.deepEqual(novo.programas.map((p) => p.programa_id), ['gama', 'beta']);
  assert.equal(novo.programas[0].clube_ativo_desde, '2026-11-01');
  assert.deepEqual(novo.valor_milheiro_brl, { gama: 1800 });
  assert.equal(novo.cotacao_dolar, 50000);
});

test('ajuste do clube: liga com data, desliga e tira a data, ignora programa que não existe', () => {
  const d = dados();
  const com = perfilComAjuste(null, d, { clube: { programa_id: 'alfa', ativo: true, desde: '2026-11-01' } });
  assert.deepEqual(com.programas[0], { programa_id: 'alfa', clube_ativo: true, clube_ativo_desde: '2026-11-01' });
  const semData = perfilComAjuste(com, d, { clube: { programa_id: 'alfa', ativo: true, desde: 'ontem' } });
  assert.deepEqual(semData.programas[0], { programa_id: 'alfa', clube_ativo: true });
  const desligado = perfilComAjuste(com, d, { clube: { programa_id: 'alfa', ativo: false, desde: '2026-11-01' } });
  assert.deepEqual(desligado.programas[0], { programa_id: 'alfa', clube_ativo: false });
  // Perfil só com cartão: o programa do clube entra.
  const soCartao = { versao: 2, programas: [], cartoes: ['c-beta'], valor_milheiro_brl: {} };
  assert.deepEqual(perfilComAjuste(soCartao, d, { clube: { programa_id: 'gama', ativo: true } }).programas, [{ programa_id: 'gama', clube_ativo: true }]);
  assert.deepEqual(perfilComAjuste(soCartao, d, { clube: { programa_id: 'sumiu', ativo: true } }).programas, []);
});

test('ajuste do dólar: grava a cotação válida e apaga com vazio', () => {
  const d = dados();
  const com = perfilComAjuste(null, d, { cotacao_dolar: 58889 });
  assert.equal(com.cotacao_dolar, 58889);
  assert.equal('cotacao_dolar' in perfilComAjuste(com, d, { cotacao_dolar: null }), false);
  assert.equal('cotacao_dolar' in perfilComAjuste(com, d, { cotacao_dolar: 0 }), false);
  assert.equal(perfilComAjuste(com, d, {}).cotacao_dolar, 58889);
});

test('o perfil do ajuste rápido funciona no motor', () => {
  const d = dados();
  const perfil = perfilComAjuste(null, d, { cartao: 'c-alfa' });
  const [melhor] = conta(d, perfil);
  // Oferta 5 + cartão 2 = 7 pontos por real × R$ 1.000 = 7.000 pontos Alfa × R$ 20 = R$ 140,00
  assert.equal(melhor.total_pontos, 7000);
  assert.equal(melhor.valor_estimado_em_reais.texto, 'R$ 140,00');
  assert.equal(melhor.total_pontos_escalado, 7_000_000_000n);
});

// ---------------------------------------------------------------------------
// Quais jeitos mostrar

const j = (total, cartao) => ({ total_pontos: total, cartao: cartao ? { nome: cartao } : null });

test('separar jeitos: o melhor sempre, mais 2 abertos, o resto recolhido e os de zero numa linha', () => {
  const lista = [j(9, 'A'), j(8, 'B'), j(7, 'C'), j(6, 'D'), j(0, 'E'), j(0, 'F')];
  const s = separarJeitos(lista);
  assert.equal(JEITOS_ABERTOS, 3);
  assert.equal(s.melhor, lista[0]);
  assert.deepEqual(s.abertos, [lista[1], lista[2]]);
  assert.deepEqual(s.recolhidos, [lista[3]]);
  assert.deepEqual(s.semPontos, [lista[4], lista[5]]);
  const zero = separarJeitos([j(0, 'A'), j(0, 'B')]);
  assert.equal(zero.melhor.cartao.nome, 'A');
  assert.deepEqual(zero.abertos, []);
  assert.equal(zero.semPontos.length, 1);
  assert.deepEqual(separarJeitos([]), { melhor: null, abertos: [], recolhidos: [], semPontos: [] });
  assert.equal(separarJeitos(lista, 1).abertos.length, 0);
});

test('frase dos jeitos sem pontos', () => {
  assert.equal(fraseSemPontos([], true), '');
  assert.equal(fraseSemPontos([j(0, 'A'), j(0, 'A'), j(0, 'B')], true),
    'Os 2 cartões A, B não rendem pontos nesta compra, porque eles dão pontos por dólar e falta a cotação do dólar (informe no ajuste acima).');
  assert.equal(fraseSemPontos([j(0, 'A')], false),
    'O cartão A não rende pontos nesta compra, com o que sabemos hoje (pontos ainda não confirmados ou sem oferta).');
  assert.match(fraseSemPontos([j(0, null)], false), /^Os outros jeitos não rendem/);
  assert.match(fraseSemPontos(['A', 'B', 'C', 'D'].map((n) => j(0, n)), true), /^Os outros 4 cartões não rendem pontos/);
});

test('cartão sugerido para a anuidade', () => {
  const d = dados();
  const perfil = { cartoes: ['c-beta'] };
  assert.equal(cartaoSugerido([{ total_pontos: 0, cartao: { id: 'c-alfa' } }, { total_pontos: 5, cartao: { id: 'c-dolar' } }], perfil, d), 'c-dolar');
  assert.equal(cartaoSugerido([], perfil, d), 'c-beta');
  assert.equal(cartaoSugerido([], { cartoes: [] }, d), 'c-alfa');
  assert.equal(cartaoSugerido([], { cartoes: [] }, { cartoes: [{ id: 'x', anuidade_brl: 'A_CONFIRMAR' }] }), 'x');
  assert.equal(cartaoSugerido([], { cartoes: [] }, { cartoes: [] }), null);
});

test('ler porcentagem', () => {
  assert.equal(lerPorcento('5'), 500);
  assert.equal(lerPorcento('5,5'), 550);
  assert.equal(lerPorcento('12.25 %'), 1225);
  assert.equal(lerPorcento('100'), 10000);
  assert.equal(lerPorcento('101'), null);
  assert.equal(lerPorcento(''), null);
  assert.equal(lerPorcento(undefined), null);
  assert.equal(lerPorcento('5,555'), null);
  assert.equal(lerPorcento('abc'), null);
});

// ---------------------------------------------------------------------------
// Texto da anuidade

const cartao = { id: 'c', nome: 'Cartão X', programa_id: 'p', pontos_por_real: 2, anuidade_brl: 60000, status: 'confirmado' };

test('anuidade sem gasto informado: diz o gasto mínimo para compensar', () => {
  const r = calcularAnuidade({ cartao, gasto_mensal_centavos: 0, milheiro: { centavos: 2000 } });
  const t = textoAnuidade(r, false);
  assert.equal(t.principal, 'Para os pontos pagarem a anuidade de R$ 600,00, você precisa gastar pelo menos R$ 1.250,00 por mês no Cartão X. Diga o seu gasto para ver a conta.');
  assert.ok(t.detalhes[0].startsWith('Muitos cartões'));
});

test('anuidade com gasto: veredito e detalhes', () => {
  const r = calcularAnuidade({ cartao, gasto_mensal_centavos: 200000, milheiro: { centavos: 2000 }, cashback_alternativo_porcento: 50 });
  const t = textoAnuidade(r, true);
  assert.equal(t.principal, r.veredito);
  assert.deepEqual(t.detalhes.slice(0, 4), [
    'Pontos por ano: 48.000.', 'Valor desses pontos: uns R$ 960,00.', 'Anuidade: R$ 600,00.', 'O cartão sem anuidade devolveria R$ 120,00.',
  ]);
});

test('anuidade: sem conta possível, nunca compensa e cartão sem anuidade', () => {
  const semMilheiro = textoAnuidade(calcularAnuidade({ cartao, gasto_mensal_centavos: 0, milheiro: null }), false);
  assert.equal(semMilheiro.principal, 'Ainda não dá para fazer a conta da anuidade do Cartão X:');
  assert.ok(semMilheiro.detalhes.some((d) => d.includes('milheiro')));
  const nunca = textoAnuidade(calcularAnuidade({ cartao, gasto_mensal_centavos: 0, milheiro: { centavos: 2000 }, cashback_alternativo_porcento: 500 }), false);
  assert.match(nunca.principal, /^Com esse valor de milheiro, nenhum gasto/);
  const gratis = textoAnuidade(calcularAnuidade({ cartao: { ...cartao, anuidade_brl: 0 }, gasto_mensal_centavos: 0, milheiro: null }), false);
  assert.match(gratis.principal, /não tem anuidade no nosso cadastro/);
  const semValor = textoAnuidade(calcularAnuidade({ cartao, gasto_mensal_centavos: 100000, milheiro: null }), true);
  assert.deepEqual(semValor.detalhes.slice(0, 2), ['Pontos por ano: 24.000.', 'Anuidade: R$ 600,00.']);
});

// ---------------------------------------------------------------------------
// Mesma oferta repetida para cada cartão

test('juntar jeitos: oferta que não soma com o cartão vira um card só, sem mudar a ordem', () => {
  const d = dados({ cotacao: 58889 });
  // A oferta não soma com o cartão e rende mais que qualquer um deles.
  d.ofertas[0] = { ...d.ofertas[0], acumula_com_cartao: 'A_CONFIRMAR', regras: [{ condicao: {}, pontos_por_real: 10 }] };
  const jeitos = calcularJeitosDeComprar(perfilDeTodos(d), { loja_id: 'com', valor_centavos: 10000, tipo_vendedor: 'loja' }, d, HOJE);
  const comOferta = jeitos.filter((j) => j.tipo === 'oferta');
  assert.equal(comOferta.length, 3);
  const juntos = juntarJeitosIguais(jeitos);
  assert.equal(juntos.length, jeitos.length - 2);
  const [primeiro] = juntos;
  assert.equal(primeiro.tipo, 'oferta');
  assert.equal(primeiro.cartao, null);
  assert.deepEqual(primeiro.cartoes_que_servem, comOferta.map((j) => j.cartao.nome));
  assert.equal(primeiro.total_pontos, 1000);
  // Nada de aviso, data ou passo que fale de um cartão só.
  for (const texto of [...primeiro.avisos, ...primeiro.explicacao, ...primeiro.conferido_em.map((c) => c.rotulo)]) {
    assert.doesNotMatch(texto, /Cartão (Alfa|Beta|Dólar)|dólar|somam|Sem somar/, texto);
  }
  assert.ok(primeiro.conferido_em.some((c) => /^oferta Alfa/.test(c.rotulo)));
  assert.equal(fraseDoJeito(primeiro, d.lojas[1]),
    'Compre na Loja Com pela oferta do Alfa. Os pontos vêm só da oferta, então tanto faz qual cartão você usa para pagar.');
  // Os jeitos sem oferta continuam, um por cartão, na mesma ordem.
  assert.deepEqual(juntos.slice(1), jeitos.filter((j) => j.tipo !== 'oferta'));
});

test('juntar jeitos: oferta que soma com o cartão, ou um cartão só, não muda nada', () => {
  const d = dados({ cotacao: 58889 });
  const perfil = perfilDeTodos(d);
  const compra = { loja_id: 'com', valor_centavos: 10000, tipo_vendedor: 'loja' };
  const somando = calcularJeitosDeComprar(perfil, compra, d, HOJE);
  assert.deepEqual(juntarJeitosIguais(somando), somando);
  d.ofertas[0] = { ...d.ofertas[0], acumula_com_cartao: false, regras: [{ condicao: {}, pontos_por_real: 10 }] };
  const umCartao = calcularJeitosDeComprar({ ...perfil, cartoes: ['c-alfa'] }, compra, d, HOJE);
  assert.deepEqual(juntarJeitosIguais(umCartao), umCartao);
  assert.match(fraseDoJeito(umCartao[0], d.lojas[1]), /pague com o cartão Cartão Alfa/);
  assert.deepEqual(juntarJeitosIguais([]), []);
});

test('premissas: programas com o mesmo milheiro viram uma linha só', () => {
  const d = dados({ cotacao: 58889 });
  d.programas.push({ id: 'delta', nome: 'Delta', valor_milheiro_brl: 2000, valor_milheiro_origem: 'estimativa_editavel', fonte_url: FONTE, verificado_em: HOJE });
  d.programas.push({ id: 'eps', nome: 'Eps', valor_milheiro_brl: 'A_CONFIRMAR', fonte_url: FONTE, verificado_em: HOJE });
  d.cartoes.push({ id: 'c-delta', nome: 'Cartão Delta', programa_id: 'delta', pontos_por_real: 1, anuidade_brl: 0, status: 'confirmado', fonte_url: FONTE, verificado_em: HOJE });
  d.cartoes.push({ id: 'c-eps', nome: 'Cartão Eps', programa_id: 'eps', pontos_por_real: 1, anuidade_brl: 0, status: 'confirmado', fonte_url: FONTE, verificado_em: HOJE });
  const perfil = perfilDeTodos(d);
  const jeitos = calcularJeitosDeComprar(perfil, { loja_id: 'sem', valor_centavos: 10000, tipo_vendedor: 'loja' }, d, HOJE);
  const textos = premissasDaConta({ dados: d, perfil, semPerfil: true, jeitos }).map((p) => p.texto);
  assert.ok(textos.includes('1.000 pontos valem uns R$ 20,00 em cada um destes: Alfa e Delta (estimativa média).'), textos.join('\n'));
  assert.ok(textos.includes('Beta e Eps: ainda sem valor de milheiro confirmado, então mostramos só os pontos.'), textos.join('\n'));
  const doPerfil = { ...perfil, valor_milheiro_brl: { alfa: 2500, delta: 2500 } };
  const t2 = premissasDaConta({ dados: d, perfil: doPerfil, semPerfil: false, jeitos }).map((p) => p.texto);
  assert.ok(t2.includes('1.000 pontos valem R$ 25,00 em cada um destes: Alfa e Delta (valor que você informou).'), t2.join('\n'));
});
