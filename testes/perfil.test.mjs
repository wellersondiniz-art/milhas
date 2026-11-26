// Perfil "Meu perfil": formato, versão, migração, armazenamento e importação.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  APP, MILHEIRO_MAXIMO, TAMANHO_MAXIMO, VERSAO_ATUAL, dataValida, ehVazio, limparPerfil, migrar, nomeDoArquivo,
  perfilDeTodos, perfilParaConta, perfilVazio, semNadaParaGuardar, textoParaExportar, trecho, validarImportacao,
} from '../site/js/perfil/formato.js';
import { CHAVE, CHAVE_V1, abrirArmazem } from '../site/js/perfil/armazem.js';
import { calcularJeitosDeComprar } from '../site/js/motor/index.js';

const FONTE = 'https://exemplo.invalid/teste';
const DADOS = {
  programas: [
    { id: 'prog-a', nome: 'Programa A', tipo: 'milhas', valor_milheiro_brl: 2000, url: FONTE, fonte_url: FONTE, verificado_em: '2026-11-01' },
    { id: 'prog-b', nome: 'Programa B', tipo: 'pontos', valor_milheiro_brl: 'A_CONFIRMAR', url: FONTE, fonte_url: FONTE, verificado_em: '2026-11-01' },
  ],
  cartoes: [
    { id: 'cartao-a', nome: 'Cartão A', emissor: 'X', bandeira: 'Y', programa_id: 'prog-a', pontos_por_real: 2, anuidade_brl: 0, observacoes: '', fonte_url: FONTE, verificado_em: '2026-11-01', status: 'confirmado' },
    { id: 'cartao-b', nome: 'Cartão B', emissor: 'X', bandeira: 'Y', programa_id: 'prog-b', pontos_por_real: 1, anuidade_brl: 0, observacoes: '', fonte_url: FONTE, verificado_em: '2026-11-01', status: 'confirmado' },
  ],
  lojas: [
    { id: 'loja-a', nome: 'Loja A', dominio: 'A_CONFIRMAR', categoria: 'A_CONFIRMAR', aceita_cupom: 'A_CONFIRMAR', observacoes: '', fonte_url: FONTE, verificado_em: '2026-11-01' },
  ],
  ofertas: [
    {
      id: 'oferta-a', loja_id: 'loja-a', programa_id: 'prog-b',
      regras: [{ condicao: { clube_ativo: true }, pontos_por_real: 10 }, { condicao: {}, pontos_por_real: 5 }],
      escopo: 'todos_os_produtos', acumula_com_cartao: true, clube_ativo_ha_horas: 24, exige_cupom: false,
      inicio: '2026-11-01', fim: '2026-11-30', credito_prazo_dias: 30, link_oferta: FONTE, fonte_url: FONTE, verificado_em: '2026-11-09',
    },
  ],
};
const HOJE = '2026-11-22';

const PERFIL_CHEIO = {
  versao: 2,
  programas: [
    { programa_id: 'prog-a', clube_ativo: false },
    { programa_id: 'prog-b', clube_ativo: true, clube_ativo_desde: '2026-11-01' },
  ],
  cartoes: ['cartao-a', 'cartao-b'],
  valor_milheiro_brl: { 'prog-a': 2150, 'prog-b': 1800 },
};

const arquivo = (extra = {}) => JSON.stringify({ app: APP, versao: VERSAO_ATUAL, exportado_em: '2026-11-22T12:00:00.000Z', ...PERFIL_CHEIO, ...extra });

function armazenamentoFalso() {
  const mapa = new Map();
  return {
    getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
    setItem: (k, v) => { mapa.set(k, String(v)); },
    removeItem: (k) => { mapa.delete(k); },
    mapa,
  };
}

// ---------------------------------------------------------------------------
// Formato e versão

test('perfil vazio tem versão e listas vazias', () => {
  assert.deepEqual(perfilVazio(), { versao: VERSAO_ATUAL, programas: [], cartoes: [], valor_milheiro_brl: {} });
  assert.equal(ehVazio(perfilVazio()), true);
  assert.equal(ehVazio(null), true);
  assert.equal(ehVazio(PERFIL_CHEIO), false);
  assert.equal(ehVazio({ ...perfilVazio(), cartoes: ['cartao-a'] }), false);
});

