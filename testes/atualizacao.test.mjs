// Testes do fluxo semanal de ofertas (scripts/coletar.js, extrair.js,
// propor-mudancas.js, aprovar-mudancas.js e scripts/atualizacao/).
// Nada aqui chama a internet nem a API: páginas fictícias e respostas do
// modelo escritas à mão (testes/atualizacao/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  htmlParaTexto, normalizar, contemTrecho, lerNumero, numerosNoTexto, lerData, decodificarEntidades,
} from '../scripts/atualizacao/texto.js';
import { validarFontes, dominioDe, pertenceAoDominio } from '../scripts/atualizacao/fontes.js';
import {
  converterExtracao, montarPedido, chamarModelo, lerResposta, ESQUEMA_RESPOSTA, MODELO_PADRAO, PROMPT, LIMITE_CARACTERES,
} from '../scripts/atualizacao/extracao.js';
import { compararOfertas, diferencas, pontosNormais, codigoDeAprovacao, chave } from '../scripts/atualizacao/comparar.js';
import { montarRelatorio, dataBr } from '../scripts/atualizacao/relatorio.js';
import { buscarPagina, lerData as lerDataArgv, carregarFontes } from '../scripts/coletar.js';
import { custoEmDolares } from '../scripts/extrair.js';
import { aprovar, linkParaComparar } from '../scripts/aprovar-mudancas.js';
import { rodarDemo, DATA } from './atualizacao/demo.mjs';

const RAIZ = new URL('../', import.meta.url);
const lerJson = async (caminho) => JSON.parse(await readFile(new URL(caminho, RAIZ), 'utf8'));
const cadastro = {
  programas: await lerJson('dados/programas.json'),
  lojas: await lerJson('dados/lojas.json'),
  cartoes: await lerJson('dados/cartoes.json'),
};
const schemaFontes = await lerJson('dados/schemas/fontes.schema.json');

// ---------------------------------------------------------------------------
// Texto

test('htmlParaTexto tira script, style e comentários e mantém os links', () => {
  const html = '<html><head><style>p{color:red}</style><script>var x = "10 pontos";</script></head>'
    + '<body><!-- 99 pontos --><h1>Oferta &amp; b&ocirc;nus</h1><p>Ganhe<br>5 pontos</p>'
    + '<a href="https://loja.exemplo/oferta">aqui</a><a href="/relativo">x</a>'
    + '<table><tr><td>Clube</td><td>12 pontos</td></tr></table>&#233;&#xE9;&naoexiste;</body></html>';
  const t = htmlParaTexto(html);
  assert.doesNotMatch(t, /color|var x|99 pontos/);
  assert.match(t, /Oferta & bônus/);
  assert.match(t, /Ganhe\n5 pontos/);
  assert.match(t, /aqui \[link: https:\/\/loja\.exemplo\/oferta\]/);
  assert.match(t, /Clube \| 12 pontos \|/);
  assert.match(t, /éé&naoexiste;/);
  assert.equal(decodificarEntidades('&#0;'), '&#0;');
});

test('normalizar e contemTrecho ignoram acento, caixa e espaços', () => {
  assert.equal(normalizar('  Válido   “só” — ÁGUA '), 'valido "so" - agua');
  assert.ok(contemTrecho('Válido apenas para\nprodutos', 'valido APENAS para produtos'));
  assert.equal(contemTrecho('texto', ''), false);
  assert.equal(contemTrecho('texto', 'outro'), false);
});

test('lerNumero aceita o jeito brasileiro e recusa o resto', () => {
  assert.equal(lerNumero('10'), 10);
  assert.equal(lerNumero('2,5'), 2.5);
  assert.equal(lerNumero('2.5'), 2.5);
  assert.equal(lerNumero('1.500'), 1500);
  assert.equal(lerNumero('dez'), null);
  assert.equal(lerNumero('10 pontos'), null);
  assert.deepEqual(numerosNoTexto('de 1.500 a 2,5 ou 3 pontos'), [1500, 2.5, 3]);
});

test('lerData lê datas escritas e não adivinha o ano', () => {
  assert.equal(lerData('14/11/2026'), '2026-11-14');
  assert.equal(lerData('1/2/26'), '2026-02-01');
  assert.equal(lerData('14 de novembro de 2026'), '2026-11-14');
  assert.equal(lerData('1º de março de 2027'), '2027-03-01');
  assert.equal(lerData('2026-11-14'), '2026-11-14');
  assert.equal(lerData('30/11'), null);
  assert.equal(lerData('31/02/2026'), null);
  assert.equal(lerData('14 de brumário de 2026'), null);
});

// ---------------------------------------------------------------------------
// Fontes

const fonte = (extra = {}) => ({
  id: 'azul-magalu', url: 'https://www.voeazul.com.br/br/pt/parceiros/magalu',
  programa_id: 'azul-fidelidade', loja_id: 'magalu', cadastrado_em: '2026-11-22', ...extra,
});

