-- Testes da migração do plano pago. Rodam num Postgres local, nunca no
-- projeto do Supabase:
--   bash supabase/testes/rodar-local.sh      (Docker, postgres:17)
-- Cada bloco levanta erro se a regra não valer; no fim imprime "PLANO CERTO".

\set ON_ERROR_STOP on
begin;

set local role service_role;
insert into public.plano_assinaturas (stripe_assinatura_id, stripe_cliente_id, email, situacao, fim_do_periodo, evento_criado_em)
values ('sub_A1', 'cus_A1', 'pessoa.a@exemplo.com.br', 'ativa', now() + interval '20 days', now());
insert into public.plano_eventos (stripe_evento_id, tipo) values ('evt_1', 'invoice.paid');
reset role;

-- 1. Pela chave pública (anon) e por quem tem conta (authenticated): nada.
do $$
declare papel text; tabela text;
begin
  foreach papel in array array['anon', 'authenticated'] loop
    foreach tabela in array array['plano_assinaturas', 'plano_eventos'] loop
      begin
        execute format('set local role %I', papel);
        execute format('select count(*) from public.%I', tabela);
        raise exception 'FALHOU: % conseguiu ler %', papel, tabela;
      exception when insufficient_privilege then null;
      end;
      reset role;
      begin
        execute format('set local role %I', papel);
        execute format('delete from public.%I', tabela);
        raise exception 'FALHOU: % conseguiu apagar em %', papel, tabela;
      exception when insufficient_privilege then null;
      end;
      reset role;
    end loop;
    begin
      execute format('set local role %I', papel);
      perform public.plano_ativo('pessoa.a@exemplo.com.br');
      raise exception 'FALHOU: % conseguiu perguntar pelo plano', papel;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
end $$;

-- 2. Nem o servidor apaga linhas de plano (registro de cobrança fica).
do $$
begin
  set local role service_role;
  begin
    delete from public.plano_assinaturas;
    raise exception 'FALHOU: service_role apagou plano';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- 3. Restrições: e-mail limpo, ids do Stripe, situação, reembolso com data, evento único.
do $$
begin
  begin
    insert into public.plano_assinaturas (stripe_assinatura_id, stripe_cliente_id, email, situacao, evento_criado_em)
    values ('sub_B', 'cus_B', 'Maiuscula@Exemplo.com', 'ativa', now());
    raise exception 'FALHOU: aceitou e-mail sem normalizar';
  exception when check_violation then null;
  end;
  begin
    insert into public.plano_assinaturas (stripe_assinatura_id, stripe_cliente_id, email, situacao, evento_criado_em)
    values ('card_1abc', 'cus_B', 'b@exemplo.com', 'ativa', now());
    raise exception 'FALHOU: aceitou id que não é do Stripe';
  exception when check_violation then null;
  end;
  begin
    insert into public.plano_assinaturas (stripe_assinatura_id, stripe_cliente_id, email, situacao, evento_criado_em)
    values ('sub_B', 'cus_B', 'b@exemplo.com', 'gratis', now());
    raise exception 'FALHOU: aceitou situação inventada';
  exception when check_violation then null;
  end;
  begin
    insert into public.plano_assinaturas (stripe_assinatura_id, stripe_cliente_id, email, situacao, evento_criado_em)
    values ('sub_B', 'cus_B', 'b@exemplo.com', 'reembolsada', now());
    raise exception 'FALHOU: reembolsada sem data';
  exception when check_violation then null;
  end;
  begin
    insert into public.plano_eventos (stripe_evento_id, tipo) values ('evt_1', 'invoice.paid');
    raise exception 'FALHOU: mesmo evento duas vezes';
  exception when unique_violation then null;
  end;
end $$;

-- 4. plano_ativo: mesma regra de servidor/plano/regras.js (temBeneficio).
do $$
begin
  if not public.plano_ativo(' Pessoa.A@Exemplo.com.br ') then raise exception 'FALHOU: ativa não deu plano'; end if;
  update public.plano_assinaturas set contestada = true where stripe_assinatura_id = 'sub_A1';
  if public.plano_ativo('pessoa.a@exemplo.com.br') then raise exception 'FALHOU: contestada deu plano'; end if;
  update public.plano_assinaturas set contestada = false, fim_do_periodo = now() - interval '1 minute' where stripe_assinatura_id = 'sub_A1';
  if public.plano_ativo('pessoa.a@exemplo.com.br') then raise exception 'FALHOU: período vencido deu plano'; end if;
  update public.plano_assinaturas set situacao = 'falhou', fim_do_periodo = now() + interval '20 days' where stripe_assinatura_id = 'sub_A1';
  if public.plano_ativo('pessoa.a@exemplo.com.br') then raise exception 'FALHOU: pagamento recusado deu plano'; end if;
  update public.plano_assinaturas set situacao = 'ativa' where stripe_assinatura_id = 'sub_A1';
  if public.plano_ativo('outra@exemplo.com.br') then raise exception 'FALHOU: plano de outra pessoa'; end if;
end $$;

-- 5. Limite de alertas no banco: 10 no grátis, 50 com o plano.
insert into public.alertas_inscricoes (id, email, perfil, confirmado_em) values
  ('b0000000-0000-4000-8000-00000000000a', 'pessoa.a@exemplo.com.br', '{"programas":[],"cartoes":[]}', now()),
  ('b0000000-0000-4000-8000-00000000000b', 'gratis@exemplo.com.br', '{"programas":[],"cartoes":[]}', now());
do $$
declare i integer;
begin
  for i in 1..10 loop
    insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos) values ('b0000000-0000-4000-8000-00000000000b', 'loja-' || chr(96 + i), 100);
  end loop;
  begin
    insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos) values ('b0000000-0000-4000-8000-00000000000b', 'loja-extra', 100);
    raise exception 'FALHOU: grátis passou de 10';
  exception when check_violation then null;
  end;
  for i in 1..50 loop
    insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos) values ('b0000000-0000-4000-8000-00000000000a', 'loja-' || i::text || 'x', 100);
  end loop;
  begin
    insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos) values ('b0000000-0000-4000-8000-00000000000a', 'loja-extra', 100);
    raise exception 'FALHOU: plano passou de 50';
  exception when check_violation then null;
  end;
end $$;

-- 6. RLS ligada e forçada, sem política.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('plano_assinaturas', 'plano_eventos')
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then raise exception 'FALHOU: RLS desligada'; end if;
  if exists (select 1 from pg_policies where tablename like 'plano\_%') then
    raise exception 'FALHOU: há política nas tabelas do plano';
  end if;
end $$;

rollback;
\echo PLANO CERTO
