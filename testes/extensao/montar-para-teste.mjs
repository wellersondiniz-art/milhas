// Monta a extensão para os testes: dados falsos e seletores das lojas de exemplo.
import { montarExtensao } from '../../scripts/extensao/montar.js';

export const PACOTE_DE_TESTE = new URL('./pacote/', import.meta.url);

export default async function montarParaTeste() {
  await montarExtensao({
    dados: new URL('../navegador/dados-de-teste/', import.meta.url),
    seletores: new URL('./seletores-de-teste.json', import.meta.url),
    saida: PACOTE_DE_TESTE,
  });
}