test('data válida: formato e calendário de verdade', () => {
  assert.equal(dataValida('2026-02-28'), true);
  assert.equal(dataValida('2024-02-29'), true);
  assert.equal(dataValida('2026-02-29'), false);
  assert.equal(dataValida('2026-13-01'), false);
  assert.equal(dataValida('22/11/2026'), false);
  assert.equal(dataValida(20261122), false);
});

test('migrar: versão 1 (sem campo versao) vira versão 2', () => {
  const v1 = { programas: [{ programa_id: 'prog-a', clube_ativo: false }], cartoes: ['cartao-a'], valor_milheiro_brl: { 'prog-a': 2000 } };
  assert.deepEqual(migrar(v1), { versao: 2, ...v1 });
  assert.deepEqual(migrar({ programas: [], cartoes: [] }).valor_milheiro_brl, {});
});

test('migrar: versão desconhecida, mais nova ou lixo dá null', () => {
  assert.equal(migrar({ versao: VERSAO_ATUAL + 1, programas: [], cartoes: [] }), null);
  assert.equal(migrar({ versao: 0, programas: [], cartoes: [] }), null);
  assert.equal(migrar({ versao: '2', programas: [], cartoes: [] }), null);
  assert.equal(migrar([]), null);
  assert.equal(migrar(null), null);
  assert.equal(migrar({ versao: 2, programas: 'x', cartoes: [] }), null);
});

test('limpar perfil do aparelho: tira o que sumiu do cadastro sem reclamar', () => {
  const bruto = {
    versao: 2,
    programas: [
      { programa_id: 'prog-a', clube_ativo: true, clube_ativo_desde: '2026-11-01', extra: 'x' },
      { programa_id: 'prog-a', clube_ativo: false },
      { programa_id: 'sumiu', clube_ativo: true },
      { programa_id: 'prog-b', clube_ativo: 'sim', clube_ativo_desde: 'ontem' },
      null,
    ],
    cartoes: ['cartao-b', 'cartao-b', 'outro'],
    valor_milheiro_brl: { 'prog-a': 2000, 'prog-b': 12.5, sumiu: 100 },
    cpf: 'nunca guardamos isso',
  };
  assert.deepEqual(limparPerfil(bruto, DADOS), {
    versao: 2,
    programas: [
      { programa_id: 'prog-a', clube_ativo: true, clube_ativo_desde: '2026-11-01' },
      { programa_id: 'prog-b', clube_ativo: false },
    ],
    cartoes: ['cartao-b'],
    valor_milheiro_brl: { 'prog-a': 2000 },
  });
});

test('perfil para a conta: o motor recebe sem o campo versao e calcula', () => {
  const conta = perfilParaConta(PERFIL_CHEIO);
  assert.equal('versao' in conta, false);
  const jeitos = calcularJeitosDeComprar(conta, { loja_id: 'loja-a', valor_centavos: 10000, tipo_vendedor: 'loja' }, DADOS, `${HOJE}T12:00`);
  assert.ok(jeitos.length > 0);
});

// ---------------------------------------------------------------------------
// Perfil vazio e perfil cheio na conta

test('perfil vazio: a conta usa todos os programas e cartões (melhores opções gerais)', () => {
  const todos = perfilDeTodos(DADOS);
  assert.deepEqual(todos.programas.map((p) => p.programa_id), ['prog-a', 'prog-b']);
  assert.ok(todos.programas.every((p) => p.clube_ativo === false));
  assert.deepEqual(todos.cartoes, ['cartao-a', 'cartao-b']);
  const jeitos = calcularJeitosDeComprar(todos, { loja_id: 'loja-a', valor_centavos: 10000, tipo_vendedor: 'loja' }, DADOS, `${HOJE}T12:00`);
  assert.ok(jeitos.some((j) => j.tipo === 'oferta'), 'a oferta do programa B entra mesmo sem o usuário ter escolhido nada');
  assert.ok(jeitos[0].total_pontos > 0);
});

