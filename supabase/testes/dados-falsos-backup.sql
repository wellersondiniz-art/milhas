-- Dados FALSOS para o teste de restauração (scripts/operacao/backup/teste-local.sh).
-- Só roda num Postgres descartável. E-mails em exemplo.invalid (domínio que
-- não existe). Tabelas de migrações que ainda não estão na main (alertas,
-- plano) só recebem dados se existirem.

insert into public.operacao_erros (origem, rota, status, tipo, mensagem, local, criado_em)
select 'alertas', '/api/alertas/inscrever', 500, 'TypeError', 'Cannot read properties of undefined (reading ''x'')', 'pedido.js:120', now() - (g || ' hours')::interval
from generate_series(1, 40) g;
insert into public.operacao_erros (origem, rota, status, tipo, mensagem) values
  ('explicar', '/api/explicar', 502, 'resposta', ''),
  ('reportar', '/api/reportar', 500, 'Error', 'GitHub: POST /issues respondeu 422');

do $$
begin
  if to_regclass('public.alertas_inscricoes') is not null then
    insert into public.alertas_inscricoes (email, perfil, confirmado_em)
    select format('pessoa%s@exemplo.invalid', g),
           jsonb_build_object('programas', jsonb_build_array('livelo'), 'cartoes', jsonb_build_array('cartao-exemplo')),
           now() - (g || ' days')::interval
    from generate_series(1, 25) g;
    insert into public.alertas_email (inscricao_id, loja_id, programa_id, minimo_centesimos)
    select id, 'magalu', 'livelo', 250 from public.alertas_inscricoes;
    insert into public.alertas_envios (tipo, resultado, quantidade_alertas, status_http)
    select 'alerta', 'enviado', 1, 200 from generate_series(1, 60);
  end if;
  if to_regclass('public.plano_assinaturas') is not null then
    insert into public.plano_assinaturas (stripe_assinatura_id, stripe_cliente_id, email, situacao, evento_criado_em)
    select format('sub_teste%s', g), format('cus_teste%s', g), format('assinante%s@exemplo.invalid', g), 'ativa', now()
    from generate_series(1, 5) g;
    insert into public.plano_eventos (stripe_evento_id, tipo)
    select format('evt_teste%s', g), 'customer.subscription.updated' from generate_series(1, 5) g;
  end if;
end
$$;
