// Cloudflare Pages Function: GET e POST /api/alertas/cancelar (link de cancelar de todo e-mail).
import { dependencias } from '../../../servidor/alertas/cloudflare.js';
import { tratarCancelar } from '../../../servidor/alertas/pedido.js';

export function onRequest({ request, env }) {
  return tratarCancelar(request, dependencias(env, request));
}
