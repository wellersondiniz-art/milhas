import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ARQUIVOS, dataValida, linkNoDominio, validarDados, validarSchema } from '../scripts/validar-dados.js';

const DADOS = new URL('../dados/', import.meta.url);
const HOJE = '2026-11-26';

async function lerReais() {
  const dados = {};
  for (const nome of ARQUIVOS) {
    dados[nome] = JSON.parse(await readFile(new URL(`${nome}.json`, DADOS), 'utf8'));
  }
  // A oferta de exemplo saiu da base de produção; os testes que mexem numa
  // oferta usam a cópia de testes/exemplos/ como registro 0.
  const exemplo = JSON.parse(await readFile(new URL('../testes/exemplos/ofertas-exemplo.json', import.meta.url), 'utf8'));
  dados.ofertas = [...exemplo, ...dados.ofertas];
  return dados;
}

/** Copia os schemas para uma pasta temporária, grava os dados alterados e valida. */
async function validarCom(alterar) {
  const pasta = await mkdtemp(join(tmpdir(), 'dados-'));
  await cp(new URL('schemas/', DADOS), join(pasta, 'schemas'), { recursive: true });
  const dados = await lerReais();
  alterar(dados);
  for (const [nome, registros] of Object.entries(dados)) {
    await writeFile(join(pasta, `${nome}.json`), JSON.stringify(registros));
  }
  return validarDados(pathToFileURL(pasta + '/'), { hoje: HOJE });
}

test('os dados do repositório são válidos', async () => {
  const { erros } = await validarDados(DADOS, { hoje: HOJE });
  assert.deepEqual(erros, []);
});

test('avisa que a oferta de exemplo já terminou', async () => {
  const { avisos } = await validarCom(() => {});
  assert.ok(avisos.some((a) => a.includes('já terminou')));
  // A frase diz o que o motor faz de verdade com cada campo A_CONFIRMAR.
  assert.ok(avisos.some((a) => a.endsWith('inicio está "A_CONFIRMAR"; a oferta entra na conta, com um aviso na tela')));
  assert.ok(avisos.some((a) => a.endsWith('acumula_com_cartao está "A_CONFIRMAR"; a conta não soma oferta e cartão (vale o maior)')));
});

test('a base de produção não tem oferta marcada como exemplo de teste', async () => {
  const ofertas = JSON.parse(await readFile(new URL('ofertas.json', DADOS), 'utf8'));
  assert.ok(!ofertas.some((o) => /exemplo|teste/i.test(o.observacoes ?? '')));
});

test('avisa quando uma campanha já terminou', async () => {
  const { avisos } = await validarDados(DADOS, { hoje: '2026-11-27' });
  assert.ok(avisos.some((a) => a.includes('"livelo-magalu-2026-11-24": já terminou')));
});

test('regra padrão: sem data de fim e sem aviso de início/fim A_CONFIRMAR', async () => {
  const { avisos } = await validarDados(DADOS, { hoje: HOJE });
  assert.ok(!avisos.some((a) => a.includes('"livelo-casas-bahia-padrao": inicio')));
  assert.ok(!avisos.some((a) => a.includes('"livelo-casas-bahia-padrao": fim')));
  const { erros } = await validarCom((d) => {
    const o = d.ofertas.find((x) => x.id === 'livelo-casas-bahia-padrao');
    o.fim = '2026-12-31';
  });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /livelo-casas-bahia-padrao.*campo fim: regra padrão não tem data de fim/);
});

