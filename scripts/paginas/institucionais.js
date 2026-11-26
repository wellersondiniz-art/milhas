// Páginas institucionais: Como funciona, Sobre os dados, Privacidade,
// Termos de uso e Contato.
//
// ATENÇÃO: estes textos ainda precisam ser revisados por um advogado antes de
// valer de vez. Enquanto REVISAO_JURIDICA_PENDENTE (config.js) for true, cada
// página mostra o aviso "Texto em revisão" no topo, fica fora do sitemap e
// pede aos buscadores para não listar.
//
// Regras para mexer nos textos:
//   - Escreva para o cliente, em português simples: "você" e "a gente".
//     Nada de linguagem de contrato ("o usuário declara", "fica vedado").
//   - Nada de promessa de ganho. Os números são estimativas.
//   - Só diga o que o site faz de verdade. Se o código mudar (métrica, link de
//     afiliado, canal de contato), estes textos mudam junto, e a data
//     TEXTOS_ATUALIZADOS_EM (config.js) também.
//   - Link de afiliado: Privacidade e Termos têm duas versões, escolhidas pelos
//     dados (temAfiliado). Enquanto nenhum link de dados/links.json tiver
//     parametro_afiliado preenchido, vale a versão "não recebemos nada".
//   - Milheiro, clube e bônus são explicados em "Palavras desta página".
//
// Funções puras: recebem a data e a URL base e devolvem os arquivos.

import { formatarData } from '../../site/js/motor/index.js';
import { AVISO_COMISSAO } from '../../site/js/saida/links.js';
import { EVENTOS, metricasLigadas } from '../../site/js/metricas/metricas.js';
import { REPORTE_LIGADO } from '../../site/js/reporte/config.js';
import {
  ALERTAS_LIGADO, EMAIL_DE_CONTATO, NOME_DO_SITE, RESPONSAVEL_PELOS_DADOS, REVISAO_JURIDICA_PENDENTE, TEXTOS_ATUALIZADOS_EM,
} from './config.js';
import { h, juntar, linkExterno } from './html.js';
import { configDoPlano } from './plano.js';
import { BENEFICIOS } from '../../servidor/plano/regras.js';
import { formatarCentavos } from '../../site/js/motor/formatar.js';
import { EXPLICAR_LIGADO } from '../../site/js/explicar/config.js';
import { alerta, documento, termosExplicados, urlAbsoluta } from './moldura.js';

const A_CONFIRMAR = 'A_CONFIRMAR';
const RAIZ = '../';
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

// ---------------------------------------------------------------------------
// Peças de texto

const p = (...filhos) => h('p', {}, ...filhos);
const lista = (itens) => h('ul', { class: 'pagina__lista' }, itens.map((item) => h('li', {}, item)));
const passos = (itens) => h('ol', { class: 'pagina__lista' }, itens.map((item) => h('li', {}, item)));
const forte = (texto) => h('strong', {}, texto);
const link = (pasta, texto) => h('a', { href: `${RAIZ}${pasta}` }, texto);

function secao(id, titulo, ...corpo) {
  return h('section', { class: 'pilha--sm', 'aria-labelledby': id },
    h('h2', { id, class: 'pagina__subtitulo' }, titulo),
    ...corpo);
}

const meuPerfil = () => link('#/perfil', 'Meu perfil');
const contato = (texto = 'Contato') => link('contato/', texto);
const termos = (texto = 'Termos de uso') => link('termos/', texto);
const sobreOsDados = (texto = 'Sobre os dados') => link('sobre-os-dados/', texto);
const privacidade = (texto = 'Privacidade') => link('privacidade/', texto);

// ---------------------------------------------------------------------------
// Como funciona

