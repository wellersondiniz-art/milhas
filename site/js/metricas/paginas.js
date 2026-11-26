// Métricas nas páginas geradas (lojas, ofertas e institucionais), que não têm
// outro JavaScript. Sem o Plausible configurado, não faz nada.
import {
  criarMetricas, lojaDoCaminho, observarCliquesDeSaida, observarInstalacao, observarOfertasVencidas, paginaDoCaminho,
} from './metricas.js';

const metricas = criarMetricas();
if (metricas.ligada) {
  const caminho = location.pathname;
  const pagina = paginaDoCaminho(caminho);
  const loja = lojaDoCaminho(caminho);
  if (loja) metricas.registrar('busca_loja', { loja, origem: 'pagina-da-loja' });
  observarCliquesDeSaida({ metricas, pagina, loja: () => loja });
  observarInstalacao({ metricas });
  observarOfertasVencidas({ metricas, pagina, loja });
}