test('sem_parceria: programa precisa existir, data não pode ser futura e não pode ter regra padrão junto', async () => {
  const { erros } = await validarCom((d) => {
    const amazon = d.lojas.find((l) => l.id === 'amazon');
    amazon.sem_parceria[0].programa_id = 'programa-que-nao-existe';
    amazon.sem_parceria[1].verificado_em = '2026-12-01';
    const cb = d.ofertas.find((x) => x.id === 'livelo-casas-bahia-padrao');
    d.lojas.find((l) => l.id === 'casas-bahia').sem_parceria.push({ ...d.lojas.find((l) => l.id === 'casas-bahia').sem_parceria[0], programa_id: cb.programa_id });
  });
  assert.ok(erros.some((e) => e.includes('sem_parceria[0].programa_id') && e.includes('não existe em programas.json')));
  assert.ok(erros.some((e) => e.includes('sem_parceria[1].verificado_em: data no futuro')));
  assert.ok(erros.some((e) => e.includes('livelo-casas-bahia-padrao') && e.includes('sem_parceria')));
});

test('dataValida aceita só datas que existem', () => {
  assert.equal(dataValida('2026-11-12'), true);
  assert.equal(dataValida('2028-02-29'), true);
  assert.equal(dataValida('2026-02-29'), false);
  assert.equal(dataValida('2026-13-01'), false);
  assert.equal(dataValida('12/11/2026'), false);
});

test('mensagem aponta arquivo, registro e campo', async () => {
  const { erros } = await validarCom((d) => { d.ofertas[0].regras[0].pontos_por_real = -1; });
  assert.deepEqual(erros, [
    'ofertas.json › registro 0 (id "azul-fidelidade-magalu-2026-11") › campo regras[0].pontos_por_real: deve ser maior ou igual a 0 (recebido: -1)',
  ]);
});

test('reprova data que não existe', async () => {
  const { erros } = await validarCom((d) => { d.ofertas[0].fim = '2026-02-30'; });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /campo fim: .*"2026-02-30"/);
});

test('reprova fim antes do início', async () => {
  const { erros } = await validarCom((d) => { d.ofertas[0].inicio = '2026-11-27'; });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /campo fim: fim \(2026-11-12\) é anterior ao início \(2026-11-27\)/);
});

test('reprova id que não existe em outra tabela', async () => {
  const { erros } = await validarCom((d) => {
    d.ofertas[0].loja_id = 'loja-inexistente';
    d.ofertas[0].regras[0].condicao.cartao_id = 'outro-cartao';
    d.cartoes[0].programa_id = 'programa-inexistente';
  });
  assert.equal(erros.length, 3);
  assert.ok(erros.some((e) => e.includes('cartoes.json › registro 0 (id "azul-itau-infinite") › campo programa_id: id "programa-inexistente" não existe em programas.json')));
  assert.ok(erros.some((e) => e.includes('campo loja_id: id "loja-inexistente" não existe em lojas.json')));
  assert.ok(erros.some((e) => e.includes('campo regras[0].condicao.cartao_id: id "outro-cartao" não existe em cartoes.json')));
});

test('reprova pontos negativos no cartão', async () => {
  const { erros } = await validarCom((d) => { d.cartoes[0].pontos_por_real = -2; });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /campo pontos_por_real: .*esperado: número >= 0 ou "A_CONFIRMAR"/);
});

test('reprova registro sem fonte_url e sem verificado_em', async () => {
  const { erros } = await validarCom((d) => {
    delete d.lojas[0].fonte_url;
    delete d.programas[0].verificado_em;
  });
  assert.deepEqual(erros.sort(), [
    'lojas.json › registro 0 (id "magalu") › campo fonte_url: campo obrigatório ausente',
    'programas.json › registro 0 (id "azul-fidelidade") › campo verificado_em: campo obrigatório ausente',
  ]);
});

test('reprova fonte_url sem https', async () => {
  const { erros } = await validarCom((d) => { d.programas[0].fonte_url = 'http://exemplo.com'; });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /campo fonte_url: formato inválido/);
});

test('reprova verificado_em no futuro', async () => {
  const { erros } = await validarCom((d) => { d.lojas[0].verificado_em = '2026-12-01'; });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /campo verificado_em: data no futuro/);
});

test('reprova campo desconhecido, inclusive dentro da condição', async () => {
  const { erros } = await validarCom((d) => {
    d.lojas[0].telefone = 'x';
    d.ofertas[0].regras[0].condicao.vip = true;
  });
  assert.equal(erros.length, 2);
  assert.ok(erros.some((e) => e.includes('campo telefone: campo desconhecido')));
  assert.ok(erros.some((e) => e.includes('campo regras[0].condicao.vip: campo desconhecido')));
});