function comoFunciona(plano, explicarLigado) {
  return {
    pasta: 'como-funciona',
    titulo: 'Como funciona',
    descricao: `Como o ${NOME_DO_SITE} calcula quantos pontos e milhas uma compra rende, e o que fica de fora da conta.`,
    abertura: 'Você diz a loja e o valor da compra. A gente faz a conta e mostra qual jeito de pagar vale mais, em reais, mais ou menos, e quantos pontos ele rende. A gente compara em reais porque 1 ponto de um programa pode valer bem mais que 1 ponto de outro.',
    corpo: [
      secao('passo-a-passo', 'Passo a passo', passos([
        'Você escolhe a loja e digita quanto vai gastar.',
        'A gente olha as ofertas de pontos que estão valendo hoje nessa loja e os pontos que cada cartão dá.',
        juntar('Se você marcou os seus cartões e programas em ', meuPerfil(), ', a conta usa só o que é seu. Se não marcou, usamos todos os que conhecemos.'),
        'Para cada jeito de pagar (um programa de pontos com um cartão), somamos os pontos que a compra rende.',
        'Mostramos do jeito que rende mais para o que rende menos, com a conta aberta para você conferir.',
      ])),
      secao('de-onde-vem', 'De onde vêm os pontos',
        p('Uma compra pode render pontos de dois lugares:'),
        lista([
          juntar(forte('Da loja.'), ' Algumas lojas dão pontos de um programa para cada real gasto, durante uma oferta. Às vezes a oferta dá mais pontos para quem assina o clube do programa ou para quem paga com um cartão específico.'),
          juntar(forte('Do cartão.'), ' O cartão de crédito dá pontos pelo que você gasta nele. Muitos bancos contam isso em pontos por dólar, mesmo em compra no Brasil. Aí convertemos o valor da compra pela cotação do dólar.'),
        ]),
        p('Quando a regra da oferta diz que os pontos da loja e os do cartão se somam, a gente soma. Quando diz que não, ou quando não conseguimos confirmar, contamos só o maior dos dois. Assim a conta não mostra pontos a mais.')),
      secao('valor-em-reais', 'Quanto os pontos valem em reais',
        p('Pontos não são dinheiro. Para comparar, usamos o valor do milheiro, que é quanto valem 1.000 pontos, em média. Um exemplo com números inventados: se 1.000 pontos valessem R$ 20,00, uma compra que rende 2.000 pontos daria cerca de R$ 40,00 em pontos.'),
        p('Esse valor é uma estimativa. Na hora de usar, os pontos podem valer mais ou menos, dependendo do que você troca. Se você sabe quanto valem os seus pontos, troque o valor em ', meuPerfil(), '. Quando não temos o valor do milheiro de um programa, mostramos só os pontos.')),
      secao('fora-da-conta', 'O que fica fora da conta', lista([
        'Regras que ainda não conseguimos confirmar numa fonte oficial.',
        'Ofertas que já acabaram ou que ainda não começaram.',
        'Ofertas que a gente ainda não conhece.',
        'Bônus na transferência de pontos entre programas, cashback, frete, anuidade do cartão e o preço do produto em outras lojas.',
      ]), p('Mais detalhes em ', sobreOsDados(), '.')),
      secao('mesma-conta', 'A conta é sempre a mesma',
        explicarLigado
          ? p('A conta segue regras fixas, escritas no código do site, sem inteligência artificial e sem palpite. A mesma compra, no mesmo dia, dá sempre o mesmo resultado. O botão "Explica pra mim" usa inteligência artificial só para explicar em palavras um resultado que a conta já fez; ele não muda a conta.')
          : p('A conta segue regras fixas, escritas no código do site, sem inteligência artificial e sem palpite. A mesma compra, no mesmo dia, dá sempre o mesmo resultado.'),
        p('A ordem do resultado é pelo valor dos pontos em reais. Comissão de loja não entra na conta: a parte do site que faz a conta nem sabe quais lojas pagam comissão. Veja os ', termos(), '.'),
        explicarLigado
          ? p('E a conta é feita no seu próprio aparelho: o valor que você digita e os cartões que você marca ficam nele. A exceção é quando você toca em "Explica pra mim": aí a loja, o valor, o seu perfil e a sua pergunta vão para o nosso servidor e para a empresa de inteligência artificial que escreve a explicação. Veja ', privacidade(), '.')
          : p('E a conta é feita no seu próprio aparelho: o valor que você digita e os cartões que você marca não vão para nenhum servidor. Veja ', privacidade(), '.')),
      secao('nao-fazemos', 'O que a gente não faz', lista([
        plano.ligado
          ? 'A calculadora é de graça. O único pagamento é o plano opcional, que só dá mais alertas por e-mail e não muda a conta nem a ordem do resultado.'
          : 'Não vendemos nada e não cobramos nada.',
        'Não entramos na sua conta do banco, da loja ou do programa de pontos.',
        'Não creditamos pontos: quem credita é o programa, depois que a loja confirma a compra.',
        juntar('Não garantimos que os pontos vão cair. Confira as regras na loja antes de comprar (veja os ', termos(), ').'),
      ])),
    ],
  };
}

// ---------------------------------------------------------------------------
// Sobre os dados

function sobreDados() {
  return {
    pasta: 'sobre-os-dados',
    titulo: 'Sobre os dados',
    descricao: `De onde vêm as ofertas, os cartões e os programas do ${NOME_DO_SITE}, com que frequência conferimos e o que é estimativa.`,
    abertura: 'As regras que entram na conta (ofertas, pontos dos cartões e programas) vêm de páginas oficiais das lojas, dos bancos e dos programas de pontos. O valor do milheiro e a cotação do dólar são estimativas, explicadas abaixo. Cada dado tem o link da fonte e a data em que foi conferido.',
    corpo: [
      secao('origem', 'De onde vêm',
        p('A gente confere à mão, uma por uma, as páginas oficiais: o regulamento da oferta na loja ou no programa, a página do cartão no site do banco e a página do programa de pontos.'),
        p('Guardamos só os fatos: quantos pontos por real, de quando a quando, para quem vale, se precisa de cupom e quando os pontos caem. Não copiamos textos de outros sites.'),
        p('Na página de cada loja, cada oferta mostra a data em que foi conferida e o link "Ver a fonte". Assim você confere direto na origem.')),
      secao('nao-confirmado', 'O que ainda não confirmamos',
        p('Quando não achamos um dado numa fonte oficial, ele fica marcado como "não confirmado" e não entra na conta. Preferimos mostrar menos pontos a mostrar um número que não sabemos se é verdade.'),
        p('Por exemplo: se não sabemos se os pontos da loja se somam aos do cartão, contamos só o maior dos dois.')),
      secao('frequencia', 'Com que frequência atualizamos',
        p('Hoje a conferência é feita à mão e ainda não tem dia fixo. Por isso cada oferta mostra a data em que foi conferida.'),
        p('A lista de ofertas e as páginas das lojas são montadas de novo cada vez que o site é atualizado, e cada página diz a data da situação que mostra. Para não depender disso, a calculadora usa a data de hoje no horário de Brasília (o dia vira à meia-noite de Brasília):'),
        lista([
          'Oferta que já acabou sai da conta depois do último dia e fica no histórico da loja.',
          'Quando faltam 3 dias ou menos para a oferta acabar, ela ganha um selo de alerta.',
          'Quando um dado foi conferido há mais de 14 dias, a conta avisa que ele pode estar desatualizado.',
          'Oferta conferida há mais de 30 dias sai da conta até ser conferida de novo.',
        ])),
      secao('estimativas', 'O que é estimativa',
        p('Alguns números não são regra da loja nem do banco. São estimativas, e você pode trocar pelos seus em ', meuPerfil(), ':'),
        lista([
          juntar(forte('Valor do milheiro.'), ' É quanto valem 1.000 pontos em reais. Usamos um valor médio, com a fonte indicada. Na prática, depende de como você usa os pontos. Para alguns programas ainda não temos esse valor; nesses casos, mostramos só os pontos.'),
          juntar(forte('Cotação do dólar.'), ' Muitos cartões dão pontos por dólar gasto, mesmo em compra no Brasil. Para converter, usamos a cotação oficial do Banco Central (PTAX de venda) quando ela já foi conferida, ou a cotação que você informar. O banco do seu cartão pode usar outra cotação, então os pontos do cartão podem mudar um pouco. Sem nenhuma cotação, os pontos desse cartão ficam fora da conta, com um aviso.'),
          juntar(forte('Prazo para os pontos caírem.'), ' Mostramos o prazo que a regra da oferta informa. Quem credita os pontos é o programa.'),
        ]),
        p('Como a conta depende dessas estimativas e de regras que mudam, o resultado é uma ajuda para decidir, não uma garantia. Veja os ', termos(), '.')),
      secao('achou-erro', 'Achou um erro?',
        p('Se uma oferta estiver errada, vencida ou faltando, avise pela página de ', contato(), '. Se puder, mande o link da página oficial.')),
    ],
  };
}

