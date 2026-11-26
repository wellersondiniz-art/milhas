// Plano pago nas páginas: /plano/, Privacidade e Termos mudam só com
// PLANO_LIGADO; no modo de teste o build recusa link real.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PLANO_LIGADO, PLANO_MODO_REAL, PLANO_PRECO_CENTAVOS } from '../scripts/paginas/config.js';
import { configDoPlano, paginaDoPlano, problemasDoPlano } from '../scripts/paginas/plano.js';
import { paginasInstitucionais } from '../scripts/paginas/institucionais.js';
import { gerarPaginas } from '../scripts/paginas/montar.js';
import { conferirPaginas } from '../scripts/gerar-paginas.js';
import { dadosDeTeste } from './alertas/apoio.mjs';

const TESTE = configDoPlano({
  ligado: true,
  precoCentavos: 990,
  linkPagamento: 'https://buy.stripe.com/test_abc123',
  linkPortal: 'https://billing.stripe.com/p/login/test_xyz789',
  modoReal: false,
});
const VENDEDOR = { nome: 'Vendedor de Teste', documento: 'CNPJ de teste', endereco: 'Endereço de teste' };
const REAL = {
  ...TESTE, modoReal: true, linkPagamento: 'https://buy.stripe.com/abc123', linkPortal: 'https://billing.stripe.com/p/login/xyz789',
  vendedor: VENDEDOR, emailDeContato: 'contato@exemplo.com.br',
};
const DESLIGADO = configDoPlano({ ligado: false });

const pagina = (plano, nome) => paginasInstitucionais({ plano }).paginas.find((p) => p.caminho === `${nome}/index.html`).conteudo;

test('plano começa desligado, em modo de teste e sem preço', () => {
  assert.equal(PLANO_LIGADO, false);
  assert.equal(PLANO_MODO_REAL, false);
  assert.equal(PLANO_PRECO_CENTAVOS, 'A_CONFIRMAR');
  assert.deepEqual(problemasDoPlano(configDoPlano()), [], 'desligado não exige nada');
});

test('desligado: sem página /plano/ e Privacidade e Termos como antes', () => {
  assert.equal(paginaDoPlano({ config: DESLIGADO }), null);
  const { arquivos } = gerarPaginas(dadosDeTeste(), { hoje: '2026-11-24', plano: DESLIGADO });
  assert.ok(!arquivos.some((a) => a.caminho.startsWith('plano/')));
  assert.ok(!pagina(DESLIGADO, 'privacidade').includes('Plano pago'));
  const termos = pagina(DESLIGADO, 'termos');
  assert.ok(!termos.includes('Plano pago'));
  assert.ok(termos.includes('É uma calculadora gratuita. Você diz a loja'));
});

test('configuração: modo de teste só aceita links de teste; modo real só links reais', () => {
  assert.deepEqual(problemasDoPlano(TESTE), []);
  assert.deepEqual(problemasDoPlano(REAL), []);
  const problemas = problemasDoPlano({ ...TESTE, precoCentavos: 'A_CONFIRMAR', linkPagamento: 'A_CONFIRMAR', linkPortal: 'A_CONFIRMAR' });
  assert.equal(problemas.length, 3);
  assert.match(problemasDoPlano({ ...TESTE, linkPagamento: REAL.linkPagamento })[0], /DE TESTE/);
  assert.match(problemasDoPlano({ ...TESTE, linkPortal: REAL.linkPortal })[0], /DE TESTE/);
  assert.equal(problemasDoPlano({ ...REAL, linkPagamento: TESTE.linkPagamento }).length, 1, 'modo real não aceita link de teste');
  assert.equal(problemasDoPlano({ ...TESTE, precoCentavos: 9.9 }).length, 1, 'centavos inteiros');
  assert.equal(problemasDoPlano({ ...TESTE, linkPagamento: 'https://golpe.exemplo/test_abc' }).length, 1);
  assert.equal(problemasDoPlano({ ...TESTE, linkPortal: null }).length, 1);
  assert.throws(() => paginaDoPlano({ config: { ...TESTE, linkPagamento: REAL.linkPagamento } }), /configuração errada/);
});

