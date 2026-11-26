// Cloudflare Pages Function: POST /api/plano/stripe (avisos do Stripe).
// A lógica fica em servidor/plano/ (testada com node --test).
import { dependenciasDoPlano } from '../../../servidor/plano/cloudflare.js';
import { tratarWebhook } from '../../../servidor/plano/webhook.js';

export function onRequest({ request, env }) {
  return tratarWebhook(request, dependenciasDoPlano(env));
}