// ---------------------------------------------------------------------------
// Privacidade

// Só entra quando o botão "Essa informação está errada?" está ligado
// (site/js/reporte/config.js). Diz o que a função /api/reportar guarda.
function secaoAvisos() {
  return secao('avisos', 'Quando você avisa de um erro',
    p('Em cada resultado há o botão "Essa informação está errada?". Se você mandar um aviso, a gente recebe só isto:'),
    lista([
      'a loja, a oferta, o programa e o cartão do resultado em que você tocou;',
      'o que você escreveu e o link que você colou;',
      'o seu e-mail, só se você quiser resposta.',
    ]),
    p('O aviso vira uma tarefa num repositório privado do GitHub, a ferramenta que a gente usa para organizar as correções. Só quem cuida do site vê. O GitHub guarda os dados nos Estados Unidos.'),
    p(forte('O e-mail é apagado quando a gente resolve o aviso, ou em até 90 dias, o que vier primeiro.'), ' Ele serve só para responder sobre o aviso.'),
    p('O texto e o link ficam guardados como histórico das correções. Por isso, não escreva dados pessoais no texto.'),
    p('Para evitar abuso, o servidor conta quantos avisos chegam de cada conexão. Para isso, usa um código embaralhado feito a partir do endereço de internet (IP), que some sozinho depois de uma hora. O IP não vai para o aviso.'),
    p('Quer apagar um aviso que você mandou? Fale com a gente em ', contato(), ', dizendo a loja e o dia.'));
}

// Só entra quando o botão "Explica pra mim" está ligado
// (site/js/explicar/config.js). Diz o que a função /api/explicar envia e
// guarda. REVISÃO JURÍDICA: texto novo, ainda não revisado pelo advogado.
function secaoExplicar() {
  return secao('explica-pra-mim', 'Quando você pede "Explica pra mim"',
    p('Embaixo do resultado há o botão "Explica pra mim", que escreve uma explicação do resultado em palavras simples. Ele é opcional. Só quando você toca nele, o seu aparelho manda para o nosso servidor:'),
    lista([
      'a loja e o valor da compra;',
      juntar('o que você marcou em ', meuPerfil(), ' (programas, clube, cartões pelo nome, milheiro e cotação do dólar), para o servidor refazer a mesma conta;'),
      'a pergunta que você escreveu, se escreveu.',
    ]),
    p('O nosso servidor refaz a conta e manda o resultado e a sua pergunta para a Anthropic, a empresa que faz o Claude, o modelo de inteligência artificial que escreve a explicação. A Anthropic fica nos Estados Unidos, então esse texto é processado fora do Brasil, conforme a ',
      h('a', { href: 'https://www.anthropic.com/legal/privacy', rel: 'noopener noreferrer' }, 'política de privacidade da Anthropic'), '. Não mandamos o seu IP nem nada que identifique você.'),
    p(forte('Não escreva dados pessoais na pergunta.'), ' Se a pergunta tiver algo parecido com número de cartão, CPF, telefone ou e-mail, o site nem envia.'),
    p('A gente não guarda a pergunta nem a explicação. Para limitar o uso por dia, o servidor guarda por 2 dias um código embaralhado feito a partir do endereço de internet (IP), com um contador. O IP em si não fica guardado.'));
}

/** O responsável pelos dados está preenchido em config.js? */
function responsavelDefinido(r) {
  return Boolean(r && typeof r.nome === 'string' && typeof r.documento === 'string' &&
    r.nome.trim() && r.documento.trim() && r.nome !== A_CONFIRMAR && r.documento !== A_CONFIRMAR);
}

