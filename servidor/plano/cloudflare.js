// Liga o webhook do plano ao ambiente da Cloudflare Pages.
// Configuração (README, seção "Plano pago"), só no ambiente Production:
//   SUPABASE_URL           variável (a mesma dos alertas)
//   SUPABASE_SECRET_KEY    segredo (a mesma dos alertas)
//   STRIPE_SECRET_KEY      segredo: chave restrita do Stripe (rk_test_... no modo de teste)
//   STRIPE_WEBHOOK_SECRET  segredo: whsec_... do endpoint /api/plano/stripe
//   PLANO_MODO_REAL        variável: só "ligado" aceita chave e eventos reais.
//                          Deixe sem definir até o dono aprovar.
// Sem qualquer um deles, o webhook responde 503 e nada é gravado.

import { repositorioDoPlano } from './supabase.js';
import { clienteStripe } from './stripe.js';

export function modoReal(env) {
  return env.PLANO_MODO_REAL === 'ligado';
}

export function dependenciasDoPlano(env) {
  const real = modoReal(env);
  return {
    repo: repositorioDoPlano({ url: env.SUPABASE_URL, chave: env.SUPABASE_SECRET_KEY }),
    stripe: clienteStripe({ chave: env.STRIPE_SECRET_KEY, modoReal: real }),
    segredo: env.STRIPE_WEBHOOK_SECRET ?? '',
    modoReal: real,
    agora: () => new Date(),
  };
}