test('página do plano (teste): aviso de teste, preço, sem formulário nem script, cartão só no Stripe', () => {
  const { caminho, conteudo: html } = paginaDoPlano({ config: TESTE, revisaoPendente: true });
  assert.equal(caminho, 'plano/index.html');
  for (const trecho of [
    'Modo de teste', 'nenhum cartão de verdade é cobrado', 'Texto em revisão',
    'até 10', 'até 50', 'até 2', 'até 7',
    'O plano não muda a conta nem a ordem do resultado.',
    'nunca passa pelo nosso site', 'mesmo e-mail dos seus',
    'Cancele quando quiser', 'até o fim do mês que você já pagou',
    'primeiros 7 dias', 'valor inteiro',
    'href="https://buy.stripe.com/test_abc123"', 'href="https://billing.stripe.com/p/login/test_xyz789"',
    'data-rotulo="Plano pago"', 'name="robots" content="noindex"',
  ]) assert.ok(html.includes(trecho), trecho);
  assert.match(html, /R\$\s9,90 por mês/);
  // Único script permitido: o das métricas sem cookie, que vai em todas as páginas (PR 23).
  assert.ok(!/<form|<input|<script(?! type="application\/ld\+json"| type="module" src="\.\.\/js\/metricas\/paginas\.js")/.test(html), 'sem formulário e sem script');
  assert.deepEqual(conferirPaginas([{ caminho, conteudo: html }]), []);
});

test('página do plano (real): sem o aviso de teste', () => {
  const html = paginaDoPlano({ config: REAL, revisaoPendente: false }).conteudo;
  assert.ok(!html.includes('Modo de teste'));
  assert.ok(!html.includes('Texto em revisão'));
  assert.ok(html.includes('href="https://buy.stripe.com/abc123"'));
});

test('ligado: build gera /plano/ e Privacidade e Termos ganham a parte do plano', () => {
  const { arquivos } = gerarPaginas(dadosDeTeste(), { hoje: '2026-11-24', plano: TESTE });
  assert.ok(arquivos.some((a) => a.caminho === 'plano/index.html'));
  assert.deepEqual(conferirPaginas(arquivos), []);

  const privacidade = pagina(TESTE, 'privacidade');
  for (const trecho of ['Plano pago (só se você assinar)', 'nunca chegam até a gente', 'política de privacidade do Stripe', 'o seu e-mail', '5 anos', 'Supabase', 'continua sem cookies']) {
    assert.ok(privacidade.includes(trecho), trecho);
  }
  const termos = pagina(TESTE, 'termos');
  for (const trecho of [
    'com um plano pago opcional', 'Ele não muda a conta nem a ordem do resultado',
    'renovado automaticamente', 'href="../plano/"', 'primeiros 7 dias', '30 dias de antecedência', 'maiores de 18 anos',
    'Se você contestar a cobrança com o banco do cartão', 'O site se mantém com o plano pago opcional',
  ]) assert.ok(termos.includes(trecho), trecho);
  assert.match(termos, /R\$\s9,90 por mês, com tributos/);
});

test('modo real exige quem vende e e-mail de contato (T6); a página mostra quem vende', () => {
  assert.deepEqual(problemasDoPlano(REAL), []);
  const semVendedor = problemasDoPlano({ ...REAL, vendedor: { ...VENDEDOR, endereco: 'A_CONFIRMAR' } });
  assert.ok(semVendedor.some((x) => /PLANO_VENDEDOR/.test(x)));
  assert.ok(problemasDoPlano({ ...REAL, emailDeContato: 'A_CONFIRMAR' }).some((x) => /EMAIL_DE_CONTATO/.test(x)));
  // No modo de teste, não trava, mas a página diz que falta.
  assert.deepEqual(problemasDoPlano({ ...TESTE, vendedor: { nome: 'A_CONFIRMAR' } }), []);
  const teste = paginaDoPlano({ config: { ...TESTE, vendedor: { nome: 'A_CONFIRMAR' } } }).conteudo;
  assert.match(teste, /Falta informar quem vende/);
  const real = paginaDoPlano({ config: REAL }).conteudo;
  assert.match(real, /Vendedor de Teste/);
  assert.match(real, /Endereço de teste/);
  assert.doesNotMatch(real, /Falta informar quem vende/);
});

test('Como funciona (T1): com o plano ligado, não diz "não cobramos nada"', () => {
  assert.match(pagina(DESLIGADO, 'como-funciona'), /não cobramos nada/);
  const ligado = pagina(TESTE, 'como-funciona');
  assert.doesNotMatch(ligado, /não cobramos nada/);
  assert.match(ligado, /O único pagamento é o plano opcional/);
});