function paginaPrivacidade({ temAfiliado, usaAwin, medindo, reporteLigado, alertas, plano, explicarLigado, responsavel, temEmail }) {
  return {
    pasta: 'privacidade',
    titulo: 'Privacidade',
    descricao: `O que o ${NOME_DO_SITE} guarda, onde guarda e o que nunca pede: sem número de cartão, sem CPF e sem cadastro.`,
    abertura: alertas
      ? 'Resumo: não pedimos número de cartão, CPF nem cadastro. O que você marca fica só no seu aparelho, a não ser que você peça um alerta por e-mail.'
      : explicarLigado
      ? 'Resumo: não pedimos número de cartão, CPF nem cadastro. O que você marca fica só no seu aparelho, a não ser que você peça uma explicação no "Explica pra mim".'
      : 'Resumo: não pedimos número de cartão, CPF nem cadastro. O que você marca fica só no seu aparelho.',
    corpo: [
      secao('nunca-pedimos', 'O que a gente nunca pede',
        lista([
          'Número do cartão, validade ou código de segurança.',
          'CPF, RG ou qualquer documento.',
          alertas
            ? 'Nome, telefone ou endereço para usar o site. O e-mail, só se você pedir um alerta (veja abaixo).'
            : 'Nome, e-mail, telefone ou endereço para usar o site.',
          'Senha ou login de banco, loja ou programa de pontos.',
        ]),
        p('Não há cadastro nem login. Você escolhe os cartões pelo nome, como "Cartão X Platinum", nunca pelo número. Se alguém pedir esses dados em nome do ', NOME_DO_SITE, ', não é a gente.')),
      secao('no-aparelho', 'O que fica no seu aparelho',
        p('Quando você usa ', meuPerfil(), ', o navegador guarda no próprio aparelho (no armazenamento local do navegador) só isto:'),
        lista([
          'os programas de pontos que você marcou, se você assina o clube de cada um e desde quando;',
          'os cartões que você marcou, pelo nome;',
          'o valor do milheiro, se você trocou o nosso pelo seu;',
          'a cotação do dólar, se você informou uma.',
        ]),
        alertas
          ? p('Esses dados não vão para nenhum servidor, nem para a gente, a não ser que você peça um alerta por e-mail (veja abaixo). A conta da calculadora é feita no seu aparelho. Por isso, se você trocar de celular ou de navegador, o perfil não vai junto (veja abaixo como levar).')
          : explicarLigado
          ? p('A conta é feita no seu aparelho. Esses dados só saem dele se você tocar em "Explica pra mim" (veja abaixo), e mesmo assim não ficam guardados. Se você trocar de celular ou de navegador, o perfil não vai junto (veja abaixo como levar).')
          : p('Esses dados não vão para nenhum servidor, nem para a gente. A conta é feita no seu aparelho. Por isso, se você trocar de celular ou de navegador, o perfil não vai junto (veja abaixo como levar).'),
        p('Em janela anônima, o perfil some quando você fecha a janela.')),
      alertas ? secaoDeAlertas() : null,
      plano.ligado ? secaoDoPlanoNaPrivacidade() : null,
      secao('sem-internet', 'Para funcionar sem internet',
        p('O site guarda no aparelho uma cópia das próprias páginas e da lista de ofertas, para a calculadora funcionar sem internet. Essa cópia não tem nada seu.')),
      secao('levar', 'Levar para outro aparelho',
        p('Em ', meuPerfil(), ', o botão "Exportar perfil" cria um arquivo com o que você marcou. O arquivo fica onde você salvar, e só você decide com quem compartilha. Ele tem só a lista do que você marcou e os valores que você informou, nada de número de cartão ou documento.'),
        p('"Importar perfil" lê esse arquivo no outro aparelho. A leitura também acontece só no aparelho.')),
      secao('apagar', 'Como apagar', lista([
        juntar('Em ', meuPerfil(), ', toque em "Apagar tudo". Some tudo o que você marcou neste aparelho.'),
        'Ou apague os dados do site nas configurações do navegador. Isso também tira a cópia usada sem internet.',
      ])),
      secao('app', 'No app para Android e iPhone',
        p('O app tem a mesma calculadora do site. O que você marca em ', meuPerfil(), ' fica só no celular, guardado no cofre do próprio sistema: no iPhone, nas Chaves (Keychain), só neste aparelho; no Android, criptografado com uma chave que não sai do aparelho. O perfil não entra no backup na nuvem e não passa para outro celular.'),
        p('Para mostrar as ofertas da semana, o app baixa deste site a mesma lista pública de lojas e ofertas que qualquer visitante vê. Esse pedido não leva nada do seu perfil nem cookie. Sem internet, o app usa a cópia da lista que veio com ele.'),
        p('O app não pede acesso a câmera, localização, contatos, fotos ou notificações, não mostra anúncios e não usa ferramenta de métrica. Os links para lojas abrem no navegador do celular, com as regras de privacidade de cada loja.'),
        p('Para apagar, toque em "Apagar tudo" em ', meuPerfil(), ' ou desinstale o app. No iPhone, o sistema pode manter os dados das Chaves depois de desinstalar; para ter certeza, use "Apagar tudo" antes.')),
      medindo ? secaoMetricas()
        : secao('cookies', 'Cookies, métricas e anúncios',
          p('O site não cria cookies. Hoje não usamos nenhuma ferramenta de métrica de visitas e não mostramos anúncios.'),
          p('Quando a gente passar a contar o uso do site, vai ser com o Plausible, uma ferramenta que não usa cookie e não identifica você. Antes disso, esta página vai dizer exatamente o que é contado.')),
      secao('hospedagem', 'Quem hospeda o site',
        p('O site fica hospedado na Cloudflare. Como em qualquer site, para entregar as páginas o servidor recebe dados técnicos de cada acesso, como o endereço de internet (IP) e o tipo de navegador. A gente não usa esses dados para saber quem você é. Veja também a ',
          h('a', { href: 'https://www.cloudflare.com/privacypolicy/', rel: 'noopener noreferrer' }, 'política de privacidade da Cloudflare'), '.')),
      secao('links-fora', 'Links para outros sites',
        p('Quando você abre a fonte de uma oferta ou a página de uma loja, vai para outro site, com regras de privacidade próprias. Os nossos links não contam para o outro site de qual página você veio.'),
        temAfiliado
          ? p('Alguns links para lojas são links de afiliado. Eles têm, logo abaixo, o aviso "', AVISO_COMISSAO, '" Esses links levam no endereço um código do ', NOME_DO_SITE, ', para a loja saber que a visita veio daqui. O código é o mesmo para todo mundo e não identifica você. No site dela, a loja pode guardar esse código num cookie dela, com as regras de privacidade dela.')
          : null,
        temAfiliado && usaAwin
          ? p('Alguns desses links passam antes, por um instante, pela Awin, a empresa que cuida do programa de afiliados de algumas lojas. A Awin registra o clique e leva você para o site da loja. Ela pode guardar um cookie dela, com as regras de privacidade dela, que estão no site da Awin.')
          : null,
        temAfiliado ? null
          : p('Hoje os links para as lojas são links comuns: não levam nenhum código nosso.')),
      reporteLigado ? secaoAvisos() : null,
      explicarLigado ? secaoExplicar() : null,
      secao('falar', 'Se você falar com a gente',
        p('Se você escrever pela página de ', contato(), ', a gente recebe o que você mandar, como o seu endereço de e-mail, e usa só para responder.')),
      secao('responsavel', 'Quem responde pelos seus dados',
        responsavelDefinido(responsavel)
          ? p(`Quem responde pelos dados tratados no ${NOME_DO_SITE} (o "controlador", como diz a Lei Geral de Proteção de Dados, a LGPD) é ${responsavel.nome}, ${responsavel.documento}.`)
          : alerta('aviso', '!', 'Falta informar quem responde pelos dados',
            p('Aqui vai aparecer o nome e o documento (CNPJ ou CPF) de quem responde pelos dados do site, o "controlador", como diz a Lei Geral de Proteção de Dados (LGPD). Essa informação entra antes do lançamento.')),
        p('Por que a gente pode tratar o pouco que recebe: os dados técnicos de acesso são usados para entregar e proteger o site (legítimo interesse, na LGPD), e o que você manda pelo Contato é usado para atender o seu pedido.')),
      secao('direitos', 'Os seus direitos',
        p('Pela LGPD, você pode pedir para:'),
        lista([
          'saber se a gente trata algum dado seu e ver quais são;',
          'corrigir um dado errado ou desatualizado;',
          'apagar dados seus;',
          'levar os seus dados para outro serviço;',
          'saber com quais empresas a gente compartilha dados;',
          'retirar uma permissão que você deu.',
        ]),
        p('Como o perfil fica só no seu aparelho, apagar e levar os dados você mesmo faz em ', meuPerfil(), ', sem pedir para ninguém. Para o resto, ',
          temEmail ? juntar('escreva pela página de ', contato(), '.') : juntar('o canal ainda está sendo preparado; quando estiver pronto, aparece na página de ', contato(), '.')),
        p('Você também pode reclamar na ', h('a', { href: 'https://www.gov.br/anpd/', rel: 'noopener noreferrer' }, 'Autoridade Nacional de Proteção de Dados (ANPD)'), '.')),
    ],
  };
}

