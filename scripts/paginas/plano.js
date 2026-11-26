// Página /plano/ do plano pago, gerada no build só com PLANO_LIGADO.
//
// A página não tem formulário nem script: o botão "Assinar" leva para a
// página de pagamento do Stripe (o número do cartão é digitado só lá) e o
// botão "Cancelar" leva para o portal do cliente do Stripe. A situação do
// plano só muda pelo webhook (servidor/plano/webhook.js).
//
// Funções puras.

import { formatarCentavos } from '../../site/js/motor/formatar.js';
import { BENEFICIOS } from '../../servidor/plano/regras.js';
import { LIMITES } from '../../servidor/alertas/regras.js';
import {
  EMAIL_DE_CONTATO, NOME_DO_SITE, PLANO_LIGADO, PLANO_LINK_PAGAMENTO, PLANO_LINK_PORTAL, PLANO_MODO_REAL, PLANO_PRECO_CENTAVOS,
  PLANO_VENDEDOR, REVISAO_JURIDICA_PENDENTE,
} from './config.js';
import { h, juntar, linkExterno } from './html.js';
import { alerta, documento } from './moldura.js';

const RAIZ = '../';
const A_CONFIRMAR = 'A_CONFIRMAR';
const EMAIL_VALIDO = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Nome, documento e endereço de quem vende, todos preenchidos? */
export function vendedorCompleto(v) {
  return Boolean(v) && ['nome', 'documento', 'endereco'].every((k) => typeof v[k] === 'string' && v[k].trim() && v[k] !== A_CONFIRMAR);
}

/** Configuração do plano, a partir de config.js (ou do que os testes passarem). */
export function configDoPlano(sobrepor = {}) {
  return {
    ligado: PLANO_LIGADO,
    precoCentavos: PLANO_PRECO_CENTAVOS,
    linkPagamento: PLANO_LINK_PAGAMENTO,
    linkPortal: PLANO_LINK_PORTAL,
    modoReal: PLANO_MODO_REAL,
    vendedor: PLANO_VENDEDOR,
    emailDeContato: EMAIL_DE_CONTATO,
    ...sobrepor,
  };
}

/**
 * Confere a configuração. Com o plano desligado, nada é exigido.
 * Com o plano ligado e o modo real desligado, os links TÊM de ser de teste:
 * assim ninguém cobra de verdade antes da aprovação do dono.
 * @returns {string[]} problemas (vazio = ok)
 */
export function problemasDoPlano(config) {
  if (!config.ligado) return [];
  const problemas = [];
  if (!Number.isInteger(config.precoCentavos) || config.precoCentavos < 100 || config.precoCentavos > 100000) {
    problemas.push('PLANO_PRECO_CENTAVOS precisa ser centavos inteiros entre 100 e 100000 (ex.: 990 = R$ 9,90).');
  }
  const teste = !config.modoReal;
  const pagamento = teste ? /^https:\/\/buy\.stripe\.com\/test_[A-Za-z0-9]+$/ : /^https:\/\/buy\.stripe\.com\/(?!test_)[A-Za-z0-9]+$/;
  const portal = teste ? /^https:\/\/billing\.stripe\.com\/p\/login\/test_[A-Za-z0-9]+$/ : /^https:\/\/billing\.stripe\.com\/p\/login\/(?!test_)[A-Za-z0-9]+$/;
  if (!pagamento.test(config.linkPagamento ?? '')) {
    problemas.push(`PLANO_LINK_PAGAMENTO precisa ser um link de pagamento ${teste ? 'DE TESTE (https://buy.stripe.com/test_...)' : 'real (https://buy.stripe.com/...)'}.`);
  }
  if (!portal.test(config.linkPortal ?? '')) {
    problemas.push(`PLANO_LINK_PORTAL precisa ser o link de entrada do portal ${teste ? 'DE TESTE (https://billing.stripe.com/p/login/test_...)' : 'real (https://billing.stripe.com/p/login/...)'}.`);
  }
  // Achado T6: cobrar de verdade exige mostrar quem vende e ter um contato
  // que funcione (o reembolso de 7 dias é pedido por ele).
  if (!teste) {
    if (!vendedorCompleto(config.vendedor)) {
      problemas.push('PLANO_VENDEDOR precisa de nome, documento (CPF ou CNPJ) e endereço antes do modo real (Decreto 7.962/2013).');
    }
    if (!EMAIL_VALIDO.test(config.emailDeContato ?? '')) {
      problemas.push('EMAIL_DE_CONTATO precisa estar definido antes do modo real: o reembolso de 7 dias é pedido pela página de Contato.');
    }
  }
  return problemas;
}

const p = (...filhos) => h('p', {}, ...filhos);
const secao = (id, titulo, ...corpo) => h('section', { class: 'pilha--sm', 'aria-labelledby': id },
  h('h2', { id, class: 'pagina__subtitulo' }, titulo), ...corpo);
const gratis = (texto) => h('td', { 'data-rotulo': 'Grátis' }, texto);
const pago = (texto) => h('td', { 'data-rotulo': 'Plano pago' }, texto);
const link = (pasta, texto) => h('a', { href: `${RAIZ}${pasta}` }, texto);

/**
 * @returns {{caminho: string, conteudo: string}|null} null com o plano desligado
 * @throws se o plano estiver ligado com configuração errada
 */