test('fontes: aceita página oficial do programa ou da loja, inclusive subdomínio', () => {
  assert.deepEqual(validarFontes([fonte()], schemaFontes, cadastro), []);
  assert.deepEqual(validarFontes([fonte({ url: 'https://especial.magazineluiza.com.br/pontos' })], schemaFontes, cadastro), []);
  assert.equal(dominioDe('https://www.livelo.com.br/x'), 'livelo.com.br');
  assert.ok(pertenceAoDominio('ofertas.livelo.com.br', 'www.livelo.com.br'));
  assert.equal(pertenceAoDominio('livelo.com.br.golpe.com', 'livelo.com.br'), false);
});

test('fontes: recusa blog, domínio de outro site, id repetido e cadastro inexistente', () => {
  const erros = (f) => validarFontes(f, schemaFontes, cadastro).join('\n');
  assert.match(erros([fonte({ url: 'https://passageirodeprimeira.com/?p=1' })]), /blog/);
  assert.match(erros([fonte({ url: 'https://www.exemplo.com.br/azul' })]), /não é domínio oficial/);
  assert.match(erros([fonte(), fonte()]), /id repetido/);
  assert.match(erros([fonte({ programa_id: 'nao-existe' })]), /programa_id "nao-existe" não existe/);
  assert.match(erros([fonte({ loja_id: 'nao-existe' })]), /loja_id "nao-existe" não existe/);
  assert.match(erros([fonte({ url: 'http://www.voeazul.com.br/' })]), /url/);
  assert.match(erros([{ id: 'x' }]), /obrigatório|required|falta/i);
});

test('dados/fontes.json do repositório é válido', async () => {
  const fontes = await carregarFontes(RAIZ);
  assert.ok(Array.isArray(fontes));
});

// ---------------------------------------------------------------------------
// Extração (modelo só copia texto; o código confere)

const PAGINA = [
  'Campanha válida de 20/11/2026 a 30/11/2026.',
  'Assinante do Clube | 12 pontos por real |',
  'Demais clientes | 6 pontos por real |',
  'Clientes Cartão Inexistente Gold | 9 pontos por real |',
  'Válido apenas para produtos vendidos e entregues pela loja.',
  'Use o cupom MILHAS10.',
  'Créditos em até 30 dias.',
  'Clube ativo há 24 horas.',
  'Mais informações [link: https://www.voeazul.com.br/oferta]',
].join('\n');
const C = (valor, trecho) => ({ valor, trecho });
const VAZIO = C('', 'A_CONFIRMAR');
const base = (extra = {}) => ({
  regras: [
    { pontos_por_real: C('12', 'Assinante do Clube | 12 pontos por real'), exige_clube: C('sim', 'Assinante do Clube'), cartao: C('', '') },
    { pontos_por_real: C('6', 'Demais clientes | 6 pontos por real'), exige_clube: C('', ''), cartao: C('', '') },
  ],
  escopo: C('vendido_e_entregue_pela_loja', 'Válido apenas para produtos vendidos e entregues pela loja.'),
  categorias_incluidas: VAZIO,
  pontos_fora_do_escopo_por_real: VAZIO,
  acumula_com_cartao: VAZIO,
  clube_ativo_ha_horas: C('24', 'Clube ativo há 24 horas.'),
  exige_cupom: C('sim', 'Use o cupom MILHAS10.'),
  cupom: C('MILHAS10', 'Use o cupom MILHAS10.'),
  inicio: C('20/11/2026', 'Campanha válida de 20/11/2026 a 30/11/2026.'),
  fim: C('30/11/2026', 'Campanha válida de 20/11/2026 a 30/11/2026.'),
  credito_prazo_dias: C('30', 'Créditos em até 30 dias.'),
  link_oferta: C('https://www.voeazul.com.br/oferta', 'Mais informações [link: https://www.voeazul.com.br/oferta]'),
  ...extra,
});
const converter = (ofertas, texto = PAGINA) => converterExtracao({
  resposta: { ofertas }, fonte: fonte(), texto, cartoes: cadastro.cartoes, data: '2026-11-22',
});

test('extração: valores com trecho na página viram uma oferta válida, com as provas', () => {
  const { ofertas, problemas, evidencias } = converter([base()]);
  assert.deepEqual(problemas, []);
  assert.equal(ofertas.length, 1);
  const o = ofertas[0];
  assert.equal(o.id, 'azul-fidelidade-magalu-2026-11');
  assert.deepEqual(o.regras, [
    { condicao: { clube_ativo: true }, pontos_por_real: 12 },
    { condicao: {}, pontos_por_real: 6 },
  ]);
  assert.equal(o.exige_cupom, true);
  assert.equal(o.cupom, 'MILHAS10');
  assert.equal(o.inicio, '2026-11-20');
  assert.equal(o.fim, '2026-11-30');
  assert.equal(o.credito_prazo_dias, 30);
  assert.equal(o.clube_ativo_ha_horas, 24);
  assert.equal(o.pontos_fora_do_escopo_por_real, 'A_CONFIRMAR');
  assert.equal(o.fonte_url, fonte().url);
  assert.equal(o.verificado_em, '2026-11-22');
  assert.equal(o.status, undefined);
  assert.ok(evidencias[o.id].some((p) => p.campo === 'pontos_por_real' && p.valor === 12));
});

