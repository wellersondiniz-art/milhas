// Cloudflare Pages Function: GET e POST /api/alertas/confirmar (link do e-mail de confirmação).
import { dependencias } from '../../../servidor/alertas/cloudflare.js';
import { tratarConfirmar } from '../../../servidor/alertas/pedido.js';

export function onRequest({ request, env }) {
  return tratarConfirmar(request, dependencias(env, request));
}
