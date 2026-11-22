import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dataValida, validarDados, validarSchema } from '../scripts/validar-dados.js';

const DADOS = new URL('../dados/', import.meta.url);
const HOJE = '2026-11-22';

async function lerReais() {
  const dados = {};
  for (const nome of ['programas', 'cartoes', 'lojas', 'ofertas']) {
    dados[nome] = JSON.parse(await readFile(new URL(`${nome}.json`, DADOS), 'utf8'));
  }
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
  const { avisos } = await validarDados(DADOS, { hoje: HOJE });
  assert.ok(avisos.some((a) => a.includes('já terminou')));
});

test('dataValida aceita só datas que existem', () => {
  assert.equal(dataValida('2026-11-12'), true);
  assert.equal(dataValida('2028-02-29'), true);
  assert.equal(dataValida('2026-02-29'), false);
  assert.equal(dataValida('2026-13-01'), false);
  assert.equal(dataValida('12/11/2026'), false);
});

test('mensagem aponta arquivo, registro e campo', async () => {
  const { erros } = await validarCom((d) => { d.ofertas[0].regras[1].pontos_por_real = -1; });
  assert.deepEqual(erros, [
    'ofertas.json › registro 0 (id "azul-fidelidade-magalu-2026-11") › campo regras[1].pontos_por_real: deve ser maior ou igual a 0 (recebido: -1)',
  ]);
});

test('reprova data que não existe', async () => {
  const { erros } = await validarCom((d) => { d.ofertas[0].fim = '2026-02-30'; });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /campo fim: .*"2026-02-30"/);
});

test('reprova fim antes do início', async () => {
  const { erros } = await validarCom((d) => { d.ofertas[0].inicio = '2026-11-20'; });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /campo fim: fim \(2026-11-12\) é anterior ao início \(2026-11-20\)/);
});

test('reprova id que não existe em outra tabela', async () => {
  const { erros } = await validarCom((d) => {
    d.ofertas[0].loja_id = 'americanas';
    d.ofertas[0].regras[0].condicao.cartao_id = 'outro-cartao';
    d.cartoes[0].programa_id = 'smiles';
  });
  assert.equal(erros.length, 3);
  assert.ok(erros.some((e) => e.includes('cartoes.json › registro 0 (id "azul-itau") › campo programa_id: id "smiles" não existe em programas.json')));
  assert.ok(erros.some((e) => e.includes('campo loja_id: id "americanas" não existe em lojas.json')));
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
  assert.match(erros[0], /lojas\.json › registro 1 .*id repetido/);
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

test('reprova JSON quebrado com o nome do arquivo', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'dados-'));
  await cp(new URL('schemas/', DADOS), join(pasta, 'schemas'), { recursive: true });
  for (const nome of ['programas', 'cartoes', 'lojas']) await writeFile(join(pasta, `${nome}.json`), '[]');
  await writeFile(join(pasta, 'ofertas.json'), '[{');
  const { erros } = await validarDados(pathToFileURL(pasta + '/'), { hoje: HOJE });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /^ofertas\.json: não foi possível ler o JSON/);
});

test('para se o schema usar palavra-chave que o validador não conhece', () => {
  assert.throws(() => validarSchema(1, { oneOf: [] }), /não suportada.*oneOf/);
});