test('extração: trecho que não está na página e número fora do trecho viram A_CONFIRMAR', () => {
  const { ofertas, problemas } = converter([base({
    credito_prazo_dias: C('45', 'Créditos em até 30 dias.'),
    clube_ativo_ha_horas: C('24', 'Clube ativo há 48 horas.'),
    acumula_com_cartao: C('sim', 'Os pontos somam com o cartão.'),
  })]);
  const o = ofertas[0];
  assert.equal(o.credito_prazo_dias, 'A_CONFIRMAR');
  assert.equal(o.clube_ativo_ha_horas, 'A_CONFIRMAR');
  assert.equal(o.acumula_com_cartao, 'A_CONFIRMAR');
  const motivos = problemas.map((p) => `${p.campo}: ${p.motivo}`).join('\n');
  assert.match(motivos, /credito_prazo_dias: o número não aparece no trecho/);
  assert.match(motivos, /clube_ativo_ha_horas: o trecho citado não está na página/);
  assert.match(motivos, /acumula_com_cartao: o trecho citado não está na página/);
});

test('extração: valores mal formados são recusados', () => {
  const texto = `${PAGINA}\nNão acumula com o cartão.\nCrédito em 1,5 dia.\nTerminou em 10/11/2026.`;
  const { ofertas, problemas } = converter([base({
    acumula_com_cartao: C('talvez', 'Não acumula com o cartão.'),
    credito_prazo_dias: C('1,5', 'Crédito em 1,5 dia.'),
    clube_ativo_ha_horas: C('vinte', 'Clube ativo há 24 horas.'),
    fim: C('10/11/2026', 'Campanha válida de 20/11/2026 a 30/11/2026.'),
    link_oferta: C('http://www.voeazul.com.br/oferta', 'Mais informações'),
  })], texto);
  const o = ofertas[0];
  assert.equal(o.acumula_com_cartao, 'A_CONFIRMAR');
  assert.equal(o.credito_prazo_dias, 'A_CONFIRMAR');
  assert.equal(o.clube_ativo_ha_horas, 'A_CONFIRMAR');
  assert.equal(o.fim, 'A_CONFIRMAR');
  assert.equal(o.link_oferta, 'A_CONFIRMAR');
  const motivos = problemas.map((p) => p.motivo).join('\n');
  assert.match(motivos, /"sim" ou "nao"/);
  assert.match(motivos, /número inteiro/);
  assert.match(motivos, /não é um número/);
  assert.match(motivos, /a data não aparece no trecho/);
  assert.match(motivos, /link não começa com https/);

  const nao = converter([base({ acumula_com_cartao: C('não', 'Não acumula com o cartão.') })], texto);
  assert.equal(nao.ofertas[0].acumula_com_cartao, false);

  const fimAntes = converter([base({ fim: C('10/11/2026', 'Terminou em 10/11/2026.') })], texto);
  assert.equal(fimAntes.ofertas[0].fim, 'A_CONFIRMAR');
  assert.match(fimAntes.problemas[0].motivo, /fim antes do início/);
});

test('extração: cartão não cadastrado tira a faixa; sem faixa não há oferta', () => {
  const cartaoDesconhecido = { pontos_por_real: C('9', 'Clientes Cartão Inexistente Gold | 9 pontos por real'), exige_clube: C('', ''), cartao: C('Cartão Inexistente Gold', 'Clientes Cartão Inexistente Gold') };
  const r1 = converter([base({ regras: [...base().regras, cartaoDesconhecido] })]);
  assert.equal(r1.ofertas[0].regras.length, 2);
  assert.match(r1.problemas[0].motivo, /cartão não cadastrado/);

  const cartaoForaDaPagina = { ...cartaoDesconhecido, cartao: C('Azul Itaú Infinite', 'cartão Azul Itaú Infinite') };
  const r2 = converter([base({ regras: [cartaoForaDaPagina] })]);
  assert.equal(r2.ofertas.length, 0);
  assert.match(r2.problemas.map((p) => p.motivo).join('\n'), /nenhuma faixa de pontos por real confirmada/);

  const r3 = converter([base({ regras: [{ pontos_por_real: VAZIO, exige_clube: VAZIO, cartao: VAZIO }] })]);
  assert.equal(r3.ofertas.length, 0);
});

test('extração: faixa com cartão cadastrado vira cartao_id; faixas repetidas somem', () => {
  const texto = `${PAGINA}\nCom cartão Azul Itaú Infinite | 15 pontos por real |`;
  const regra = { pontos_por_real: C('15', 'Com cartão Azul Itaú Infinite | 15 pontos por real'), exige_clube: C('', ''), cartao: C('cartão Azul Itaú Infinite', 'Com cartão Azul Itaú Infinite') };
  const { ofertas } = converter([base({ regras: [regra, regra] })], texto);
  assert.deepEqual(ofertas[0].regras, [{ condicao: { cartao_id: 'azul-itau-infinite' }, pontos_por_real: 15 }]);
  assert.equal(ofertas[0].clube_ativo_ha_horas, undefined);
});