/** Só aparece com ALERTAS_LIGADO: é quando o site passa a guardar um e-mail. */
function secaoDeAlertas() {
  return secao('alertas', 'Alertas por e-mail (só se você pedir)',
    p('Se você criar um ', link('alertas/', 'alerta de pontos por e-mail'), ', a gente guarda no servidor:'),
    lista([
      'o seu endereço de e-mail;',
      'o alerta: a loja, o programa (se você escolheu um) e quantos pontos por real você quer;',
      'uma cópia do seu perfil, só com os programas, se você assina o clube e desde quando, e os cartões pelo nome. Sem milheiro, sem cotação e nunca número de cartão;',
      'as datas dos últimos e-mails, para respeitar o limite de e-mails por semana.',
    ]),
    p('Para que serve: só para fazer a conta do alerta depois de cada atualização das ofertas e mandar o e-mail. Não vendemos, não emprestamos e não usamos o e-mail para propaganda.'),
    p('Duplo aceite: primeiro mandamos um link de confirmação. Sem o clique nesse link, não mandamos alerta nenhum. O link vale por 48 horas; depois disso, o pedido não confirmado é apagado na rodada semanal seguinte.'),
    p('A cópia do perfil, junto com o seu e-mail, diz quais cartões e clubes você tem. Por isso a tratamos como dado pessoal, com o mesmo cuidado do e-mail.'),
    p('Limites: no máximo 2 e-mails de alerta por semana. Cada e-mail vai só para você, nunca junto com o de outra pessoa.'),
    p('Contra abuso: para impedir que alguém use o formulário para mandar e-mail a desconhecidos, contamos quantos pedidos chegam de cada conexão por dia. Não guardamos o seu endereço de internet (IP): só um código embaralhado dele, que não dá para desfazer e é apagado em até uma semana.'),
    p('Cancelar: todo e-mail tem o link "Cancelar". Ao cancelar, apagamos do banco na hora o seu e-mail, os alertas e a cópia do perfil. Se houver cópias de segurança do banco, elas são cifradas e se apagam sozinhas em até 30 dias.'),
    p('Quem ajuda: os dados ficam no Supabase (banco de dados) e os e-mails saem pelo Resend (serviço de envio de e-mail). O registro de envios que guardamos não tem o seu e-mail: só a data, o tipo e se deu certo.'));
}

/** Só aparece com PLANO_LIGADO: quem assina deixa o e-mail com a gente. */
function secaoDoPlanoNaPrivacidade() {
  return secao('plano-pago', 'Plano pago (só se você assinar)',
    p('O pagamento é feito na página do Stripe, a empresa que processa o pagamento. O número do cartão, a validade e o código de segurança são digitados só lá: nunca passam pelo nosso site e nunca chegam até a gente. Para os dados do pagamento, vale a ', linkExterno('https://stripe.com/br/privacy', 'política de privacidade do Stripe'), '.'),
    p('Do Stripe, a gente recebe e guarda só:'),
    lista([
      'o seu e-mail, para saber que você assina e aumentar o limite dos seus alertas;',
      'os códigos do cliente e da assinatura no Stripe;',
      'a situação do plano (ativo, pagamento recusado, cancelado ou devolvido), a data do fim do mês pago e se houve contestação no cartão.',
    ]),
    p('Guardamos também os códigos dos avisos que o Stripe manda, sem dado pessoal, para não processar o mesmo aviso duas vezes.'),
    p('Por quanto tempo: enquanto o plano existir e depois, pelo prazo que a lei manda guardar registros de cobrança (em revisão; hoje previsto em 5 anos depois da última cobrança).'),
    p('Quem ajuda: o Stripe (pagamento, empresa com sede fora do Brasil) e o Supabase (banco de dados, servidor em São Paulo). A página de pagamento do Stripe pode usar cookies próprios; o nosso site continua sem cookies.'),
    p('Para ver, corrigir ou apagar os seus dados, fale com a gente em ', contato(), '. Apagar cancela o plano; os registros de cobrança que a lei manda guardar ficam pelo prazo dela.'));
}