test('perfil cheio: clube com data antiga e milheiro do perfil entram na conta', () => {
  const [melhor] = calcularJeitosDeComprar(perfilParaConta(PERFIL_CHEIO), { loja_id: 'loja-a', valor_centavos: 10000, tipo_vendedor: 'loja' }, DADOS, `${HOJE}T12:00`);
  assert.equal(melhor.programa.id, 'prog-b');
  // 10 pontos/real com clube (R$ 100) = 1.000, mais o que o cartão der.
  assert.ok(melhor.total_pontos >= 1000);
  assert.ok(melhor.valor_estimado_em_reais, 'milheiro do perfil (R$ 18,00) dá valor em reais mesmo com A_CONFIRMAR no cadastro');
});

// ---------------------------------------------------------------------------
// Armazenamento

test('armazém: salva com versão, lê de volta e apaga', () => {
  const a = armazenamentoFalso();
  const armazem = abrirArmazem(a);
  assert.equal(armazem.emMemoria, false);
  assert.equal(armazem.ler(DADOS), null);
  assert.equal(armazem.salvar(PERFIL_CHEIO), true);
  assert.equal(JSON.parse(a.mapa.get(CHAVE)).versao, VERSAO_ATUAL);
  assert.deepEqual(armazem.ler(DADOS), PERFIL_CHEIO);
  armazem.apagar();
  assert.equal(a.mapa.has(CHAVE), false);
  assert.equal(armazem.ler(DADOS), null);
});

test('armazém: temAlgo diz se há perfil guardado (chave nova ou da versão 1), sem ler', () => {
  const a = armazenamentoFalso();
  const armazem = abrirArmazem(a);
  assert.equal(armazem.temAlgo(), false);
  armazem.salvar(PERFIL_CHEIO);
  assert.equal(armazem.temAlgo(), true);
  armazem.apagar();
  assert.equal(armazem.temAlgo(), false);
  a.setItem(CHAVE_V1, '{}');
  assert.equal(armazem.temAlgo(), true);
});

test('armazém: migra o perfil da versão 1 para a chave nova e tira a velha', () => {
  const a = armazenamentoFalso();
  a.setItem(CHAVE_V1, JSON.stringify({ programas: [{ programa_id: 'prog-a', clube_ativo: false }], cartoes: ['cartao-a'], valor_milheiro_brl: {} }));
  const perfil = abrirArmazem(a).ler(DADOS);
  assert.deepEqual(perfil, { versao: 2, programas: [{ programa_id: 'prog-a', clube_ativo: false }], cartoes: ['cartao-a'], valor_milheiro_brl: {} });
  assert.equal(a.mapa.has(CHAVE_V1), false);
  assert.deepEqual(JSON.parse(a.mapa.get(CHAVE)), perfil);
});

test('armazém: JSON quebrado ou de versão futura no aparelho vira perfil vazio, sem erro', () => {
  const a = armazenamentoFalso();
  a.setItem(CHAVE, '{nao é json');
  assert.equal(abrirArmazem(a).ler(DADOS), null);
  a.setItem(CHAVE, JSON.stringify({ versao: 99, programas: [], cartoes: [] }));
  assert.equal(abrirArmazem(a).ler(DADOS), null);
});

test('armazém: sem localStorage (modo privado) funciona em memória e avisa', () => {
  const bloqueado = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  for (const armazenamento of [bloqueado, undefined, null]) {
    const armazem = abrirArmazem(armazenamento);
    assert.equal(armazem.emMemoria, true);
    assert.equal(armazem.salvar(PERFIL_CHEIO), false, 'salvar diz que não foi para o aparelho');
    assert.deepEqual(armazem.ler(DADOS), PERFIL_CHEIO, 'mas o perfil vale enquanto a aba estiver aberta');
    armazem.apagar();
    assert.equal(armazem.ler(DADOS), null);
  }
});

test('armazém: se o aparelho para de aceitar no meio do caminho, passa para a memória', () => {
  const a = armazenamentoFalso();
  const armazem = abrirArmazem(a);
  a.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(armazem.salvar(PERFIL_CHEIO), false);
  assert.equal(armazem.emMemoria, true);
  assert.deepEqual(armazem.ler(DADOS), PERFIL_CHEIO);
});

test('armazém guarda só ids, booleanos, datas e centavos', () => {
  const a = armazenamentoFalso();
  abrirArmazem(a).salvar({ ...PERFIL_CHEIO, cpf: '123', nome: 'Fulano' });
  assert.deepEqual(Object.keys(JSON.parse(a.mapa.get(CHAVE))).sort(), ['cartoes', 'programas', 'valor_milheiro_brl', 'versao']);
});