test('extração: escopo, categorias e cupom não escritos deixam a oferta A_CONFIRMAR', () => {
  const semEscopo = converter([base({ escopo: VAZIO })]).ofertas[0];
  assert.equal(semEscopo.escopo, 'vendido_e_entregue_pela_loja');
  assert.equal(semEscopo.status, 'A_CONFIRMAR');

  const texto = `${PAGINA}\nSó nas categorias selecionadas: Celulares e Games.`;
  const trecho = 'Só nas categorias selecionadas: Celulares e Games.';
  const comCategorias = converter([base({ escopo: C('categorias_selecionadas', trecho), categorias_incluidas: C('Celulares; Games; Livros', trecho) })], texto).ofertas[0];
  assert.equal(comCategorias.escopo, 'categorias_selecionadas');
  assert.deepEqual(comCategorias.categorias_incluidas, ['Celulares', 'Games']);
  assert.equal(comCategorias.status, undefined);

  const semCategorias = converter([base({ escopo: C('categorias_selecionadas', trecho) })], texto).ofertas[0];
  assert.equal(semCategorias.escopo, 'vendido_e_entregue_pela_loja');
  assert.equal(semCategorias.status, 'A_CONFIRMAR');

  const semCodigo = converter([base({ cupom: VAZIO })]).ofertas[0];
  assert.equal(semCodigo.exige_cupom, 'A_CONFIRMAR');
  assert.equal(semCodigo.status, 'A_CONFIRMAR');

  const codigoForaDoTrecho = converter([base({ cupom: C('OUTRO', 'Use o cupom MILHAS10.') })]);
  assert.equal(codigoForaDoTrecho.ofertas[0].cupom, undefined);
  assert.match(codigoForaDoTrecho.problemas.map((p) => p.motivo).join('\n'), /cupom não aparece no trecho/);
});

test('extração: duas ofertas do mesmo mês ganham ids diferentes; sem início usa a data da coleta', () => {
  const { ofertas } = converter([base(), base({ inicio: VAZIO })]);
  assert.deepEqual(ofertas.map((o) => o.id), ['azul-fidelidade-magalu-2026-11', 'azul-fidelidade-magalu-2026-11-2']);
  assert.equal(ofertas[1].inicio, 'A_CONFIRMAR');
  assert.deepEqual(converter([]).ofertas, []);
});

// ---------------------------------------------------------------------------
// Chamada ao modelo (fetch falso)

test('pedido ao modelo: modelo barato, prompt rígido, saída só em JSON de textos', () => {
  const pedido = montarPedido({ texto: 'página', fonte: fonte() });
  assert.equal(MODELO_PADRAO, 'claude-haiku-5-5');
  assert.equal(pedido.model, 'claude-haiku-5-5');
  assert.equal(pedido.system, PROMPT);
  assert.match(PROMPT, /SOMENTE com JSON/);
  assert.match(PROMPT, /Se não estiver escrito, deixe vazio e marque A_CONFIRMAR/);
  assert.match(PROMPT, /não calcula/);
  assert.equal(pedido.output_config.format.type, 'json_schema');
  assert.equal(pedido.output_config.format.schema, ESQUEMA_RESPOSTA);
  assert.match(pedido.messages[0].content, /<pagina>\npágina\n<\/pagina>/);
  // Nenhum campo pedido ao modelo é número: ele só copia texto.
  const tipos = JSON.stringify(ESQUEMA_RESPOSTA).match(/"type":"(\w+)"/g);
  assert.ok(!tipos.some((t) => /number|integer|boolean/.test(t)));
});