export function paginaDoPlano({ urlBase = null, config = configDoPlano(), revisaoPendente = REVISAO_JURIDICA_PENDENTE } = {}) {
  if (!config.ligado) return null;
  const problemas = problemasDoPlano(config);
  if (problemas.length) throw new Error(`Plano pago ligado com configuração errada:\n${problemas.map((x) => `- ${x}`).join('\n')}`);
  const preco = formatarCentavos(config.precoCentavos);
  const titulo = `Plano pago | ${NOME_DO_SITE}`;
  const descricao = `Mais alertas de pontos por e-mail por ${preco} por mês. A calculadora continua grátis e igual para todo mundo.`;

  const principal = juntar(
    h('section', { class: 'pilha--sm' },
      h('h1', {}, 'Plano pago'),
      config.modoReal ? null : alerta('aviso', '!', 'Modo de teste',
        p('O pagamento ainda está em teste: nenhum cartão de verdade é cobrado. Use só os cartões de teste do Stripe.')),
      revisaoPendente ? alerta('aviso', '!', 'Texto em revisão', p('Este texto ainda vai ser revisado por um advogado e pode mudar.')) : null,
      h('p', { class: 'resposta' }, `A calculadora continua grátis para todo mundo. O plano pago, de ${preco} por mês, dá mais alertas de pontos por e-mail.`)),

    secao('o-que-muda', 'O que muda com o plano',
      h('table', { class: 'tabela' },
        h('caption', { class: 'texto-suave texto-pequeno' }, 'Grátis e plano pago, lado a lado'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'O quê'), h('th', { scope: 'col' }, 'Grátis'), h('th', { scope: 'col' }, 'Plano pago'))),
        h('tbody', {},
          h('tr', {}, h('th', { scope: 'row' }, 'Alertas por e-mail guardados'), gratis(`até ${LIMITES.alertasPorEmail}`), pago(`até ${BENEFICIOS.alertasPorEmail}`)),
          h('tr', {}, h('th', { scope: 'row' }, 'E-mails de alerta por semana'), gratis(`até ${LIMITES.alertasPorSemana}`), pago(`até ${BENEFICIOS.alertasPorSemana}`)),
          h('tr', {}, h('th', { scope: 'row' }, 'Calculadora, ofertas e ordem do resultado'), gratis('iguais'), pago('iguais')))),
      p(h('strong', {}, 'O plano não muda a conta nem a ordem do resultado.'), ' Quem assina vê exatamente os mesmos pontos e o mesmo ranking de quem não assina.')),

    secao('como-assinar', 'Como assinar',
      h('ol', { class: 'pagina__lista' },
        h('li', {}, 'Toque em "Assinar". Você vai para a página de pagamento do Stripe, a empresa que processa o pagamento.'),
        h('li', {}, 'Use o mesmo e-mail dos seus ', link('alertas/', 'alertas'), '. É por ele que a gente sabe que você assina.'),
        h('li', {}, 'O número do cartão é digitado só na página do Stripe. Ele nunca passa pelo nosso site.')),
      p(h('strong', {}, `Preço: ${preco} por mês, renovado todo mês.`), ' A data da próxima cobrança aparece antes de você pagar e no recibo que o Stripe manda por e-mail.'),
      h('p', {}, linkExterno(config.linkPagamento, `Assinar por ${preco} por mês`))),

    secao('cancelar', 'Cancelar é fácil',
      p('Cancele quando quiser, sem falar com ninguém: entre no portal do Stripe com o seu e-mail e toque em "Cancelar plano". O plano continua até o fim do mês que você já pagou e não há nova cobrança.'),
      h('p', {}, linkExterno(config.linkPortal, 'Cancelar, trocar o cartão ou ver recibos')),
      p('Pelo mesmo portal você troca o cartão e baixa os recibos.')),

    secao('arrependimento', 'Mudou de ideia?',
      p('Nos primeiros 7 dias depois de assinar, devolvemos o valor inteiro, sem perguntas. Peça pela página de ', link('contato/', 'Contato'), ' com o e-mail da assinatura. O dinheiro volta pelo mesmo meio de pagamento e o plano acaba.'),
      p('Depois dos 7 dias, o mês já pago não é devolvido em parte, mas o plano vale até o fim dele. Cobrança em dobro ou erro nosso, a gente devolve sempre.')),

    secao('se-falhar', 'Se o pagamento falhar',
      p('O Stripe tenta cobrar de novo por alguns dias e avisa você por e-mail. Enquanto não der certo, os seus alertas voltam aos limites do grátis. Não tem multa.')),

    secao('quem-vende', 'Quem vende',
      vendedorCompleto(config.vendedor)
        ? h('ul', { class: 'pagina__lista' },
          h('li', {}, config.vendedor.nome),
          h('li', {}, config.vendedor.documento),
          h('li', {}, config.vendedor.endereco))
        : alerta('aviso', '!', 'Falta informar quem vende',
          p('Antes de cobrar de verdade, aqui aparecem o nome, o CPF ou CNPJ e o endereço de quem vende o plano.'))),

    secao('regras', 'Regras completas',
      p('Veja a parte "Plano pago" dos ', link('termos/', 'Termos de uso'), ' e da ', link('privacidade/', 'Privacidade'), '.')),
  );

  return {
    caminho: 'plano/index.html',
    conteudo: documento({
      titulo, descricao, caminho: 'plano/', raiz: RAIZ, urlBase, atual: 'plano', semIndexar: true, principal,
    }),
  };
}