// ---------------------------------------------------------------------------
// Exportar

test('exportar: arquivo tem app, versão, data e o perfil; importa de volta igual', () => {
  const texto = textoParaExportar(PERFIL_CHEIO, '2026-11-22T12:00:00.000Z');
  const json = JSON.parse(texto);
  assert.equal(json.app, APP);
  assert.equal(json.versao, VERSAO_ATUAL);
  assert.equal(json.exportado_em, '2026-11-22T12:00:00.000Z');
  assert.deepEqual(validarImportacao(texto, DADOS, HOJE), { ok: true, perfil: PERFIL_CHEIO });
  assert.equal(nomeDoArquivo('2026-11-22'), 'meu-perfil-milhas-2026-11-22.json');
});

test('exportar perfil vazio também gera um arquivo válido', () => {
  const r = validarImportacao(textoParaExportar(null, '2026-11-22T12:00:00.000Z'), DADOS, HOJE);
  assert.deepEqual(r, { ok: true, perfil: perfilVazio() });
});

// ---------------------------------------------------------------------------
// Importar: validação rígida

const erros = (texto) => {
  const r = validarImportacao(texto, DADOS, HOJE);
  assert.equal(r.ok, false, 'deveria reprovar');
  assert.equal(r.perfil, undefined, 'nada é importado pela metade');
  return r.erros;
};

test('importar JSON malformado: reprova com mensagem simples', () => {
  for (const texto of ['{', '{"app": "comprador-de-milhas",}', 'não é json', '[1, 2', "{'app': 1}"]) {
    assert.deepEqual(erros(texto), ['O arquivo não é um JSON válido. Use o arquivo que este site gerou em "Exportar perfil".']);
  }
  assert.deepEqual(erros(''), ['O arquivo está vazio.']);
  assert.deepEqual(erros('   \n'), ['O arquivo está vazio.']);
  assert.deepEqual(erros('[]'), ['O arquivo não tem o formato de um perfil.']);
  assert.deepEqual(erros('null'), ['O arquivo não tem o formato de um perfil.']);
  assert.deepEqual(erros('"texto"'), ['O arquivo não tem o formato de um perfil.']);
});

test('importar: arquivo grande demais nem é lido', () => {
  assert.deepEqual(erros(' '.repeat(TAMANHO_MAXIMO) + '{}'), ['O arquivo é grande demais para ser um perfil.']);
});

test('importar: precisa ser do Milhas da Vez e de versão conhecida', () => {
  assert.ok(erros(arquivo({ app: 'outro-site' })).includes('O arquivo não foi gerado pelo site Milhas da Vez.'));
  assert.ok(erros(arquivo({ versao: undefined })).includes('Falta a versão do formato (campo "versao").'));
  assert.ok(erros(arquivo({ versao: 99 })).some((e) => /versão mais nova/.test(e)));
  assert.ok(erros(arquivo({ exportado_em: 'ontem' })).includes('A data de exportação está fora do formato.'));
});

test('importar versão 1 com app e versao 1 migra para a 2', () => {
  const r = validarImportacao(arquivo({ versao: 1 }), DADOS, HOJE);
  assert.equal(r.ok, true);
  assert.equal(r.perfil.versao, 2);
});

test('importar: campo a mais, id desconhecido, repetido, tipo errado, tudo reprova', () => {
  assert.ok(erros(arquivo({ cpf: '000' })).some((e) => e.startsWith('Campo que não conhecemos: "cpf"')));
  assert.ok(erros(arquivo({ cartoes: ['cartao-a', 'cartao-x'] })).includes('Cartão nº 2: não conhecemos o cartão "cartao-x".'));
  assert.ok(erros(arquivo({ cartoes: ['cartao-a', 'cartao-a'] })).includes('O cartão "cartao-a" aparece mais de uma vez.'));
  assert.ok(erros(arquivo({ cartoes: [42] })).includes('Cartão nº 1: não conhecemos o cartão 42.'));
  assert.ok(erros(arquivo({ cartoes: 'cartao-a' })).includes('Falta a lista de cartões.'));
  assert.ok(erros(arquivo({ programas: [{ programa_id: 'prog-a', clube_ativo: 'sim' }], valor_milheiro_brl: {} }))
    .includes('Programa A: "clube_ativo" precisa ser true ou false.'));
  assert.ok(erros(arquivo({ programas: [{ programa_id: 'prog-a', clube_ativo: false, numero: '1234' }], valor_milheiro_brl: {} }))
    .some((e) => /Programa nº 1: campo que não conhecemos: "numero"/.test(e)));
  assert.ok(erros(arquivo({ programas: [{ programa_id: 'prog-a', clube_ativo: false }, { programa_id: 'prog-a', clube_ativo: true }], valor_milheiro_brl: {} }))
    .includes('Programa A aparece mais de uma vez.'));
});