test('reprova id repetido', async () => {
  const { erros } = await validarCom((d) => { d.lojas.push({ ...d.lojas[0] }); });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /lojas\.json › registro \d+ \(id "magalu"\) .*id repetido/);
});

test('reprova valor fora da lista (enum)', async () => {
  const { erros } = await validarCom((d) => { d.ofertas[0].escopo = 'tudo'; });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /campo escopo: valor "tudo" não permitido/);
});

test('reprova dinheiro com centavos em float', async () => {
  const { erros } = await validarCom((d) => { d.cartoes[0].anuidade_brl = 129.9; });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /campo anuidade_brl/);
});

test('exige cupom quando exige_cupom é true e categorias no escopo por categoria', async () => {
  const { erros } = await validarCom((d) => {
    d.ofertas[0].exige_cupom = true;
    d.ofertas[0].escopo = 'categorias_selecionadas';
  });
  assert.equal(erros.length, 2);
  assert.ok(erros.some((e) => e.includes('campo cupom: obrigatório')));
  assert.ok(erros.some((e) => e.includes('campo categorias_incluidas: obrigatório')));
});

test('produtos em campanha: link no site da loja ou do programa', async () => {
  const { erros } = await validarCom((d) => {
    d.ofertas[0].produtos_em_campanha = [
      { nome: 'Produto da loja', link: 'https://www.magazineluiza.com.br/produto/p/123/' },
      { nome: 'Campanha no programa', link: 'https://www.voeazul.com.br/br/pt/campanha' },
      { nome: 'Blog', link: 'https://passageirodeprimeira.com/produto' },
      { nome: 'Domínio parecido', link: 'https://magazineluiza.com.br.golpe.com/produto' },
    ];
  });
  assert.equal(erros.length, 2, erros.join('\n'));
  assert.ok(erros.every((e) => e.includes('link precisa ser https no site da loja ou do programa (magazineluiza.com.br ou voeazul.com.br)')));
  assert.ok(erros.some((e) => e.includes('produtos_em_campanha[2].link')));
  assert.ok(erros.some((e) => e.includes('produtos_em_campanha[3].link')));
});

test('produtos em campanha: nome curto, sem preço nem outros campos', async () => {
  const { erros } = await validarCom((d) => {
    d.ofertas[0].produtos_em_campanha = [
      { nome: 'x'.repeat(121), link: 'https://www.magazineluiza.com.br/a' },
      { nome: 'Com preço', link: 'https://www.magazineluiza.com.br/b', preco: 99990 },
    ];
  });
  assert.ok(erros.some((e) => e.includes('produtos_em_campanha[0].nome: deve ter no máximo 120 caracteres')), erros.join('\n'));
  assert.ok(erros.some((e) => e.includes('produtos_em_campanha[1]') && e.includes('preco')), erros.join('\n'));
});

test('produtos em campanha: loja sem domínio confirmado só aceita o programa', async () => {
  const { erros } = await validarCom((d) => {
    d.lojas.find((l) => l.id === 'magalu').dominio = 'A_CONFIRMAR';
    d.programas.find((p) => p.id === 'azul-fidelidade').url = 'nao é url';
    d.ofertas[0].produtos_em_campanha = [{ nome: 'P', link: 'https://www.magazineluiza.com.br/a' }];
  });
  assert.ok(erros.some((e) => e.includes('domínio não cadastrado')), erros.join('\n'));
});

