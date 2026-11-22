// Tela "Meu perfil": programas (com clube e data), cartões e, se a pessoa
// quiser, o valor do milheiro de cada programa e a cotação do dólar. Salva sozinho, só neste
// aparelho. Também exporta, importa e apaga o perfil.
//
// Nenhum texto vindo do arquivo importado vira HTML: tudo entra por el()
// (createElement + nó de texto). Ver CLAUDE.md, seção 6.

import { ID_COTACAO_DOLAR, formatarCentavos, formatarCotacao, formatarData } from '../motor/index.js';
import {
  MILHEIRO_MAXIMO, TAMANHO_MAXIMO, ehVazio, nomeDoArquivo, perfilVazio, semNadaParaGuardar,
  textoParaExportar, validarImportacao,
} from '../perfil/formato.js';
import { el } from './dom.js';
import { aplicarMascara, mascaraCotacao } from './moeda.js';
import { alerta, termo } from './resultado.js';

const A_CONFIRMAR = 'A_CONFIRMAR';
const DIGITOS_MILHEIRO = String(MILHEIRO_MAXIMO).length;

function mascaraMilheiro(texto) {
  return aplicarMascara(String(texto ?? '').replace(/\D/g, '').slice(0, DIGITOS_MILHEIRO));
}

/** O cartão entra na conta? Pontos por real, ou pontos por dólar com cotação. */
function rendePorDolar(cartao) {
  return typeof cartao.pontos_por_real !== 'number' && typeof cartao.pontos_por_dolar === 'number';
}

