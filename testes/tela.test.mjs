// Funções puras da tela inicial (máscara, busca, perfil, textos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { aplicarMascara, erroDoValor, MAX_DIGITOS, VALOR_MAXIMO_CENTAVOS } from '../site/js/tela/moeda.js';
import { filtrarLojas, lojaPeloNome, normalizar } from '../site/js/tela/lojas.js';
import { CHAVE, apagarDoAparelho, lerDoAparelho, limparPerfil, perfilDeTodos, salvarNoAparelho } from '../site/js/tela/perfil.js';
import {
  agoraLocal, destaqueDoJeito, fraseDoJeito, palavrasQueAparecem, textoValidade, textosAntesDeComprar, textosConferido,
} from '../site/js/tela/textos.js';
import { calcularJeitosDeComprar } from '../site/js/motor/index.js';
import { copiarDados, ARQUIVOS } from '../scripts/copiar-dados.js';

// ---------------------------------------------------------------------------
// Máscara de R$

test('máscara: dígitos entram pela direita, como caixa eletrônico', () => {
  assert.deepEqual(aplicarMascara('1'), { centavos: 1, texto: '0,01', cortado: false });
  assert.deepEqual(aplicarMascara('129900'), { centavos: 129900, texto: '1.299,00', cortado: false });
  assert.deepEqual(aplicarMascara('1.299,005'), { centavos: 1299005, texto: '12.990,05', cortado: false });
});

test('máscara: ignora R$, letras e zeros à esquerda', () => {
  assert.equal(aplicarMascara('R$ 1.234,56').centavos, 123456);
  assert.equal(aplicarMascara('abc12x').centavos, 12);
  assert.equal(aplicarMascara('000150').texto, '1,50');
});

test('máscara: vazio é null, só zeros é zero', () => {
  assert.deepEqual(aplicarMascara(''), { centavos: null, texto: '', cortado: false });
  assert.deepEqual(aplicarMascara('abc'), { centavos: null, texto: '', cortado: false });
  assert.deepEqual(aplicarMascara('000'), { centavos: 0, texto: '0,00', cortado: false });
});

test('máscara: corta no limite de dígitos e avisa', () => {
  const r = aplicarMascara('9'.repeat(MAX_DIGITOS + 5));
  assert.equal(r.centavos, VALOR_MAXIMO_CENTAVOS);
  assert.equal(r.texto, '999.999.999,99');
  assert.equal(r.cortado, true);
  assert.ok(Number.isSafeInteger(r.centavos));
});

test('erro do valor: vazio, zero e válido', () => {
  assert.equal(erroDoValor(null), 'Digite quanto vai custar a compra.');
  assert.equal(erroDoValor(0), 'O valor precisa ser maior que zero.');
  assert.equal(erroDoValor(1), '');
});

// ---------------------------------------------------------------------------
// Busca de loja

const LOJAS = [
  { id: 'magalu', nome: 'Magalu', dominio: 'magazineluiza.com.br' },
  { id: 'americanas', nome: 'Americanas', dominio: 'americanas.com.br' },
  { id: 'mercado-livre', nome: 'Mercado Livre', dominio: 'mercadolivre.com.br' },
  { id: 'centauro', nome: 'Centauro', dominio: 'A_CONFIRMAR' },
];

test('normalizar tira acento, maiúscula e espaço extra', () => {
  assert.equal(normalizar('  Ótica   São João '), 'otica sao joao');
});

test('filtrar: quem começa com o termo vem primeiro', () => {
  assert.deepEqual(filtrarLojas(LOJAS, 'ma').map((l) => l.id), ['magalu']);
  assert.deepEqual(filtrarLojas(LOJAS, 'ca').map((l) => l.id), ['americanas', 'mercado-livre']);
  assert.deepEqual(filtrarLojas(LOJAS, 'MERCADO').map((l) => l.id), ['mercado-livre']);
});

test('filtrar: acha pelo endereço do site, mas não por "A_CONFIRMAR"', () => {
  assert.deepEqual(filtrarLojas(LOJAS, 'magazine').map((l) => l.id), ['magalu']);
  assert.deepEqual(filtrarLojas(LOJAS, 'confirmar'), []);
});

test('filtrar: vazio mostra todas em ordem alfabética, com limite', () => {
  assert.deepEqual(filtrarLojas(LOJAS, '').map((l) => l.nome), ['Americanas', 'Centauro', 'Magalu', 'Mercado Livre']);
  assert.equal(filtrarLojas(LOJAS, '', 2).length, 2);
});

test('loja pelo nome exato, sem ligar para acento e maiúscula', () => {
  assert.equal(lojaPeloNome(LOJAS, ' magalu ').id, 'magalu');
  assert.equal(lojaPeloNome(LOJAS, 'Maga'), null);
});

// ---------------------------------------------------------------------------
// Perfil