test('importar: datas do clube precisam existir, não ser no futuro e só com clube ativo', () => {
  const com = (p) => arquivo({ programas: [{ programa_id: 'prog-a', ...p }], valor_milheiro_brl: {} });
  assert.ok(erros(com({ clube_ativo: true, clube_ativo_desde: '2026-02-30' })).some((e) => /não é uma data válida/.test(e)));
  assert.ok(erros(com({ clube_ativo: true, clube_ativo_desde: '2026-11-23' })).includes('Programa A: a data do clube está no futuro.'));
  assert.ok(erros(com({ clube_ativo: false, clube_ativo_desde: '2026-11-01' })).includes('Programa A: tem data do clube, mas o clube não está ativo.'));
  assert.equal(validarImportacao(com({ clube_ativo: true, clube_ativo_desde: HOJE }), DADOS, HOJE).ok, true);
});

test('importar: milheiro em centavos inteiros, de programa marcado, até R$ 999,99', () => {
  const com = (m) => arquivo({ valor_milheiro_brl: m });
  assert.ok(erros(com({ 'prog-a': 21.5 })).some((e) => /centavos inteiros/.test(e)));
  assert.ok(erros(com({ 'prog-a': '2000' })).some((e) => /centavos inteiros/.test(e)));
  assert.ok(erros(com({ 'prog-a': 0 })).some((e) => /centavos inteiros/.test(e)));
  assert.ok(erros(com({ 'prog-a': MILHEIRO_MAXIMO + 1 })).some((e) => /centavos inteiros/.test(e)));
  assert.ok(erros(com({ 'prog-x': 2000 })).includes('Milheiro: não conhecemos o programa "prog-x".'));
  assert.ok(erros(com([2000])).includes('O valor do milheiro está fora do formato.'));
  const soA = arquivo({ programas: [{ programa_id: 'prog-a', clube_ativo: false }], valor_milheiro_brl: { 'prog-b': 2000 } });
  assert.ok(erros(soA).includes('Milheiro do Programa B: o programa não está marcado.'));
  assert.equal(validarImportacao(com({ 'prog-a': MILHEIRO_MAXIMO }), DADOS, HOJE).ok, true);
});

test('importar: "__proto__" no arquivo não contamina nada e reprova', () => {
  const texto = '{"app":"comprador-de-milhas","versao":2,"programas":[],"cartoes":[],"__proto__":{"poluido":true},"valor_milheiro_brl":{"__proto__":{"x":1}}}';
  const lista = erros(texto);
  assert.ok(lista.some((e) => /Campo que não conhecemos: "__proto__"/.test(e)));
  assert.equal({}.poluido, undefined);
  assert.equal(Object.prototype.poluido, undefined);
});

test('importar JSON com script dentro: reprova e o script volta só como texto', () => {
  const script = '<script>alert(1)</script>';
  const img = '<img src=x onerror=alert(1)>';
  const texto = JSON.stringify({
    app: APP, versao: 2,
    programas: [{ programa_id: script, clube_ativo: false }],
    cartoes: [img],
    valor_milheiro_brl: {},
  });
  const lista = erros(texto);
  // A mensagem mostra o valor entre aspas, igual ao que estava no arquivo.
  // Na tela ela entra com textContent (el()), então aparece como letras.
  assert.ok(lista.includes(`Programa nº 1: não conhecemos o programa "${script}".`));
  assert.ok(lista.includes(`Cartão nº 1: não conhecemos o cartão "${img}".`));

  // Mesmo dentro de um campo de texto válido (data), não entra.
  const naData = arquivo({ programas: [{ programa_id: 'prog-a', clube_ativo: true, clube_ativo_desde: script }], valor_milheiro_brl: {} });
  assert.ok(erros(naData).some((e) => e.includes('<script>alert(1)</script>') && /não é uma data válida/.test(e)));
});