/** Só aparece com PLANO_LIGADO. */
function secaoDoPlanoNosTermos(plano) {
  const preco = formatarCentavos(plano.precoCentavos);
  return secao('plano-pago', 'Plano pago',
    p('O plano pago é opcional. Ele dá mais alertas de pontos por e-mail (até ', String(BENEFICIOS.alertasPorEmail), ' alertas e até ', String(BENEFICIOS.alertasPorSemana), ' e-mails por semana). ', forte('Ele não muda a conta nem a ordem do resultado'), ': quem assina vê os mesmos pontos e o mesmo ranking de quem não assina.'),
    lista([
      `Preço: ${preco} por mês, com tributos, cobrado no início de cada mês de assinatura e renovado automaticamente. Veja a `,
      'Pagamento: na página do Stripe. A gente não vê nem guarda o número do cartão.',
      'Cancelar: quando quiser, pelo portal do Stripe (link na página do plano). O plano vale até o fim do mês já pago e não há nova cobrança.',
      'Arrependimento: nos primeiros 7 dias depois de assinar, devolvemos o valor inteiro, sem perguntas, e o plano acaba.',
      'Depois dos 7 dias, o mês em curso não é devolvido em parte. Cobrança em dobro ou erro nosso, devolvemos sempre.',
      'Pagamento recusado: o Stripe tenta de novo por alguns dias. Enquanto não der certo, os alertas voltam aos limites do grátis, sem multa.',
      'Se você contestar a cobrança com o banco do cartão: enquanto a contestação estiver aberta, o plano fica suspenso.',
      'Mudança de preço: avisamos por e-mail com 30 dias de antecedência. Vale só a partir da renovação seguinte, e você pode cancelar antes, sem custo.',
      'Fim do plano: se um dia o plano pago acabar, avisamos com 30 dias e devolvemos a parte não usada.',
      'Só para maiores de 18 anos.',
    ].map((item, i) => (i === 0 ? juntar(item, link('plano/', 'página do plano'), '.') : item))));
}

// ---------------------------------------------------------------------------
// Termos de uso

function paginaTermos(temAfiliado, plano, explicarLigado) {
  return {
    pasta: 'termos',
    titulo: 'Termos de uso',
    descricao: `As regras de uso do ${NOME_DO_SITE} em palavras simples: os números são estimativas, as regras mudam e vale o que a loja disser.`,
    abertura: `Em poucas palavras: o ${NOME_DO_SITE} faz uma conta para ajudar você a decidir. Quem decide as regras dos pontos são as lojas, os bancos e os programas. Confira sempre na loja antes de comprar.`,
    corpo: [
      secao('o-que-faz', 'O que o site faz',
        p(plano.ligado ? 'É uma calculadora gratuita, com um plano pago opcional que só dá mais alertas por e-mail. Você diz a loja e o valor,' : 'É uma calculadora gratuita. Você diz a loja e o valor, e o site estima quantos pontos a compra pode render em cada jeito de pagar e quanto isso vale em reais, em média. Não precisa de cadastro. Veja ', link('como-funciona/', 'Como funciona'), '.')),
      secao('estimativas', 'Os números são estimativas',
        p('A conta usa as regras que as lojas, os bancos e os programas publicaram, mais algumas estimativas, como o valor do milheiro e a cotação do dólar (veja ', sobreOsDados(), ').'),
        p('Por isso o resultado é uma estimativa. Os pontos que você vai receber de verdade podem ser diferentes, e o valor em reais depende de como você usar os pontos. Não prometemos ganho nenhum.')),
      secao('regras-mudam', 'As regras mudam',
        p('Lojas e programas mudam ofertas a qualquer hora: a oferta acaba antes, os pontos mudam, aparece uma exigência nova. A gente confere à mão e mostra a data da última conferência, mas pode acontecer de uma mudança ainda não estar aqui.')),
      secao('confira', 'Confira na loja antes de comprar',
        lista([
          'Abra a página da oferta na loja ou no programa e veja se ela ainda vale.',
          'Veja se precisa ativar a oferta, usar cupom, assinar o clube ou pagar com um cartão específico.',
          'Veja se o produto entra na oferta: às vezes ela só vale para o que a própria loja vende e entrega.',
        ]),
        p(forte('Se a loja ou o programa disserem uma coisa e o site disser outra, vale o que a loja e o programa disserem.'))),
      secao('quem-responde', 'Quem cuida dos seus pontos',
        p(`O ${NOME_DO_SITE} não é loja, banco nem programa de pontos. Não vendemos produtos, não emitimos cartão e não creditamos pontos. Se os pontos não caírem, quem resolve é o programa ou a loja. Se quiser, avise a gente também, para corrigirmos a informação.`)),
      secao('nao-e-conselho', 'Não é conselho financeiro',
        p('O site não diz se vale a pena fazer um cartão, assinar um clube ou comprar alguma coisa. Ele só compara pontos. Anuidade, juros e o preço do produto em outras lojas ficam por sua conta.')),
      plano.ligado ? secaoDoPlanoNosTermos(plano) : null,
      explicarLigado
        ? secao('explica-pra-mim', 'O "Explica pra mim"',
          p('O botão "Explica pra mim" mostra um texto automático, escrito por inteligência artificial a partir do resultado da calculadora. Ele não busca ofertas novas e não refaz a conta, mas pode errar ou se expressar mal.'),
          p(forte('Se a explicação disser uma coisa e o resultado disser outra, vale o resultado. E se a loja ou o programa disserem outra, vale o que eles disserem.')),
          p('A explicação não é conselho financeiro: ela não decide por você se vale assinar um clube, fazer um cartão ou comprar. Quando a resposta depende de algo que não está nos nossos dados, como o preço do clube, ela diz que não sabe.'),
          p('Use o botão só para perguntas sobre a conta. Há um limite de explicações por dia, e pedidos abusivos podem ser bloqueados.'))
        : null,
      secao('como-se-mantem', 'Como o site se mantém',
        plano.ligado ? p('O site se mantém com o plano pago opcional. Quem não assina usa a calculadora inteira, de graça.') : null,
        temAfiliado
          ? juntar(
            p('Alguns links para lojas são links de afiliado: se você comprar por eles, a loja pode pagar uma comissão ao site, sem custo extra para você. Esses links têm, logo abaixo, o aviso "', AVISO_COMISSAO, '" Os links sem esse aviso não rendem nada para a gente.'),
            p('Não recebemos de bancos nem de programas de pontos. Os nomes deles aparecem só para identificar cada um.'))
          : juntar(
            p('Hoje o site não ganha nada quando você compra: não usamos link de afiliado e não recebemos de lojas, bancos ou programas. Os nomes deles aparecem só para identificar cada um.'),
            p('Se um dia isso mudar, cada link de afiliado vai ter, logo abaixo, o aviso "', AVISO_COMISSAO, '" Os outros links continuam comuns.')),
        p('A comissão nunca muda a ordem do resultado: ela é sempre pelo valor dos pontos, e a parte do site que faz a conta nem sabe quais lojas pagam comissão.')),
      secao('mudancas', 'Mudanças neste texto',
        p('Se este texto mudar, a data no começo da página muda junto. Dúvidas? Fale com a gente em ', contato(), '.')),
    ],
  };
}