test('chamarModelo: chave só no cabeçalho, respostas ruins viram erro', async () => {
  const chamadas = [];
  const ok = { content: [{ type: 'text', text: '{"ofertas":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
  const buscar = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return new Response(JSON.stringify(ok), { status: 200 });
  };
  const { resposta } = await chamarModelo({ texto: 'oi', fonte: fonte(), chave: 'chave-de-teste', buscar });
  assert.deepEqual(resposta, { ofertas: [] });
  assert.equal(chamadas[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(chamadas[0].opcoes.headers['x-api-key'], 'chave-de-teste');
  assert.doesNotMatch(chamadas[0].opcoes.body, /chave-de-teste/);

  await assert.rejects(chamarModelo({ texto: 'oi', fonte: fonte(), chave: '', buscar }), /ANTHROPIC_API_KEY/);
  await assert.rejects(chamarModelo({ texto: 'x'.repeat(LIMITE_CARACTERES + 1), fonte: fonte(), chave: 'k', buscar }), /não cortamos texto/);
  const erro = async () => new Response(JSON.stringify({ error: { message: 'chave inválida' } }), { status: 401 });
  await assert.rejects(chamarModelo({ texto: 'oi', fonte: fonte(), chave: 'k', buscar: erro }), /401: chave inválida/);
  const lixo = async () => new Response('<html>', { status: 500 });
  await assert.rejects(chamarModelo({ texto: 'oi', fonte: fonte(), chave: 'k', buscar: lixo }), /500: sem detalhe/);

  assert.throws(() => lerResposta({ stop_reason: 'refusal', content: [] }), /recusou/);
  assert.throws(() => lerResposta({ stop_reason: 'max_tokens', content: [] }), /cortada/);
  assert.throws(() => lerResposta({ content: [] }), /sem texto/);
  assert.throws(() => lerResposta({ content: [{ type: 'text', text: 'Claro! Aqui está' }] }), /JSON válido/);
  assert.throws(() => lerResposta({ content: [{ type: 'text', text: '{"outra":1}' }] }), /lista "ofertas"/);
  assert.equal(custoEmDolares({ entrada: 1_000_000, saida: 1_000_000 }), 0.6);
});

// ---------------------------------------------------------------------------
// Coleta

test('buscarPagina: texto da página, ou erro claro sem lançar', async () => {
  const resp = (corpo, status = 200, tipo = 'text/html') => async () => new Response(corpo, { status, headers: { 'content-type': tipo } });
  assert.deepEqual(await buscarPagina('https://x', resp('<p>Oi</p>')), { texto: 'Oi' });
  assert.deepEqual(await buscarPagina('https://x', resp(' só texto ', 200, 'text/plain')), { texto: 'só texto' });
  assert.match((await buscarPagina('https://x', resp('', 403))).erro, /403/);
  assert.match((await buscarPagina('https://x', resp('%PDF', 200, 'application/pdf'))).erro, /não suportado/);
  assert.match((await buscarPagina('https://x', resp('<script>app()</script>'))).erro, /sem texto/);
  assert.match((await buscarPagina('https://x', resp('a'.repeat(5 * 1024 * 1024 + 1)))).erro, /5 MB/);
  assert.match((await buscarPagina('https://x', async () => { throw new Error('rede fora'); })).erro, /rede fora/);
  const lento = async () => { const e = new Error('x'); e.name = 'TimeoutError'; throw e; };
  assert.match((await buscarPagina('https://x', lento)).erro, /tempo esgotado/);
  const semTipo = async () => new Response('x', { status: 200, headers: { 'content-type': '' } });
  assert.match((await buscarPagina('https://x', semTipo)).erro, /sem tipo/);
});

test('--data: padrão é hoje em Brasília e data inválida é recusada', () => {
  assert.equal(lerDataArgv(['node', 'x', '--data', '2026-11-29']), '2026-11-29');
  assert.match(lerDataArgv(['node', 'x']), /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => lerDataArgv(['node', 'x', '--data', '29/11/2026']), /data inválida/);
});

// ---------------------------------------------------------------------------
// Comparação

const oferta = (id, extra = {}) => ({
  id, loja_id: 'magalu', programa_id: 'azul-fidelidade',
  regras: [{ condicao: {}, pontos_por_real: 5 }], escopo: 'vendido_e_entregue_pela_loja',
  acumula_com_cartao: 'A_CONFIRMAR', exige_cupom: false, inicio: '2026-11-01', fim: '2026-12-31',
  credito_prazo_dias: 30, link_oferta: 'A_CONFIRMAR', fonte_url: 'https://www.voeazul.com.br/x', verificado_em: '2026-11-15', ...extra,
});

test('comparar: nova, alterada, igual, encerrada, não verificada e suspeita', () => {
  const atuais = [
    oferta('igual'),
    oferta('vai-mudar', { loja_id: 'amazon', observacoes: 'nota humana' }),
    oferta('sumiu', { loja_id: 'kabum' }),
    oferta('acabou', { loja_id: 'nike', fim: '2026-11-10' }),
    oferta('outra', { loja_id: 'shopee', fim: 'A_CONFIRMAR' }),
  ];
  const propostas = [
    oferta('igual', { verificado_em: '2026-11-22' }),
    oferta('vai-mudar-2026-11', { loja_id: 'amazon', regras: [{ condicao: {}, pontos_por_real: 16 }], verificado_em: '2026-11-22', observacoes: 'auto' }),
    oferta('nova', { programa_id: 'livelo', loja_id: 'nike', regras: [{ condicao: {}, pontos_por_real: 0 }], inicio: '2026-12-01' }),
    oferta('velha', { programa_id: 'smiles', fim: '2026-11-01' }),
  ];
  const cobertos = new Set(['azul-fidelidade|magalu', 'azul-fidelidade|amazon', 'azul-fidelidade|kabum', 'livelo|nike', 'smiles|magalu']);
  const r = compararOfertas({ atuais, propostas, cobertos, hoje: '2026-11-22' });

  assert.deepEqual(r.novas.map((o) => o.id), ['nova']);
  assert.deepEqual(r.iguais.map((x) => x.antes.id), ['igual']);
  assert.equal(r.iguais[0].depois.verificado_em, '2026-11-22');
  assert.equal(r.alteradas.length, 1);
  const alt = r.alteradas[0];
  assert.equal(alt.depois.id, 'vai-mudar');
  assert.equal(alt.depois.observacoes, 'nota humana');
  assert.deepEqual(alt.mudancas.map((m) => m.campo), ['regras']);
  assert.deepEqual(r.encerradas.map((e) => [e.oferta.id, e.motivo]), [
    ['sumiu', 'não aparece mais na página oficial lida nesta semana'],
    ['acabou', 'terminou em 10/11/2026'],
  ]);
  assert.deepEqual(r.naoVerificadas.map((o) => o.id), ['outra']);
  assert.deepEqual(r.ignoradas.map((x) => x.motivo), ['já terminou (fim em 01/11/2026)']);
  assert.deepEqual(r.final.map((o) => o.id), ['igual', 'vai-mudar', 'outra', 'nova']);

  const suspeitas = r.suspeitas.map((s) => `${s.id}: ${s.motivo}`).join('\n');
  assert.match(suspeitas, /vai-mudar: 16 pontos por real é mais de 3 vezes o normal \(5, mediana do programa\)/);
  assert.match(suspeitas, /pontos por real subiu de 5 para 16/);
  assert.match(suspeitas, /nova: faixa com 0 ponto por real/);
  assert.match(suspeitas, /nova: começa no futuro \(01\/12\/2026\)/);
});

test('comparar: valor injetado na página (100 pontos) aparece como suspeita', () => {
  const r = compararOfertas({
    atuais: [oferta('a', { regras: [{ condicao: {}, pontos_por_real: 10 }] })],
    propostas: [oferta('b', { loja_id: 'amazon', regras: [{ condicao: {}, pontos_por_real: 100 }] })],
    cobertos: new Set(),
    hoje: '2026-11-22',
  });
  assert.equal(r.suspeitas.length, 1);
  assert.match(r.suspeitas[0].motivo, /100 pontos por real/);
});

test('comparar: oferta antiga que terminou não é "alterada": a campanha nova entra como nova', () => {
  const r = compararOfertas({
    atuais: [oferta('x', { fim: '2026-11-12' })],
    propostas: [oferta('x', { inicio: '2026-11-20', fim: '2026-11-30' })],
    cobertos: new Set([chave(oferta('x'))]),
    hoje: '2026-11-22',
  });
  assert.equal(r.novas.length, 1);
  assert.equal(r.encerradas.length, 1);
  assert.equal(r.alteradas.length, 0);
});

test('pontosNormais, diferencas e código de aprovação', () => {
  assert.equal(pontosNormais([], 'x'), null);
  assert.deepEqual(pontosNormais([oferta('a'), oferta('b', { regras: [{ condicao: {}, pontos_por_real: 9 }] })], 'azul-fidelidade'), { valor: 7, base: 'do programa' });
  assert.equal(pontosNormais([oferta('a')], 'livelo').valor, 5);
  assert.deepEqual(diferencas(oferta('a'), oferta('b', { verificado_em: '2030-01-01', cupom: 'X' })), [{ campo: 'cupom', antes: undefined, depois: 'X' }]);
  const c1 = codigoDeAprovacao([oferta('a')], 'abc');
  assert.match(c1, /^[0-9a-f]{10}$/);
  assert.notEqual(c1, codigoDeAprovacao([oferta('a')], 'abd'));
  assert.notEqual(c1, codigoDeAprovacao([oferta('a', { fim: '2026-12-30' })], 'abc'));
});

// ---------------------------------------------------------------------------
// Relatório

test('relatório: em português, com trechos só na versão local', () => {
  const r = compararOfertas({
    atuais: [oferta('a', { loja_id: 'amazon' })],
    propostas: [
      oferta('a2', { loja_id: 'amazon', regras: [{ condicao: { clube_ativo: true, cartao_id: 'azul-itau-infinite' }, pontos_por_real: 2.5 }], cupom: 'X', exige_cupom: true }),
      oferta('n', { escopo: 'categorias_selecionadas', categorias_incluidas: ['Games'], status: 'A_CONFIRMAR' }),
    ],
    cobertos: new Set(),
    hoje: '2026-11-22',
  });
  const args = {
    data: '2026-11-22', comparacao: r, dados: cadastro,
    evidencias: { n: [{ campo: 'pontos_por_real', valor: 5, trecho: 'ganhe 5 pontos' }], a2: [{ campo: 'cupom', valor: 'X', trecho: 'cupom X' }] },
    problemas: [{ onde: 'f, oferta 1', campo: 'fim', valor: '30/11', motivo: 'data sem ano' }, { onde: 'f, oferta 1', campo: 'escopo', valor: '', motivo: 'sem escopo' }],
    fontes: [{ id: 'f', url: 'https://x' }, { id: 'g', url: 'https://y', erro: 'a página respondeu 403' }],
    codigo: 'abc1234567',
    aviso: 'teste',
  };
  const local = montarRelatorio(args);
  const pr = montarRelatorio({ ...args, comTrechos: false });
  assert.match(local, /# Proposta de atualização de ofertas: 22\/11\/2026/);
  assert.match(local, /> teste/);
  assert.match(local, /Páginas lidas: 1 de 2/);
  assert.match(local, /## Ofertas novas[\s\S]*Azul Fidelidade × Magalu/);
  assert.match(local, /Escopo: só categorias selecionadas \(Games\)/);
  assert.match(local, /Status: A_CONFIRMAR/);
  assert.match(local, /\| regras \| sem exigência: 5 ponto\(s\) por real \| com clube e com Azul Itaú Infinite: 2,5 ponto\(s\) por real \|/);
  assert.match(local, /\| cupom \| \(sem o campo\) \| X \|/);
  assert.match(local, /\| exige_cupom \| não \| sim \|/);
  assert.match(local, /"ganhe 5 pontos"/);
  assert.match(local, /fim = "30\/11": data sem ano/);
  assert.match(local, /escopo: sem escopo/);
  assert.match(local, /g \(https:\/\/y\): a página respondeu 403/);
  assert.match(local, /aprovar-mudancas\.js --data 2026-11-22 --codigo abc1234567/);
  assert.doesNotMatch(pr, /ganhe 5 pontos|cupom X"/);
  assert.equal(dataBr('2026-01-02'), '02/01/2026');
  assert.equal(dataBr('A_CONFIRMAR'), 'A_CONFIRMAR');
});

// ---------------------------------------------------------------------------
// Ponta a ponta (demonstração) e aprovação

const demo = await rodarDemo();

test('demonstração: página fictícia → relatório, sem tocar em dados/ antes da aprovação', () => {
  assert.equal(demo.coleta.fontes.filter((f) => !f.erro).length, 2);
  assert.equal(demo.ofertasMudaramAntesDaAprovacao, false);
  const c = demo.comparacao;
  assert.deepEqual(c.novas.map((o) => o.id), ['azul-fidelidade-magalu-2026-11', 'livelo-amazon-2026-11']);
  assert.equal(c.encerradas.length, 1);
  assert.match(c.suspeitas[0].motivo, /60 pontos por real/);
  const azul = c.novas[0];
  assert.deepEqual(azul.regras.map((r) => r.pontos_por_real), [14, 12, 8, 6]);
  assert.equal(azul.credito_prazo_dias, 'A_CONFIRMAR'); // modelo disse 45; a página diz 30
  assert.equal(azul.exige_cupom, 'A_CONFIRMAR'); // trecho inventado
  assert.equal(c.novas[1].status, 'A_CONFIRMAR');
  assert.equal(c.novas[1].fim, 'A_CONFIRMAR'); // "até 30/11" sem ano
  assert.deepEqual(demo.proposta.erros_de_validacao, []);
  assert.match(demo.relatorio, /DEMONSTRAÇÃO/);
  assert.equal(demo.extracao.uso.entrada, 2170);
});

test('aprovação: código errado não grava nem roda comando; código certo grava e abre o PR', () => {
  assert.match(demo.recusa, /código não confere/);
  assert.equal(demo.comandosAntesDaAprovacao, 0);
  assert.deepEqual(demo.ofertasAprovadas, demo.proposta.ofertas);
  assert.deepEqual(demo.comandos.map((c) => c.split(' ').slice(0, 3).join(' ')), [
    'git status --porcelain', 'git rev-parse --abbrev-ref', 'git switch -c', 'git add dados/ofertas.json',
    'git commit -m', 'git push -u', 'gh pr create',
  ]);
  assert.ok(demo.mensagens.some((m) => /Pull request aberto/.test(m)));
});

test('aprovação: recusa proposta editada, ofertas.json mudado, Git sujo e branch errada', async () => {
  const raiz = new URL(`file://${demo.tmp}/`);
  const arquivoProposta = join(demo.tmp, 'coleta', DATA, 'proposta.json');
  const arquivoOfertas = join(demo.tmp, 'dados', 'ofertas.json');
  const original = await readFile(arquivoProposta, 'utf8');
  const nada = () => '';
  const codigo = demo.proposta.codigo;

  // Depois da aprovação da demonstração, ofertas.json já mudou: a base não confere.
  await assert.rejects(aprovar({ raiz, data: DATA, codigo, executar: nada, log: () => {} }), /mudou depois do relatório/);

  const editada = JSON.parse(original);
  editada.ofertas[0].regras[0].pontos_por_real = 99;
  await writeFile(arquivoProposta, JSON.stringify(editada));
  await assert.rejects(aprovar({ raiz, data: DATA, codigo, executar: nada, log: () => {} }), /foi alterado depois do relatório/);

  const comErro = { ...JSON.parse(original), erros_de_validacao: ['x'] };
  await writeFile(arquivoProposta, JSON.stringify(comErro));
  await assert.rejects(aprovar({ raiz, data: DATA, codigo, executar: nada, log: () => {} }), /erro de validação/);

  // Volta ofertas.json para a base e testa o Git.
  await writeFile(arquivoProposta, original);
  const base = await readFile(new URL('testes/exemplos/ofertas-exemplo.json', RAIZ), 'utf8');
  await writeFile(arquivoOfertas, base);
  await assert.rejects(aprovar({ raiz, data: DATA, codigo, executar: (c, a) => (a[0] === 'status' ? ' M x' : ''), log: () => {} }), /mudanças não salvas/);
  await assert.rejects(aprovar({ raiz, data: DATA, codigo, executar: (c, a) => (a[0] === 'rev-parse' ? 'outra' : ''), log: () => {} }), /branch "outra"/);

  // --so-gravar: grava e não roda nenhum comando.
  const comandos = [];
  await aprovar({ raiz, data: DATA, codigo, soGravar: true, executar: (c, a) => { comandos.push(c); return ''; }, log: () => {} });
  assert.deepEqual(comandos, []);
  assert.deepEqual(JSON.parse(await readFile(arquivoOfertas, 'utf8')), demo.proposta.ofertas);

  // Sem gh: mostra o link para abrir o PR à mão.
  await writeFile(arquivoOfertas, base);
  const mensagens = [];
  const semGh = (c, a) => {
    if (c === 'gh') throw new Error('gh: comando não encontrado');
    if (a[0] === 'rev-parse') return 'main';
    if (a[0] === 'remote') return 'git@github.com:dono/milhas.git';
    return '';
  };
  const r = await aprovar({ raiz, data: DATA, codigo, executar: semGh, log: (m) => mensagens.push(m) });
  assert.equal(r.pr, null);
  assert.ok(mensagens.some((m) => m.includes('https://github.com/dono/milhas/compare/main...ofertas%2F2026-11-22?expand=1')));
});

test('aprovação: se a gravação não passar na validação, desfaz a branch e não envia', async () => {
  const raiz = new URL(`file://${demo.tmp}/`);
  const arquivoProposta = join(demo.tmp, 'coleta', DATA, 'proposta.json');
  const arquivoOfertas = join(demo.tmp, 'dados', 'ofertas.json');
  const base = await readFile(new URL('testes/exemplos/ofertas-exemplo.json', RAIZ), 'utf8');
  await writeFile(arquivoOfertas, base);
  const p = JSON.parse(await readFile(arquivoProposta, 'utf8'));
  p.ofertas[0].loja_id = 'loja-que-nao-existe';
  p.codigo = codigoDeAprovacao(p.ofertas, p.base_sha256);
  await writeFile(arquivoProposta, JSON.stringify(p));
  const comandos = [];
  const executar = (c, a) => { comandos.push(`${c} ${a.join(' ')}`); return a[0] === 'rev-parse' ? 'main' : ''; };
  await assert.rejects(aprovar({ raiz, data: DATA, codigo: p.codigo, executar, log: () => {} }), /não passaram na validação/);
  assert.ok(comandos.includes('git branch -D ofertas/2026-11-22'));
  assert.ok(!comandos.some((c) => c.startsWith('git push')));
  await writeFile(arquivoOfertas, base); // o "git checkout" acima foi simulado
  await assert.rejects(aprovar({ raiz, data: DATA, codigo: p.codigo, soGravar: true, executar, log: () => {} }), /não passaram na validação/);
});

test('linkParaComparar entende https e ssh', () => {
  assert.equal(linkParaComparar('https://github.com/a/b.git', 'ofertas/x'), 'https://github.com/a/b/compare/main...ofertas%2Fx?expand=1');
  assert.equal(linkParaComparar('https://gitlab.com/a/b', 'x'), null);
});

test('extrair: página que falhou na coleta e resposta ruim do modelo viram erro da fonte', async () => {
  const { extrair } = await import('../scripts/extrair.js');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const pasta = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'extrair-'))}/`);
  await writeFile(new URL('coleta.json', pasta), JSON.stringify({
    data: '2026-11-22',
    fontes: [
      { ...fonte({ id: 'caiu' }), erro: 'a página respondeu 403' },
      { ...fonte({ id: 'ruim' }), arquivo: 'ruim.txt' },
      { ...fonte({ id: 'sem-uso' }), arquivo: 'ruim.txt' },
    ],
  }));
  await writeFile(new URL('ruim.txt', pasta), 'texto');
  const obterResposta = async (f) => {
    if (f.id === 'ruim') throw new Error('o modelo não devolveu JSON válido');
    return { resposta: { ofertas: [] }, bruta: {} };
  };
  const saida = await extrair({ pasta, cartoes: cadastro.cartoes, obterResposta });
  assert.equal(saida.fontes[0].erro, 'a página respondeu 403');
  assert.equal(saida.fontes[1].erro, 'extração falhou: o modelo não devolveu JSON válido');
  assert.deepEqual(saida.fontes[2].ofertas, []);
  assert.deepEqual(saida.uso, { entrada: 0, saida: 0 });
});

test('relatório: lista as encontradas e não propostas, as sem mudança e as não verificadas', () => {
  const r = compararOfertas({
    atuais: [oferta('igual'), oferta('longe', { loja_id: 'nike' })],
    propostas: [oferta('igual'), oferta('velha', { loja_id: 'amazon', fim: '2026-11-01' })],
    cobertos: new Set(),
    hoje: '2026-11-22',
  });
  const texto = montarRelatorio({ data: '2026-11-22', comparacao: r, dados: cadastro, evidencias: {}, problemas: [], fontes: [], codigo: 'c' });
  assert.match(texto, /## Encontradas na página, mas não propostas\n\n- Azul Fidelidade × Amazon \(`velha`\): já terminou/);
  assert.match(texto, /`igual`\): confirmada de novo/);
  assert.match(texto, /`longe`\): nenhuma página desta oferta foi lida/);
  assert.doesNotMatch(texto, /## Suspeitas/);
});