test('linkNoDominio recusa http, porta, usuário e texto que não é link', () => {
  const d = ['loja.com.br'];
  assert.equal(linkNoDominio('https://loja.com.br/x', d), true);
  assert.equal(linkNoDominio('https://m.loja.com.br/x', d), true);
  assert.equal(linkNoDominio('http://loja.com.br/x', d), false);
  assert.equal(linkNoDominio('https://loja.com.br:8443/x', d), false);
  assert.equal(linkNoDominio('https://eu@loja.com.br/x', d), false);
  assert.equal(linkNoDominio('https://outraloja.com.br/x', d), false);
  assert.equal(linkNoDominio('não é link', d), false);
  assert.equal(linkNoDominio(undefined, d), false);
});

test('reprova JSON quebrado com o nome do arquivo', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'dados-'));
  await cp(new URL('schemas/', DADOS), join(pasta, 'schemas'), { recursive: true });
  for (const nome of ARQUIVOS.filter((n) => n !== 'ofertas')) await writeFile(join(pasta, `${nome}.json`), '[]');
  await writeFile(join(pasta, 'ofertas.json'), '[{');
  const { erros } = await validarDados(pathToFileURL(pasta + '/'), { hoje: HOJE });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /^ofertas\.json: não foi possível ler o JSON/);
});

test('para se o schema usar palavra-chave que o validador não conhece', () => {
  assert.throws(() => validarSchema(1, { oneOf: [] }), /não suportada.*oneOf/);
});

test('milheiro com número exige origem e fonte; A_CONFIRMAR não exige', async () => {
  const { erros } = await validarCom((d) => {
    delete d.programas[0].valor_milheiro_origem;
    delete d.programas[0].valor_milheiro_fonte_url;
    d.programas[1].valor_milheiro_brl = 'A_CONFIRMAR';
    delete d.programas[1].valor_milheiro_origem;
    delete d.programas[1].valor_milheiro_fonte_url;
  });
  assert.deepEqual(erros.sort(), [
    'programas.json › registro 0 (id "azul-fidelidade") › campo valor_milheiro_fonte_url: obrigatório quando valor_milheiro_brl é um número',
    'programas.json › registro 0 (id "azul-fidelidade") › campo valor_milheiro_origem: obrigatório quando valor_milheiro_brl é um número',
  ]);
});

test('avisa quando o milheiro é estimativa editável', async () => {
  const { avisos } = await validarDados(DADOS, { hoje: HOJE });
  assert.ok(avisos.some((a) => a.includes('estimativa editável')));
});

test('reprova origem do milheiro fora da lista', async () => {
  const { erros } = await validarCom((d) => { d.programas[0].valor_milheiro_origem = 'chute'; });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /valor_milheiro_origem/);
});

test('cotação do dólar: aceita inteiro (reais × 10.000) e avisa quando está A_CONFIRMAR', async () => {
  const pendente = await validarCom((d) => { d.cambio[0].reais_por_dolar = 'A_CONFIRMAR'; });
  assert.ok(pendente.avisos.some((a) => a.includes('câmbio "usd-brl"') && a.includes('A_CONFIRMAR')));
  const ok = await validarCom((d) => {
    d.cambio[0].reais_por_dolar = 53456;
    d.cambio[0].data_referencia = '2026-11-21';
  });
  assert.deepEqual(ok.erros, []);
});

test('cotação do dólar: reprova número quebrado, zero e moeda desconhecida', async () => {
  const { erros } = await validarCom((d) => {
    d.cambio[0].reais_por_dolar = 5.34;
    d.cambio.push({ ...d.cambio[0], id: 'outra', reais_por_dolar: 0, moeda: 'EUR' });
  });
  assert.ok(erros.some((e) => e.includes('cambio.json › registro 0') && e.includes('reais_por_dolar')));
  assert.ok(erros.some((e) => e.includes('cambio.json › registro 1') && e.includes('reais_por_dolar')));
  assert.ok(erros.some((e) => e.includes('cambio.json › registro 1') && e.includes('moeda')));
});

// ---------------------------------------------------------------------------
// Postos de combustível