test('importar: no máximo 10 erros listados, o resto resumido', () => {
  const lista = erros(arquivo({ cartoes: Array.from({ length: 2 }, (_, i) => `x${i}`), programas: Array.from({ length: 2 }, (_, i) => ({ programa_id: `p${i}`, clube_ativo: 1 })), extra1: 1, valor_milheiro_brl: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } }));
  assert.equal(lista.length, 11);
  assert.match(lista[10], /^E mais \d+ problemas\.$/);
});

test('trecho: valores longos são cortados', () => {
  assert.equal(trecho('a'.repeat(100)).length, 40);
  assert.equal(trecho(undefined), 'undefined');
  assert.equal(trecho(42), '42');
});

// ---------------------------------------------------------------------------
// Cotação do dólar (opcional, reais × 10.000)

test('cotação do dólar: entra na conta, sai no arquivo e volta na importação', () => {
  const comDolar = { ...PERFIL_CHEIO, cotacao_dolar: 53456 };
  assert.equal(perfilParaConta(comDolar).cotacao_dolar, 53456);
  assert.equal(migrar(comDolar).cotacao_dolar, 53456);
  const texto = textoParaExportar(comDolar, '2026-11-22T12:00:00.000Z');
  assert.equal(JSON.parse(texto).cotacao_dolar, 53456);
  assert.deepEqual(validarImportacao(texto, DADOS, HOJE), { ok: true, perfil: comDolar });
});

test('cotação do dólar inválida: some do aparelho e reprova na importação', () => {
  for (const ruim of [0, -1, 5.3, '53456', 1_000_000]) {
    assert.equal('cotacao_dolar' in limparPerfil({ ...PERFIL_CHEIO, cotacao_dolar: ruim }, DADOS), false);
    const texto = JSON.stringify({ app: APP, versao: VERSAO_ATUAL, programas: [], cartoes: [], valor_milheiro_brl: {}, cotacao_dolar: ruim });
    assert.ok(erros(texto).some((e) => e.startsWith('Cotação do dólar')));
  }
});

test('perfil só com cotação: não é descartado, e a conta usa todos com essa cotação', () => {
  const soCotacao = { ...perfilVazio(), cotacao_dolar: 50000 };
  assert.equal(ehVazio(soCotacao), true);
  assert.equal(semNadaParaGuardar(soCotacao), false);
  assert.equal(semNadaParaGuardar(perfilVazio()), true);
  const todos = perfilDeTodos(DADOS, soCotacao.cotacao_dolar);
  assert.equal(todos.cotacao_dolar, 50000);
  assert.equal(todos.cartoes.length, DADOS.cartoes.length);
  assert.equal('cotacao_dolar' in perfilDeTodos(DADOS), false);
});

test('vencimento dos pontos: fica no aparelho, sai no arquivo e volta na importação', () => {
  const comData = {
    ...PERFIL_CHEIO,
    programas: [{ programa_id: 'prog-a', clube_ativo: false, pontos_vencem_em: '2027-01-15' }],
  };
  assert.deepEqual(limparPerfil(comData, DADOS).programas, [{ programa_id: 'prog-a', clube_ativo: false, pontos_vencem_em: '2027-01-15' }]);
  const r = validarImportacao(textoParaExportar(limparPerfil(comData, DADOS), '2026-11-22T10:00:00.000Z'), DADOS, HOJE);
  assert.equal(r.ok, true);
  assert.equal(r.perfil.programas[0].pontos_vencem_em, '2027-01-15');
});

test('vencimento dos pontos: data quebrada some do aparelho e reprova na importação', () => {
  const quebrado = { ...PERFIL_CHEIO, programas: [{ programa_id: 'prog-a', clube_ativo: false, pontos_vencem_em: '2027-02-30' }] };
  assert.equal(limparPerfil(quebrado, DADOS).programas[0].pontos_vencem_em, undefined);
  const texto = JSON.stringify({ app: APP, versao: 2, programas: quebrado.programas, cartoes: [] });
  const r = validarImportacao(texto, DADOS, HOJE);
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /Programa A: a data de vencimento dos pontos "2027-02-30" não é uma data válida/);
});
