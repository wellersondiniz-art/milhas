// Textos do modo app (PWA). Funções puras: recebem datas e devolvem palavras.

const dois = (n) => String(n).padStart(2, '0');

function diaLocal(data) {
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

/**
 * "de hoje, 10:30", "de ontem, 18:05" ou "de 20/11/2026, 09:00",
 * no fuso do aparelho. Devolve null se a data não der para ler.
 */
export function quandoForamSalvos(salvoEmIso, agora) {
  if (typeof salvoEmIso !== 'string') return null;
  const salvo = new Date(salvoEmIso);
  if (Number.isNaN(salvo.getTime())) return null;
  const hora = `${dois(salvo.getHours())}:${dois(salvo.getMinutes())}`;
  const ontem = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1);
  if (diaLocal(salvo) === diaLocal(agora)) return `de hoje, ${hora}`;
  if (diaLocal(salvo) === diaLocal(ontem)) return `de ontem, ${hora}`;
  return `de ${dois(salvo.getDate())}/${dois(salvo.getMonth() + 1)}/${salvo.getFullYear()}, ${hora}`;
}

/** Título e texto do aviso de sem internet. */
export function avisoSemInternet(salvoEmIso, agora) {
  const quando = quandoForamSalvos(salvoEmIso, agora);
  return {
    titulo: quando ? `Sem internet: dados ${quando}` : 'Sem internet',
    texto: 'A conta usa as ofertas guardadas neste aparelho. Elas podem ter mudado: confira antes de comprar.',
  };
}

/** A mais antiga de várias datas ISO (a cópia mais velha manda). Ignora as vazias. */
export function maisAntiga(datas) {
  const validas = datas.filter((d) => typeof d === 'string' && !Number.isNaN(new Date(d).getTime()));
  if (!validas.length) return null;
  return validas.reduce((a, b) => (new Date(a) <= new Date(b) ? a : b));
}