test('regra de posto aponta para rede e programa que existem', async () => {
  const { erros } = await validarCom((d) => {
    d['regras-postos'][1].rede_id = 'posto-inventado';
    d['regras-postos'][1].programa_id = 'programa-inventado';
  });
  assert.deepEqual(erros, [
    'regras-postos.json › registro 1 (id "petrobras-premmia") › campo rede_id: id "posto-inventado" não existe em redes-postos.json',
    'regras-postos.json › registro 1 (id "petrobras-premmia") › campo programa_id: id "programa-inventado" não existe em programas.json',
  ]);
});

test('regra de posto: combustível fora da lista, unidade e forma de pagamento inventadas são reprovados', async () => {
  const { erros } = await validarCom((d) => {
    d['regras-postos'][1].combustiveis = ['gasolina_comum', 'querosene'];
    d['regras-postos'][1].unidade = 'galao';
    d['regras-postos'][1].formas_de_pagamento = ['dinheiro'];
  });
  assert.equal(erros.length, 3);
  assert.ok(erros.every((e) => e.startsWith('regras-postos.json › registro 1')));
});

test('regra de posto: preço de combustível e posto individual não cabem no modelo', async () => {
  const { erros } = await validarCom((d) => {
    d['regras-postos'][1].preco_litro = 6299;
    d['redes-postos'][0].endereco = 'Rua X, 10';
  });
  assert.deepEqual(erros, [
    'redes-postos.json › registro 0 (id "ipiranga") › campo endereco: campo desconhecido (não existe no schema)',
    'regras-postos.json › registro 1 (id "petrobras-premmia") › campo preco_litro: campo desconhecido (não existe no schema)',
  ]);
});

test('regra de posto: fim antes do início, bloco sem unidade e item repetido', async () => {
  const { erros } = await validarCom((d) => {
    Object.assign(d['regras-postos'][1], { inicio: '2026-11-20', fim: '2026-11-10' });
    d['regras-postos'][0].pontua_a_cada = 100;
    d['regras-postos'][2].combustiveis = ['gnv', 'gnv'];
  });
  assert.equal(erros.length, 3);
  assert.ok(erros.some((e) => /petrobras-premmia.*fim \(2026-11-10\) é anterior ao início/.test(e)));
  assert.ok(erros.some((e) => /ipiranga-km-de-vantagens.*pontua_a_cada: sem unidade confirmada/.test(e)));
  assert.ok(erros.some((e) => /shell-box-clube-comum.*combustiveis: item repetido/.test(e)));
});

test('regra de posto: fonte e data de verificação são obrigatórias', async () => {
  const { erros } = await validarCom((d) => {
    delete d['regras-postos'][1].fonte_url;
    d['redes-postos'][1].verificado_em = '2026-12-01';
  });
  assert.equal(erros.length, 2);
  assert.ok(erros.some((e) => /regras-postos.*fonte_url: campo obrigatório ausente/.test(e)));
  assert.ok(erros.some((e) => /redes-postos.*verificado_em: data no futuro/.test(e)));
});

test('regra de posto: avisa o que está A_CONFIRMAR e o que já terminou', async () => {
  const { avisos } = await validarDados(DADOS, { hoje: HOJE });
  assert.ok(avisos.includes('regra de posto "ipiranga-km-de-vantagens": pontos_por_unidade está "A_CONFIRMAR"'));
  const comFim = await validarCom((d) => { Object.assign(d['regras-postos'][1], { inicio: '2026-11-01', fim: '2026-11-10' }); });
  assert.ok(comFim.avisos.includes('regra de posto "petrobras-premmia": já terminou (fim 2026-11-10, hoje 2026-11-26)'));
});

test('regras de posto do repositório: todo registro tem fonte oficial https e nenhum guarda preço', async () => {
  const regras = JSON.parse(await readFile(new URL('regras-postos.json', DADOS), 'utf8'));
  const oficiais = /^https:\/\/www\.(shell\.com\.br|postospetrobras\.com\.br|ipiranga\.com\.br)\//;
  for (const r of regras) {
    assert.match(r.fonte_url, oficiais, r.id);
    assert.ok(!Object.keys(r).some((k) => /preco|endereco|cnpj/.test(k)), r.id);
  }
});
