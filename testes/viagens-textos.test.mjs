// Textos da tela "Milhas em viagens" (site/js/tela/viagens-textos.js), com os dados reais
// de 25/11/2026: a tela só escolhe palavras, então testamos as frases que a pessoa lê.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calcularTransferencias, calcularViagem, campanhasDeHoje } from '../site/js/motor/viagens.js';
import {
  anuncioDaTransferencia, anuncioDaViagem, destaqueDaRota, destaqueDaViagem, erroDosPontos, fraseDaViagem,
  lerBonus, lerPontos, selosDaRota, TERMOS_VIAGEM, textoDaCampanha, textoDasOutrasCampanhas, vereditoDaRota,
} from '../site/js/tela/viagens-textos.js';

const HOJE = '2026-11-25';
const NOMES = ['programas', 'cartoes', 'cambio', 'cotacoes', 'transferencias', 'bonus-transferencia', 'viagens'];
const dados = Object.fromEntries(await Promise.all(NOMES.map(async (n) => [n, JSON.parse(await readFile(new URL(`../dados/${n}.json`, import.meta.url), 'utf8'))])));
const semEspacoDuro = (t) => t.replace(/ /g, ' ');

test('campo de pontos: só dígitos, ponto de milhar, limite de 9 dígitos', () => {
  assert.deepEqual(lerPontos('50000'), { pontos: 50000, texto: '50.000' });
  assert.deepEqual(lerPontos('abc 1.2.3'), { pontos: 123, texto: '123' });
  assert.deepEqual(lerPontos(''), { pontos: null, texto: '' });
  assert.deepEqual(lerPontos('000'), { pontos: 0, texto: '0' });
  assert.equal(lerPontos('12345678901').pontos, 123456789);
  assert.equal(erroDosPontos(null), 'Digite quantos pontos você tem.');
  assert.equal(erroDosPontos(0), 'Os pontos precisam ser mais que zero.');
  assert.equal(erroDosPontos(10), '');
});

test('bônus digitado: vazio usa a campanha, número vai até 1000%', () => {
  assert.equal(lerBonus(''), null);
  assert.equal(lerBonus('80%'), 80);
  assert.equal(lerBonus('5000'), 1000);
});

test('explica milheiro, bônus, clube e categoria', () => {
  for (const chave of ['milheiro', 'bonus', 'clube', 'categoria']) {
    const [pergunta, resposta] = TERMOS_VIAGEM[chave];
    assert.match(pergunta, /^O que é/);
    assert.ok(resposta.length > 40);
  }
});

test('lista de bônus de hoje: Livelo → Smiles com até 80%, termina hoje, pede cadastro', () => {
  const [item] = campanhasDeHoje(dados, HOJE);
  const t = textoDaCampanha(item);
  assert.equal(t.titulo, 'Livelo → Smiles: até 80% de bônus');
  assert.ok(t.detalhes.includes('Termina hoje.'));
  assert.ok(t.detalhes.includes('Precisa se cadastrar na campanha antes de transferir.'));
  assert.match(t.detalhes[0], /^40% para todos/);
  const outro = textoDaCampanha({ ...item, maior_bonus: null, termina_hoje: false, campanha: { ...item.campanha, fim: 'A_CONFIRMAR', exige_cadastro: false } });
  assert.equal(outro.titulo, 'Livelo → Smiles: bônus a confirmar');
  assert.ok(outro.detalhes.includes('Fim da campanha a confirmar.'));
  const depois = textoDaCampanha({ ...item, termina_hoje: false, campanha: { ...item.campanha, fim: '2026-11-30' } });
  assert.ok(depois.detalhes.includes('Vai até 30/11/2026.'));
});

test('card da transferência: 50.000 Livelo → Smiles com 80% (clube)', () => {
  const r = calcularTransferencias({ origem_id: 'livelo', pontos: 50000, faixa: 'maior' }, null, dados, HOJE);
  const smiles = r.opcoes.find((o) => o.destino_id === 'smiles');
  const d = destaqueDaRota(smiles);
  assert.equal(d.principal, '90.000 pontos Smiles');
  assert.match(semEspacoDuro(d.legenda), /^Valem uns R\$ [\d.,]+\. Cada 1\.000 saem por R\$ [\d,]+\.$/);
  const selos = selosDaRota(smiles, 1).map((s) => s.texto);
  assert.ok(selos.includes('Bônus de 80% hoje'));
  assert.ok(!selos.includes('Rende mais'));
  assert.equal(selosDaRota(smiles, 0)[0].texto, 'Rende mais');
  const all = r.opcoes.find((o) => o.destino_id === 'all-accor');
  assert.ok(selosDaRota(all, 0).some((s) => s.texto === 'Só vale como desconto em hotel'));
  assert.ok(!selosDaRota(all, 0).some((s) => s.texto === 'Rende mais'));
  const v = vereditoDaRota(smiles);
  assert.equal(v.titulo, 'Compensa');
  assert.match(anuncioDaTransferencia(r), /^Rende mais na /);
});

