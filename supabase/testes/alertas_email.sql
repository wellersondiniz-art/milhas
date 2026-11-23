-- Testes da migração dos alertas por e-mail. Rodam num Postgres local, nunca
-- no projeto do Supabase:
--   bash supabase/testes/rodar-local.sh      (Docker, postgres:17)
-- Cada bloco levanta erro se a regra não valer; no fim imprime "TUDO CERTO".

\set ON_ERROR_STOP on
begin;

-- Dados de exemplo (como service_role, que é quem o servidor usa).
set local role service_role;
insert into public.alertas_inscricoes (id, email, perfil, confirmado_em)
values ('a0000000-0000-4000-8000-00000000000a', 'pessoa.a@exemplo.com.br',
        '{"programas":[{"programa_id":"azul-fidelidade","clube_ativo":true,"clube_ativo_desde":"2026-10-01"}],"cartoes":["azul-itau-infinite"]}', now());
insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos)
values ('a0000000-0000-4000-8000-00000000000a', 'magalu', 1000);
insert into public.alertas_envios (tipo, resultado, quantidade_alertas) values ('alerta', 'enviado', 1);
reset role;

-- 1. Pela chave pública (anon) e por quem tem conta (authenticated): nada.
do $$
declare papel text; tabela text;
begin
  foreach papel in array array['anon', 'authenticated'] loop
    foreach tabela in array array['alertas_inscricoes', 'alertas_email', 'alertas_envios'] loop
      begin
        execute format('set local role %I', papel);
        execute format('select count(*) from public.%I', tabela);
        raise exception 'FALHOU: % conseguiu ler %', papel, tabela;
      exception when insufficient_privilege then
        null; -- esperado
      end;
      reset role;
      begin
        execute format('set local role %I', papel);
        execute format('delete from public.%I', tabela);
        raise exception 'FALHOU: % conseguiu apagar em %', papel, tabela;
      exception when insufficient_privilege then
        null;
      end;
      reset role;
    end loop;
  end loop;
end $$;

-- 2. service_role não lê o log (só escreve).
do $$
begin
  set local role service_role;
  perform count(*) from public.alertas_envios;
  raise exception 'FALHOU: service_role leu o log';
exception when insufficient_privilege then
  reset role;
end $$;

-- 3. CHECKs: cada linha abaixo tem que ser recusada.
do $$
declare
  ruins text[] := array[
    $q$insert into public.alertas_inscricoes (email) values ('Maiuscula@Exemplo.com')$q$,
    $q$insert into public.alertas_inscricoes (email) values ('sem-arroba.com')$q$,
    $q$insert into public.alertas_inscricoes (email, confirmado_em) values ('confirmado.sem.perfil@exemplo.com', now())$q$,
    $q$insert into public.alertas_inscricoes (email, perfil) values ('cartao@exemplo.com', '{"programas":[],"cartoes":["cartao-4111111111"]}')$q$,
    $q$insert into public.alertas_inscricoes (email, token_hash) values ('token.sem.pedido@exemplo.com', repeat('a', 64))$q$,
    $q$insert into public.alertas_inscricoes (email, token_hash, pendente) values ('token.ruim@exemplo.com', 'abc', '{}')$q$,
    $q$insert into public.alertas_inscricoes (email) values ('pessoa.a@exemplo.com.br')$q$,
    $q$insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos) values ('a0000000-0000-4000-8000-00000000000a', 'magalu', 0)$q$,
    $q$insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos) values ('a0000000-0000-4000-8000-00000000000a', 'magalu', 100001)$q$,
    $q$insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos) values ('a0000000-0000-4000-8000-00000000000a', 'loja-4111111', 100)$q$,
    $q$insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos) values ('a0000000-0000-4000-8000-00000000000a', 'Magalu', 100)$q$,
    $q$insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos) values ('a0000000-0000-4000-8000-00000000000a', 'magalu', 500)$q$,
    $q$insert into public.alertas_envios (tipo, resultado) values ('marketing', 'enviado')$q$
  ];
  q text;
begin
  foreach q in array ruins loop
    begin
      execute q;
      raise exception 'FALHOU: aceitou %', q;
    exception when check_violation or unique_violation or not_null_violation or invalid_text_representation then
      null;
    end;
  end loop;
end $$;

-- 4. Limite de 10 alertas por e-mail.
do $$
declare i int;
begin
  for i in 1..9 loop
    insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos)
    values ('a0000000-0000-4000-8000-00000000000a', 'loja-' || i, 100);
  end loop;
  begin
    insert into public.alertas_email (inscricao_id, loja_id, minimo_centesimos)
    values ('a0000000-0000-4000-8000-00000000000a', 'loja-extra', 100);
    raise exception 'FALHOU: aceitou o 11º alerta';
  exception when check_violation then null;
  end;
end $$;

-- 5. Cancelar (apagar a inscrição) leva os alertas junto.
delete from public.alertas_inscricoes where id = 'a0000000-0000-4000-8000-00000000000a';
do $$
begin
  if exists (select 1 from public.alertas_email) then raise exception 'FALHOU: alertas sobraram'; end if;
end $$;

-- 6. RLS ligada e forçada nas três tabelas, sem nenhuma política.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('alertas_inscricoes', 'alertas_email', 'alertas_envios')
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then raise exception 'FALHOU: RLS desligada'; end if;
  if exists (select 1 from pg_policies where tablename like 'alertas\_%') then
    raise exception 'FALHOU: há política nas tabelas de alertas';
  end if;
end $$;

rollback;
\echo TUDO CERTO