const DADOS = {
  programas: [{ id: 'prog-a', nome: 'Programa A' }, { id: 'prog-b', nome: 'Programa B' }],
  cartoes: [{ id: 'cartao-a', nome: 'Cartão A' }, { id: 'cartao-b', nome: 'Cartão B' }],
};

test('perfil de todos: todos os programas sem clube e todos os cartões', () => {
  assert.deepEqual(perfilDeTodos(DADOS), {
    programas: [{ programa_id: 'prog-a', clube_ativo: false }, { programa_id: 'prog-b', clube_ativo: false }],
    cartoes: ['cartao-a', 'cartao-b'],
    valor_milheiro_brl: {},
  });
});

test('limpar perfil: tira ids desconhecidos, repetidos, datas ruins e valores quebrados', () => {
  const bruto = {
    programas: [
      { programa_id: 'prog-a', clube_ativo: true, clube_ativo_desde: '2026-11-01', extra: 'x' },
      { programa_id: 'prog-a', clube_ativo: false },
      { programa_id: 'nao-existe', clube_ativo: true },
      { programa_id: 'prog-b', clube_ativo: 'sim', clube_ativo_desde: 'ontem' },
      null,
    ],
    cartoes: ['cartao-b', 'cartao-b', 'outro'],
    valor_milheiro_brl: { 'prog-a': 2000, 'prog-b': 12.5, 'nao-existe': 100 },
    cpf: 'nunca guardamos isso',
  };
  assert.deepEqual(limparPerfil(bruto, DADOS), {
    programas: [
      { programa_id: 'prog-a', clube_ativo: true, clube_ativo_desde: '2026-11-01' },
      { programa_id: 'prog-b', clube_ativo: false },
    ],
    cartoes: ['cartao-b'],
    valor_milheiro_brl: { 'prog-a': 2000 },
  });
});

test('limpar perfil: lixo vira null', () => {
  assert.equal(limparPerfil(null, DADOS), null);
  assert.equal(limparPerfil({ programas: 'x', cartoes: [] }, DADOS), null);
});

function armazenamentoFalso() {
  const mapa = new Map();
  return {
    getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
    setItem: (k, v) => mapa.set(k, String(v)),
    removeItem: (k) => mapa.delete(k),
    mapa,
  };
}

test('salvar, ler e apagar do aparelho', () => {
  const a = armazenamentoFalso();
  const perfil = { programas: [{ programa_id: 'prog-a', clube_ativo: false }], cartoes: ['cartao-a'], valor_milheiro_brl: {} };
  assert.equal(salvarNoAparelho(perfil, a), true);
  assert.ok(a.mapa.has(CHAVE));
  assert.deepEqual(lerDoAparelho(DADOS, a), perfil);
  assert.equal(apagarDoAparelho(a), true);
  assert.equal(lerDoAparelho(DADOS, a), null);
});

test('aparelho que não deixa salvar ou tem JSON quebrado não derruba a tela', () => {
  const bloqueado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('cheio'); }, removeItem() { throw new Error('x'); } };
  assert.equal(lerDoAparelho(DADOS, bloqueado), null);
  assert.equal(salvarNoAparelho({ programas: [], cartoes: [] }, bloqueado), false);
  assert.equal(apagarDoAparelho(bloqueado), false);
  const quebrado = armazenamentoFalso();
  quebrado.setItem(CHAVE, '{nao é json');
  assert.equal(lerDoAparelho(DADOS, quebrado), null);
});

// ---------------------------------------------------------------------------
// Textos do card (com saída real do motor)