function plural(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "2 programas (1 com clube) e 3 cartões" */
export function resumoDoPerfil(perfil) {
  const clubes = perfil.programas.filter((p) => p.clube_ativo).length;
  const programas = plural(perfil.programas.length, 'programa', 'programas');
  const comClube = clubes ? ` (${clubes} com clube)` : '';
  return `${programas}${comClube} e ${plural(perfil.cartoes.length, 'cartão', 'cartões')}`;
}

/**
 * @param {object} opcoes
 * @param {object} opcoes.elementos   { formulario, aviso, status, exportar, importar, arquivo, resultadoImportacao, apagar, confirmarApagar, simApagar, naoApagar }
 * @param {object} opcoes.dados       { programas, cartoes }
 * @param {() => string} opcoes.hoje  "AAAA-MM-DD" no relógio do aparelho
 * @param {() => object|null} opcoes.obterPerfil
 * @param {(perfil: object|null) => { salvou: boolean, emMemoria: boolean }} opcoes.definirPerfil
 */
export function montarTelaPerfil({ elementos, dados, hoje, obterPerfil, definirPerfil }) {
  const {
    formulario, aviso, status, exportar, importar, arquivo, resultadoImportacao,
    apagar, confirmarApagar, simApagar, naoApagar,
  } = elementos;
  const nomePrograma = new Map(dados.programas.map((p) => [p.id, p.nome]));
  let campos = [];
  let caixasCartao = [];
  let campoCotacao = null;

  function mostrarAvisoMemoria(emMemoria) {
    aviso.replaceChildren(emMemoria
      ? alerta('aviso', 'Este navegador não deixa guardar dados',
        el('p', {}, 'Pode ser o modo privado ou o armazenamento cheio. O que você marcar vale só enquanto esta aba estiver aberta. Para não perder, use "Exportar perfil" antes de fechar.'))
      : null);
    aviso.hidden = !emMemoria;
  }

  function blocoPrograma(programa, atual, milheiroCentavos) {
    const base = `perfil-${programa.id}`;
    const tem = el('input', { type: 'checkbox', id: `${base}-tem`, checked: Boolean(atual) });
    const clube = el('input', { type: 'checkbox', id: `${base}-clube`, checked: atual?.clube_ativo === true });
    const desde = el('input', {
      type: 'date', id: `${base}-desde`, class: 'campo__entrada', max: hoje(),
      value: atual?.clube_ativo_desde ?? null, 'aria-describedby': `${base}-desde-ajuda ${base}-desde-erro`,
    });
    const erroDesde = el('span', { class: 'campo__erro', id: `${base}-desde-erro` });
    const milheiro = el('input', {
      type: 'text', id: `${base}-milheiro`, class: 'campo__entrada', inputmode: 'numeric', autocomplete: 'off',
      placeholder: '0,00', value: milheiroCentavos ? mascaraMilheiro(String(milheiroCentavos)).texto : null,
      'aria-describedby': `${base}-milheiro-ajuda`,
    });
    milheiro.addEventListener('input', () => { milheiro.value = mascaraMilheiro(milheiro.value).texto; });

    const doCadastro = Number.isSafeInteger(programa.valor_milheiro_brl) ? programa.valor_milheiro_brl : null;
    const campoDesde = el('div', { class: 'campo', hidden: !(atual?.clube_ativo) },
      el('label', { class: 'campo__rotulo', for: desde.id }, 'Desde quando o clube está ativo?'),
      desde,
      el('span', { class: 'campo__ajuda', id: `${base}-desde-ajuda` },
        'Opcional. Algumas ofertas só valem se o clube estiver ativo há pelo menos 24 horas. Sem a data, essas ofertas ficam de fora da conta.'),
      erroDesde);
    const detalhes = el('div', { class: 'perfil__detalhes pilha--sm', hidden: !atual },
      el('label', { class: 'opcao' }, clube, `Assino o clube ${programa.nome}`),
      campoDesde,
      el('div', { class: 'campo' },
        el('label', { class: 'campo__rotulo', for: milheiro.id }, `Quanto vale o milheiro ${programa.nome} para você?`),
        el('div', { class: 'campo__moeda' }, milheiro),
        el('span', { class: 'campo__ajuda', id: `${base}-milheiro-ajuda` },
          doCadastro
            ? `Opcional. Se deixar em branco, usamos ${formatarCentavos(doCadastro)}, a média do nosso cadastro.`
            : 'Opcional. Ainda não temos esse valor confirmado. Se você informar, mostramos quanto os pontos valem em reais.')),
    );
    tem.addEventListener('change', () => { detalhes.hidden = !tem.checked; });
    clube.addEventListener('change', () => { campoDesde.hidden = !clube.checked; });
    campos.push({ programa, tem, clube, desde, erroDesde, milheiro });
    return el('div', { class: 'perfil__programa' },
      el('label', { class: 'opcao perfil__nome' }, tem, programa.nome), detalhes);
  }

  function blocoCartao(cartao, marcado) {
    const caixa = el('input', { type: 'checkbox', id: `perfil-cartao-${cartao.id}`, value: cartao.id, checked: marcado });
    const confirmado = cartao.status !== A_CONFIRMAR;
    const porDolar = confirmado && rendePorDolar(cartao);
    const semPontos = !confirmado || (!porDolar && typeof cartao.pontos_por_real !== 'number');
    const nota = semPontos ? ' (pontos ainda não confirmados)' : porDolar ? ' (pontos por dólar)' : '';
    caixasCartao.push(caixa);
    return el('label', { class: 'opcao' }, caixa,
      el('span', {}, cartao.nome,
        el('span', { class: 'texto-suave texto-pequeno perfil__nota' },
          ` · junta ${nomePrograma.get(cartao.programa_id) ?? 'pontos'}${nota}`)));
  }

  function blocoCotacao(valorDoPerfil) {
    campoCotacao = el('input', {
      type: 'text', id: 'perfil-cotacao-dolar', class: 'campo__entrada', inputmode: 'numeric', autocomplete: 'off',
      placeholder: '0,0000', value: valorDoPerfil ? mascaraCotacao(String(valorDoPerfil)).texto : null,
      'aria-describedby': 'perfil-cotacao-dolar-ajuda',
    });
    campoCotacao.addEventListener('input', () => { campoCotacao.value = mascaraCotacao(campoCotacao.value).texto; });
    const registro = (dados.cambio ?? []).find((c) => c.id === ID_COTACAO_DOLAR);
    const doCadastro = Number.isSafeInteger(registro?.reais_por_dolar) ? registro.reais_por_dolar : null;
    const dia = registro && registro.data_referencia !== A_CONFIRMAR ? ` de ${formatarData(registro.data_referencia)}` : '';
    return el('fieldset', { class: 'grupo pilha--sm' },
      el('legend', { class: 'perfil__legenda' }, 'Cotação do dólar'),
      el('div', { class: 'campo' },
        el('label', { class: 'campo__rotulo', for: campoCotacao.id }, 'Quanto vale 1 dólar, em reais?'),
        el('div', { class: 'campo__moeda' }, campoCotacao),
        el('span', { class: 'campo__ajuda', id: 'perfil-cotacao-dolar-ajuda' },
          'Os bancos dizem quantos pontos o cartão dá por dólar gasto, mesmo em compras em reais. Usamos a cotação para converter. ',
          doCadastro
            ? `Opcional. Se deixar em branco, usamos ${formatarCotacao(doCadastro)}, a PTAX do Banco Central${dia}.`
            : 'Ainda não temos a cotação do dia confirmada. Se você informar, os cartões que rendem pontos por dólar entram na conta.')));
  }

  /** Monta o formulário a partir do perfil (na abertura, depois de importar e de apagar). */
  function desenhar() {
    const perfil = obterPerfil() ?? perfilVazio();
    const doPrograma = new Map(perfil.programas.map((p) => [p.programa_id, p]));
    campos = [];
    caixasCartao = [];
    formulario.replaceChildren(
      el('fieldset', { class: 'grupo pilha--sm' },
        el('legend', { class: 'perfil__legenda' }, 'Programas de pontos em que você tem conta'),
        el('div', { class: 'pilha--sm perfil__termos' }, termo('clube'), termo('milheiro')),
        dados.programas.map((p) => blocoPrograma(p, doPrograma.get(p.id), perfil.valor_milheiro_brl[p.id]))),
      el('fieldset', { class: 'grupo' },
        el('legend', { class: 'perfil__legenda' }, 'Cartões de crédito que você usa'),
        dados.cartoes.length
          ? dados.cartoes.map((c) => blocoCartao(c, perfil.cartoes.includes(c.id)))
          : el('p', { class: 'texto-suave' }, 'Ainda não temos cartões no cadastro.')),
      blocoCotacao(perfil.cotacao_dolar),
    );
  }

  function lerFormulario() {
    const novo = perfilVazio();
    const limite = hoje();
    for (const c of campos) {
      c.erroDesde.textContent = '';
      c.desde.removeAttribute('aria-invalid');
      if (!c.tem.checked) continue;
      const item = { programa_id: c.programa.id, clube_ativo: c.clube.checked };
      if (c.clube.checked && c.desde.value) {
        if (c.desde.value > limite) {
          c.erroDesde.textContent = 'A data não pode ser depois de hoje. Ela não foi salva.';
          c.desde.setAttribute('aria-invalid', 'true');
        } else {
          item.clube_ativo_desde = c.desde.value;
        }
      }
      novo.programas.push(item);
      const { centavos } = mascaraMilheiro(c.milheiro.value);
      if (centavos) novo.valor_milheiro_brl[c.programa.id] = centavos;
    }
    novo.cartoes = caixasCartao.filter((c) => c.checked).map((c) => c.value);
    const { valor } = mascaraCotacao(campoCotacao?.value);
    if (valor) novo.cotacao_dolar = valor;
    return novo;
  }

  function avisarSalvo({ emMemoria }, texto) {
    mostrarAvisoMemoria(emMemoria);
    status.textContent = emMemoria ? `${texto} Vale só enquanto esta aba estiver aberta.` : texto;
  }

  formulario.addEventListener('submit', (evento) => evento.preventDefault());
  formulario.addEventListener('change', () => {
    const novo = lerFormulario();
    const r = definirPerfil(semNadaParaGuardar(novo) ? null : novo);
    avisarSalvo(r, ehVazio(novo) ? 'Nada marcado. A conta usa todos os cartões e programas.' : 'Salvo neste aparelho.');
  });

  // Exportar ------------------------------------------------------------------

  exportar.addEventListener('click', () => {
    const texto = textoParaExportar(obterPerfil(), new Date().toISOString());
    const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
    const link = el('a', { href: url, download: nomeDoArquivo(hoje()), hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Arquivo do perfil baixado. Guarde onde for fácil achar.';
  });

  // Importar ------------------------------------------------------------------

  function mostrarImportacao(tipo, titulo, ...corpo) {
    const caixa = alerta(tipo, titulo, ...corpo);
    caixa.setAttribute('tabindex', '-1');
    resultadoImportacao.replaceChildren(caixa);
    caixa.focus();
  }

  importar.addEventListener('click', () => arquivo.click());
  arquivo.addEventListener('change', async () => {
    const escolhido = arquivo.files?.[0];
    arquivo.value = '';
    if (!escolhido) return;
    let r;
    if (escolhido.size > TAMANHO_MAXIMO * 4) {
      r = { ok: false, erros: ['O arquivo é grande demais para ser um perfil.'] };
    } else {
      let texto = '';
      try { texto = await escolhido.text(); } catch { texto = ''; }
      r = validarImportacao(texto, dados, hoje());
    }
    if (!r.ok) {
      mostrarImportacao('perigo', 'Não importamos esse arquivo',
        el('p', {}, 'Nada foi mudado no seu perfil. O que encontramos:'),
        el('ul', { class: 'resultado__lista' }, r.erros.map((t) => el('li', {}, t))));
      return;
    }
    const salvo = definirPerfil(semNadaParaGuardar(r.perfil) ? null : r.perfil);
    desenhar();
    avisarSalvo(salvo, 'Perfil importado.');
    mostrarImportacao('sucesso', 'Perfil importado',
      el('p', {}, `Agora o seu perfil tem ${resumoDoPerfil(r.perfil)}. Ele substituiu o que estava marcado antes.`));
  });

  // Apagar tudo ----------------------------------------------------------------

  apagar.addEventListener('click', () => {
    confirmarApagar.hidden = false;
    apagar.setAttribute('aria-expanded', 'true');
    naoApagar.focus();
  });
  naoApagar.addEventListener('click', () => {
    confirmarApagar.hidden = true;
    apagar.setAttribute('aria-expanded', 'false');
    apagar.focus();
  });
  simApagar.addEventListener('click', () => {
    const r = definirPerfil(null);
    desenhar();
    resultadoImportacao.replaceChildren();
    confirmarApagar.hidden = true;
    apagar.setAttribute('aria-expanded', 'false');
    avisarSalvo(r, 'Tudo apagado deste aparelho. A conta volta a usar todos os cartões e programas.');
    apagar.focus();
  });

  return {
    /** Redesenha com o perfil atual (ao abrir a tela). */
    abrir(emMemoria) {
      desenhar();
      mostrarAvisoMemoria(emMemoria);
      confirmarApagar.hidden = true;
      apagar.setAttribute('aria-expanded', 'false');
    },
  };
}
