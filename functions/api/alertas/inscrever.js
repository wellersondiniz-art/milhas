// Cloudflare Pages Function: POST /api/alertas/inscrever (formulário de alertas).
// A lógica fica em servidor/alertas/ (testada com node --test).
import { dependencias } from '../../../servidor/alertas/cloudflare.js';
import { tratarInscricao } from '../../../servidor/alertas/pedido.js';

export function onRequest({ request, env }) {
  return tratarInscricao(request, dependencias(env, request));
}