// ---------------------------------------------------------------------------
// Contato

function paginaContato(email, reporteLigado) {
  const temEmail = typeof email === 'string' && EMAIL.test(email);
  return {
    pasta: 'contato',
    titulo: 'Contato',
    descricao: `Como falar com o ${NOME_DO_SITE} para avisar de um erro, sugerir uma loja ou tirar uma dúvida.`,
    abertura: 'Achou um erro, quer sugerir uma loja ou tem uma dúvida? Fale com a gente.',
    corpo: [
      secao('canal', 'Como falar com a gente',
        temEmail
          ? p('Escreva para ', h('a', { href: `mailto:${email}` }, email), '.')
          : alerta('info', 'i', 'Canal de contato em preparação', p('Ainda estamos preparando o canal de contato. Assim que ele estiver pronto, o endereço aparece aqui.'))),
      secao('o-que-mandar', 'O que ajuda na mensagem', lista([
        reporteLigado
          ? 'Erro numa oferta: o mais rápido é o botão "Essa informação está errada?", embaixo de cada resultado. Por aqui, diga a loja e, se tiver, mande o link da página oficial.'
          : 'Erro numa oferta: diga a loja e, se tiver, mande o link da página oficial.',
        'Loja, cartão ou programa que falta: diga o nome.',
        'Dúvida sobre a conta: diga a loja e o valor que você usou.',
      ])),
      secao('nunca-mande', 'Nunca mande',
        p('Número de cartão, CPF, senha ou foto de documento. A gente nunca pede isso. Veja ', privacidade(), '.')),
      secao('pontos-nao-cairam', 'Os pontos não caíram?',
        p('A gente não tem acesso à sua conta no programa nem na loja. Se os pontos de uma compra não caíram, fale com o programa de pontos ou com a loja: só eles conseguem resolver.')),
    ],
    temEmail,
  };
}

// ---------------------------------------------------------------------------
// Montagem

function montar(pagina, { revisaoPendente, urlBase, atualizadoEm }) {
  const caminho = `${pagina.pasta}/`;
  const tituloCompleto = `${pagina.titulo} | ${NOME_DO_SITE}`;
  const aviso = revisaoPendente
    ? alerta('aviso', '!', 'Texto em revisão',
      p('Este texto ainda vai ser revisado por um advogado e pode mudar.'))
    : null;
  const conteudo = juntar(
    h('section', { class: 'pilha--sm' },
      h('h1', {}, pagina.titulo),
      h('p', { class: 'texto-suave texto-pequeno' }, `Texto de ${formatarData(atualizadoEm)}.`),
      aviso,
      h('p', { class: 'resposta' }, pagina.abertura)),
    ...pagina.corpo,
  );
  const url = urlAbsoluta(urlBase, caminho);
  const estruturados = {
    '@context': 'https://schema.org',
    '@type': pagina.pasta === 'contato' ? 'ContactPage' : 'WebPage',
    name: tituloCompleto,
    description: pagina.descricao,
    inLanguage: 'pt-BR',
    dateModified: atualizadoEm,
    ...(url ? { url } : {}),
  };
  return {
    caminho: `${caminho}index.html`,
    conteudo: documento({
      titulo: tituloCompleto,
      descricao: pagina.descricao,
      caminho,
      raiz: RAIZ,
      urlBase,
      atual: pagina.pasta,
      dadosEstruturados: estruturados,
      semIndexar: revisaoPendente,
      principal: juntar(conteudo, termosExplicados(conteudo)),
    }),
  };
}