test('card da transferência: sem bônus, abaixo do mínimo, proporção a confirmar, bônus digitado', () => {
  const r = calcularTransferencias({ origem_id: 'livelo', pontos: 5000, bonus_manual: { 'azul-fidelidade': 30 } }, null, dados, HOJE);
  const azul = r.opcoes.find((o) => o.destino_id === 'azul-fidelidade');
  assert.ok(selosDaRota(azul, 0).some((s) => s.texto === 'Bônus de 30% (digitado)'));
  const smiles = r.opcoes.find((o) => o.destino_id === 'smiles');
  assert.ok(selosDaRota(smiles, 3).some((s) => s.texto === 'Abaixo do mínimo'));
  const latam = r.opcoes.find((o) => o.destino_id === 'latam-pass');
  assert.ok(selosDaRota(latam, 2).some((s) => s.texto === 'Sem bônus hoje'));

  const esfera = calcularTransferencias({ origem_id: 'esfera', pontos: 1000 }, null, dados, HOJE);
  assert.equal(anuncioDaTransferencia(esfera), 'Nenhum destino deu para calcular com esses pontos. Veja os avisos.');
  const aConfirmar = esfera.opcoes.find((o) => !o.calculavel);
  assert.deepEqual(destaqueDaRota(aConfirmar), { principal: 'A confirmar', legenda: aConfirmar.motivo });
  assert.deepEqual(selosDaRota(aConfirmar, 0), [{ tipo: 'aviso', texto: 'Proporção a confirmar' }]);
  assert.equal(vereditoDaRota(aConfirmar), null);
});

test('veredito: compensa, empata e não compensa', () => {
  const base = { calculavel: true, nome_origem: 'Livelo' };
  assert.equal(vereditoDaRota({ ...base, ganho: null }), null);
  assert.equal(vereditoDaRota({ ...base, ganho: 0n }).titulo, 'Empata');
  const nao = vereditoDaRota({ ...base, ganho: -500n * 1_000_000_000n });
  assert.equal(nao.titulo, 'Hoje não compensa');
  assert.match(semEspacoDuro(nao.texto), /valem R\$ 5,00 a mais/);
});

test('outras campanhas: próxima e última', () => {
  const campanha = (inicio, fim, pct) => ({ inicio, fim, faixas: [{ bonus_percentual: pct }, { bonus_percentual: 'A_CONFIRMAR' }] });
  const textos = textoDasOutrasCampanhas({ proxima_campanha: campanha('2026-12-01', '2026-12-02', 90), ultima_campanha: campanha('2026-11-01', '2026-11-03', 70) });
  assert.deepEqual(textos, [
    'Próxima campanha cadastrada: começa em 01/12/2026, com até 90% de bônus.',
    'Última campanha que vimos: até 03/11/2026, com até 70% de bônus.',
  ]);
  assert.deepEqual(textoDasOutrasCampanhas({ proxima_campanha: null, ultima_campanha: null }), []);
});

test('card de passagem: LATAM nacional com cartão do perfil', () => {
  const perfil = { cartoes: ['latam-pass-itau-platinum'], cotacao_dolar: 58889 }; // 2 pontos por dólar a R$ 5,8889
  const r = calcularViagem({ tipo: 'passagem', valor_centavos: 40000, trechos: 'nacional_e_america_do_sul', vendedor: 'LATAM' }, perfil, dados, HOJE);
  const [j] = r.jeitos;
  const d = destaqueDaViagem(j);
  assert.equal(d.principal, '600 pontos LATAM Pass');
  assert.match(d.legenda, /pelo cartão/);
  assert.match(fraseDaViagem(j), /^Compre com a LATAM e pague com o cartão .+, informando o seu número de cliente LATAM Pass\.$/);
  assert.equal(anuncioDaViagem(r), 'Rende 600 pontos LATAM Pass.');
});

test('card de hotel: sem cartão, e quando falta dado', () => {
  const r = calcularViagem({ tipo: 'hotel', valor_centavos: 90000 }, null, dados, HOJE);
  const accor = r.jeitos.find((j) => j.regra.programa_id === 'all-accor');
  assert.match(fraseDaViagem(accor), /^Reserve em .+, informando o seu número de cliente ALL Accor\.$/);
  assert.doesNotMatch(destaqueDaViagem(accor).legenda, /cartão/);
  const semDado = { pontos: null };
  assert.equal(destaqueDaViagem(semDado).principal, 'A confirmar');
  assert.equal(anuncioDaViagem({ jeitos: [semDado] }), 'Não deu para calcular. Veja os avisos.');
});
