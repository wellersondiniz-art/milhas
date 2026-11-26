// "Essa informação está errada?": o lado da página (site/js/reporte/) e os
// textos de Privacidade e Contato. O fluxo com clique está em
// testes/navegador/reporte.spec.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { conferirNaTela, LIMITES_DA_TELA } from '../site/js/reporte/conferir.js';
import { ENDERECO_DO_REPORTE, REPORTE_LIGADO } from '../site/js/reporte/config.js';
import { LIMITES } from '../servidor/reportar/regras.js';
import { paginasInstitucionais } from '../scripts/paginas/institucionais.js';

const RAIZ = new URL('../', import.meta.url);
const certo = { o_que_esta_errado: 'A oferta já acabou.', link_da_prova: 'https://loja.com.br/x', email: '' };

test('limites da tela são os mesmos do servidor', () => {
  for (const nome of Object.keys(LIMITES_DA_TELA)) assert.equal(LIMITES_DA_TELA[nome], LIMITES[nome], nome);
});

test('conferência na tela: aceita o certo e aponta cada campo errado', () => {
  assert.deepEqual(conferirNaTela(certo), {});
  assert.deepEqual(conferirNaTela({ ...certo, email: ' ana@exemplo.com ' }), {});
  assert.deepEqual(Object.keys(conferirNaTela({})).sort(), ['link_da_prova', 'o_que_esta_errado']);
  assert.match(conferirNaTela({ ...certo, o_que_esta_errado: 'x'.repeat(1001) }).o_que_esta_errado, /no máximo/);
  for (const link of ['http://loja.com.br', 'https://loja', 'loja.com.br', `https://loja.com.br/${'a'.repeat(500)}`]) {
    assert.ok(conferirNaTela({ ...certo, link_da_prova: link }).link_da_prova, link);
  }
  for (const email of ['ana', 'ana@x', `${'a'.repeat(250)}@x.com`]) assert.ok(conferirNaTela({ ...certo, email }).email, email);
});

test('o envio vai para o próprio site (connect-src: self, e fora dele só as métricas)', async () => {
  assert.equal(ENDERECO_DO_REPORTE, '/api/reportar');
  const headers = await readFile(new URL('site/_headers', RAIZ), 'utf8');
  assert.match(headers, /connect-src 'self'( https:\/\/plausible\.io)?;/);
  assert.match(headers, /form-action 'self';/);
});

test('o botão começa desligado até a Cloudflare estar configurada', () => {
  assert.equal(REPORTE_LIGADO, false);
});

const textoVisivel = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
function pagina(opcoes, pasta) {
  return textoVisivel(paginasInstitucionais(opcoes).paginas.find((p) => p.caminho === `${pasta}/index.html`).conteudo);
}

test('Privacidade: com o botão ligado, diz o que guarda, onde e por quanto tempo', () => {
  const ligado = pagina({ reporteLigado: true }, 'privacidade');
  assert.match(ligado, /Quando você avisa de um erro/);
  assert.match(ligado, /o seu e-mail, só se você quiser resposta/);
  assert.match(ligado, /repositório privado do GitHub/);
  assert.match(ligado, /O e-mail é apagado quando a gente resolve o aviso, ou em até 90 dias/);
  assert.match(ligado, /some sozinho depois de uma hora\. O IP não vai para o aviso/);
  assert.match(ligado, /não escreva dados pessoais no texto/);
  const desligado = pagina({ reporteLigado: false }, 'privacidade');
  assert.doesNotMatch(desligado, /Quando você avisa de um erro|GitHub/);
});

test('Contato: com o botão ligado, aponta para ele', () => {
  assert.match(pagina({ reporteLigado: true }, 'contato'), /botão "Essa informação está errada\?"/);
  assert.doesNotMatch(pagina({ reporteLigado: false }, 'contato'), /Essa informação está errada/);
});

test('os prazos do texto batem com o código (90 dias do e-mail, 1 hora do IP)', async () => {
  const yml = await readFile(new URL('servidor/reportar/repo-de-reportes/limpar-emails.yml', RAIZ), 'utf8');
  const limite = await readFile(new URL('servidor/reportar/limite.js', RAIZ), 'utf8');
  assert.match(yml, /DIAS: '90'/);
  assert.match(limite, /pessoa = \{ chave: `reporte:pessoa:\$\{resumo\}:\$\{hora\}`, ttl: 3600 \}/);
});