// A lista do que é medido vem de EVENTOS (site/js/metricas/metricas.js):
// evento novo no código aparece aqui sozinho.
function secaoMetricas() {
  const itens = Object.values(EVENTOS).map(({ descricao }, i, todos) =>
    `${descricao[0].toUpperCase()}${descricao.slice(1)}${i === todos.length - 1 ? '.' : ';'}`);
  return secao('cookies', 'Cookies, métricas e anúncios',
    p('O site não cria cookies e não mostra anúncios.'),
    p('Para saber o que melhorar, contamos alguns usos do site com o Plausible, uma ferramenta de métricas que não usa cookie e não guarda dados pessoais. Contamos só isto:'),
    lista(itens),
    p('Nunca mandamos o valor da compra, os seus cartões, os seus programas, o texto que você digita nem nada do seu perfil. Cada aviso leva só o nome do que aconteceu, os itens da lista acima e o endereço da página, sem o que vem depois do "?".'),
    p('Para contar quantas pessoas usaram o site sem usar cookie, o Plausible recebe o endereço de internet (IP) e o tipo de navegador, mistura os dois com um código que muda todo dia e não guarda o IP. Assim dá para saber quantas pessoas foram num dia, mas não quem são, nem seguir alguém de um dia para o outro. Veja a ',
      h('a', { href: 'https://plausible.io/data-policy', rel: 'noopener noreferrer' }, 'política de dados do Plausible'), '.'),
    p('Se o seu navegador pede para não ser rastreado (as opções "Do Not Track" ou "Global Privacy Control"), o site não manda nada.'));
}

/** Pastas das páginas institucionais (cada uma vira <pasta>/index.html). */
export const PASTAS_INSTITUCIONAIS = ['como-funciona', 'sobre-os-dados', 'privacidade', 'termos', 'contato'];

/**
 * @param {object} opcoes
 *   urlBase          URL base já normalizada, ou null
 *   revisaoPendente  padrão: REVISAO_JURIDICA_PENDENTE (config.js)
 *   email            padrão: EMAIL_DE_CONTATO (config.js)
 *   responsavel      padrão: RESPONSAVEL_PELOS_DADOS (config.js), { nome, documento }
 *   atualizadoEm     padrão: TEXTOS_ATUALIZADOS_EM (config.js)
 *   temAfiliado      algum link de dados/links.json é de afiliado (siteTemLinkDeAfiliado)
 *   usaAwin          algum link passa pela Awin (siteUsaAwin)
 *   medindo          padrão: metricasLigadas() (site/js/metricas/config.js)
 *   reporteLigado    padrão: REPORTE_LIGADO (site/js/reporte/config.js)
 *   alertas          padrão: ALERTAS_LIGADO (config.js); muda a Privacidade
 *   plano            padrão: configDoPlano() (config.js); com ligado, muda Privacidade e Termos
 *   explicarLigado   padrão: EXPLICAR_LIGADO (site/js/explicar/config.js)
 * @returns {{ paginas: {caminho, conteudo}[], indexaveis: string[], avisos: string[] }}
 *   indexaveis: caminhos que entram no sitemap (nenhum enquanto a revisão estiver pendente).
 */
export function paginasInstitucionais({
  urlBase = null,
  revisaoPendente = REVISAO_JURIDICA_PENDENTE,
  email = EMAIL_DE_CONTATO,
  atualizadoEm = TEXTOS_ATUALIZADOS_EM,
  temAfiliado = false,
  usaAwin = false,
  medindo = metricasLigadas(),
  reporteLigado = REPORTE_LIGADO,
  alertas = ALERTAS_LIGADO,
  plano = configDoPlano(),
  explicarLigado = EXPLICAR_LIGADO,
  responsavel = RESPONSAVEL_PELOS_DADOS,
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(atualizadoEm ?? '')) throw new Error(`TEXTOS_ATUALIZADOS_EM precisa ser AAAA-MM-DD (recebido: ${atualizadoEm})`);
  const contatoPagina = paginaContato(email, reporteLigado);
  const todas = [comoFunciona(plano, explicarLigado), sobreDados(), paginaPrivacidade({ temAfiliado, usaAwin, medindo, reporteLigado, alertas, plano, explicarLigado, responsavel, temEmail: contatoPagina.temEmail }), paginaTermos(temAfiliado, plano, explicarLigado), contatoPagina];
  const opcoes = { revisaoPendente, urlBase, atualizadoEm };
  const avisos = [];
  if (revisaoPendente) {
    avisos.push('Páginas institucionais com REVISAO_JURIDICA_PENDENTE = true: aviso "Texto em revisão", noindex e fora do sitemap. Troque em scripts/paginas/config.js depois que um advogado revisar.');
  }
  if (email !== A_CONFIRMAR && !contatoPagina.temEmail) throw new Error(`EMAIL_DE_CONTATO inválido: ${email}`);
  if (temAfiliado) {
    avisos.push('Há link de afiliado em dados/links.json: Privacidade e Termos passaram a dizer isso. Se for a primeira vez, troque TEXTOS_ATUALIZADOS_EM em scripts/paginas/config.js.');
  }
  if (medindo) avisos.push('Métricas ligadas (site/js/metricas/config.js): a página Privacidade diz o que é medido. Se for a primeira vez, troque TEXTOS_ATUALIZADOS_EM em scripts/paginas/config.js.');
  if (!responsavelDefinido(responsavel)) {
    avisos.push('RESPONSAVEL_PELOS_DADOS A_CONFIRMAR: a Privacidade diz que falta informar quem responde pelos dados. Defina em scripts/paginas/config.js (com o advogado).');
  }
  if (!contatoPagina.temEmail) avisos.push('EMAIL_DE_CONTATO A_CONFIRMAR: a página Contato diz que o canal está em preparação. Defina em scripts/paginas/config.js.');
  return {
    paginas: todas.map((pagina) => montar(pagina, opcoes)),
    indexaveis: revisaoPendente ? [] : todas.map((pagina) => `${pagina.pasta}/`),
    avisos,
  };
}