const FONTE = 'https://exemplo.invalid/teste';
const DADOS_MOTOR = {
  programas: [
    { id: 'prog-a', nome: 'Programa A', tipo: 'milhas', valor_milheiro_brl: 2000, url: FONTE, fonte_url: FONTE, verificado_em: '2026-11-01' },
    { id: 'prog-b', nome: 'Programa B', tipo: 'pontos', valor_milheiro_brl: 'A_CONFIRMAR', url: FONTE, fonte_url: FONTE, verificado_em: '2026-11-01' },
  ],
  cartoes: [
    { id: 'cartao-a', nome: 'Cartão A', emissor: 'X', bandeira: 'Y', programa_id: 'prog-a', pontos_por_real: 2, anuidade_brl: 0, observacoes: '', fonte_url: FONTE, verificado_em: '2026-10-01', status: 'confirmado' },
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
const HOJE = '2026-11-10T12:00';
const calc = (perfil, valor = 10000) =>
  calcularJeitosDeComprar(perfil, { loja_id: 'loja-a', valor_centavos: valor, tipo_vendedor: 'loja' }, DADOS_MOTOR, HOJE);
const PERFIL = { programas: [{ programa_id: 'prog-a', clube_ativo: false }, { programa_id: 'prog-b', clube_ativo: false }], cartoes: ['cartao-a'] };

test('agoraLocal monta "AAAA-MM-DDTHH:MM" com a hora do aparelho', () => {
  assert.equal(agoraLocal(new Date(2026, 0, 5, 7, 3)), '2026-01-05T07:03');
});

test('frase do jeito: com oferta, sem oferta e sem nada', () => {
  const [comOferta, semOferta] = calc(PERFIL);
  assert.equal(fraseDoJeito(comOferta, 'Loja A'), 'Compre na Loja A pela oferta do Programa B e pague com o cartão Cartão A.');
  assert.equal(fraseDoJeito(semOferta, 'Loja A'), 'Compre direto na Loja A e pague com o cartão Cartão A. Os pontos vão para o Programa A.');
  const [vazio] = calc({ programas: [], cartoes: [] });
  assert.equal(fraseDoJeito(vazio, 'Loja A'), 'Sem oferta e sem cartão, esta compra na Loja A não rende pontos.');
});

test('destaque: reais quando o motor dá o valor; pontos quando falta o milheiro; nenhum ponto', () => {
  const [, semOferta] = calc(PERFIL);
  assert.deepEqual(destaqueDoJeito(semOferta), {
    principal: 'R$ 4,00', legenda: 'é quanto valem, em média, os 200 pontos desta compra', emReais: true,
  });
  const [comOferta] = calc({ programas: [{ programa_id: 'prog-b', clube_ativo: false }], cartoes: [] });
  assert.equal(destaqueDoJeito(comOferta).principal, '500 pontos');
  assert.match(destaqueDoJeito(comOferta).legenda, /falta o valor do milheiro do Programa B/);
  const [vazio] = calc({ programas: [], cartoes: [] });
  assert.equal(destaqueDoJeito(vazio).principal, 'Nenhum ponto');
});

test('validade: da oferta, ou explica que é ponto de sempre do cartão', () => {
  const [comOferta, semOferta] = calc(PERFIL);
  assert.equal(textoValidade(comOferta), 'Validade da oferta: de 01/11/2026 até 30/11/2026.');
  assert.match(textoValidade(semOferta), /sem data para acabar/);
});

test('conferido: uma linha por dado usado, marcando o antigo', () => {
  const [comOferta] = calc(PERFIL);
  const linhas = textosConferido(comOferta);
  assert.ok(linhas.some((l) => l.texto === 'Oferta Programa B na Loja A: conferido em 09/11/2026 (ontem)' && !l.antigo));
  assert.ok(linhas.some((l) => l.texto === 'Cartão Cartão A: conferido em 01/10/2026 (há 40 dias)' && l.antigo));
});

test('antes de comprar: condições, prazo e o que renderia mais (clube 24 horas antes)', () => {
  const [comOferta] = calc(PERFIL);
  const { fazer, daPraGanharMais } = textosAntesDeComprar(comOferta);
  assert.ok(fazer.includes('Pagar com o cartão Cartão A.'));
  assert.ok(fazer.some((t) => /30 dias/.test(t)));
  assert.equal(daPraGanharMais.length, 1);
  assert.match(daPraGanharMais[0], /assinasse o clube Programa B pelo menos 24 horas antes da compra/);
});

test('palavras que aparecem: clube e milheiro', () => {
  assert.deepEqual(palavrasQueAparecem(calc(PERFIL)), { clube: true, milheiro: true });
});

test('textos da tela não usam "conforme"', async () => {
  const pasta = new URL('../site/js/tela/', import.meta.url);
  for (const nome of await readdir(pasta)) {
    const texto = await readFile(new URL(nome, pasta), 'utf8');
    assert.doesNotMatch(texto, /conforme/i, nome);
  }
  assert.doesNotMatch(await readFile(new URL('../site/index.html', import.meta.url), 'utf8'), /conforme/i);
});

test('tela não usa innerHTML, outerHTML, insertAdjacentHTML nem document.write', async () => {
  const arquivos = ['../site/js/app.js', ...(await readdir(new URL('../site/js/tela/', import.meta.url))).map((n) => `../site/js/tela/${n}`)];
  for (const arquivo of arquivos) {
    const texto = await readFile(new URL(arquivo, import.meta.url), 'utf8');
    assert.doesNotMatch(texto, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, arquivo);
  }
});

// ---------------------------------------------------------------------------
// Cópia dos dados para o site

test('copiar dados leva os 4 arquivos para a pasta do site', async () => {
  const destino = await mkdtemp(join(tmpdir(), 'dados-'));
  const n = await copiarDados(new URL('../dados/', import.meta.url), pathToFileURL(`${destino}/`));
  assert.equal(n, 4);
  for (const nome of ARQUIVOS) {
    const original = await readFile(new URL(`../dados/${nome}`, import.meta.url), 'utf8');
    assert.equal(await readFile(join(destino, nome), 'utf8'), original);
  }
});
