-- Testes da migração 20261124120000_operacao.sql. Rode num Postgres
-- descartável, depois das migrações (scripts/operacao/backup/teste-local.sh
-- prepara um igual). Termina com erro na primeira falha.
\set ON_ERROR_STOP 1
begin;

-- 1. Grava um erro limpo.
insert into public.operacao_erros (origem, rota, status, tipo, mensagem, local)
values ('alertas', '/api/alertas/inscrever', 500, 'TypeError', 'x is undefined', 'pedido.js:12');

-- 2. O banco recusa dado pessoal e lixo, mesmo se o servidor falhar na limpeza.
do $$
declare
  casos text[][] := array[
    array['mensagem com e-mail', 'insert into public.operacao_erros (origem, tipo, mensagem) values (''a'', ''Error'', ''falhou para fulano@exemplo.invalid'')'],
    array['mensagem com número longo', 'insert into public.operacao_erros (origem, tipo, mensagem) values (''a'', ''Error'', ''cartao 41111111'')'],
    array['rota com query', 'insert into public.operacao_erros (origem, tipo, rota) values (''a'', ''Error'', ''/api/x?email=a'')'],
    array['origem estranha', 'insert into public.operacao_erros (origem, tipo) values (''A B'', ''Error'')'],
    array['mensagem grande', 'insert into public.operacao_erros (origem, tipo, mensagem) values (''a'', ''Error'', repeat(''x'', 301))']
  ];
  i int;
begin
  for i in 1 .. array_length(casos, 1) loop
    begin
      execute casos[i][2];
      raise exception 'FALHOU: aceitou %', casos[i][1];
    exception when check_violation then
      null; -- recusado, como deve
    end;
  end loop;
end
$$;

-- 3. anon e authenticated não leem, não gravam e não chamam as funções.
do $$
declare
  papel text;
begin
  foreach papel in array array['anon', 'authenticated'] loop
    execute format('set local role %I', papel);
    begin
      perform count(*) from public.operacao_erros;
      raise exception 'FALHOU: % leu operacao_erros', papel;
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.operacao_resumo();
      raise exception 'FALHOU: % chamou operacao_resumo', papel;
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.operacao_limpar_erros(1);
      raise exception 'FALHOU: % chamou operacao_limpar_erros', papel;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
end
$$;

-- 4. Resumo e limpeza (como service_role).
set local role service_role;
do $$
declare
  r jsonb := public.operacao_resumo();
begin
  if (r ->> 'erros_24h')::int < 1 or (r ->> 'erros_500_24h')::int < 1 or (r ->> 'banco_bytes')::bigint <= 0 then
    raise exception 'FALHOU: resumo inesperado %', r;
  end if;
end
$$;
reset role;
insert into public.operacao_erros (origem, tipo, criado_em) values ('velho', 'Error', now() - interval '31 days');
set local role service_role;
do $$
begin
  if public.operacao_limpar_erros(30) <> 1 then raise exception 'FALHOU: limpeza não apagou só o erro velho'; end if;
  begin
    perform public.operacao_limpar_erros(0);
    raise exception 'FALHOU: aceitou dias = 0';
  exception when check_violation then null;
  end;
end
$$;
reset role;

rollback;
\echo 'operacao.sql: tudo certo'
