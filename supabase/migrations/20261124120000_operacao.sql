-- Operação de produção (docs/operacao.md).
--
-- 1. public.operacao_erros: log de erros das funções do servidor, SEM dado
--    pessoal. O servidor (servidor/operacao/registro.js) já limpa cada campo;
--    os CHECKs abaixo são a segunda trava: recusam e-mail, sequência longa de
--    dígitos (cartão, CPF, telefone) e texto grande.
-- 2. public.operacao_resumo(): números para o vigia diário e o painel de
--    custos (tamanho do banco, erros nas últimas 24 h, e-mails enviados no mês).
-- 3. public.operacao_limpar_erros(): apaga erros com mais de 30 dias.
--
-- Como nas outras migrações: RLS forçada, nenhuma política e nenhum grant para
-- anon/authenticated. Só a chave secreta (service_role) acessa.
-- Não depende das migrações dos alertas nem do plano: pode ser aplicada antes
-- ou depois delas.

create table public.operacao_erros (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  origem text not null check (origem ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  rota text check (rota is null or (char_length(rota) <= 120 and rota !~ '[?#@]')),
  status integer check (status is null or status between 100 and 599),
  tipo text not null check (tipo ~ '^[A-Za-z0-9._-]{1,40}$'),
  mensagem text not null default '' check (
    char_length(mensagem) <= 300
    and mensagem !~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    and mensagem !~ '[0-9]{6,}'
  ),
  local text check (local is null or (char_length(local) <= 120 and local !~ '[0-9]{6,}'))
);

comment on table public.operacao_erros is
  'Erros das funções do servidor, sem dado pessoal. Apagados depois de 30 dias (operacao_limpar_erros).';

create index operacao_erros_criado_em_idx on public.operacao_erros (criado_em);

alter table public.operacao_erros enable row level security;
alter table public.operacao_erros force row level security;
revoke all on public.operacao_erros from anon, authenticated;

-- Números para o vigia e o painel de custos. Tabelas de outras migrações
-- (alertas_envios) podem não existir ainda: conta 0 nesse caso.
create function public.operacao_resumo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  envios_mes bigint := 0;
  envios_dia bigint := 0;
begin
  if to_regclass('public.alertas_envios') is not null then
    execute $q$
      select count(*) filter (where criado_em >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'),
             count(*) filter (where criado_em >= now() - interval '24 hours')
        from public.alertas_envios
       where resultado = 'enviado'
    $q$ into envios_mes, envios_dia;
  end if;
  return jsonb_build_object(
    'banco_bytes', pg_database_size(current_database()),
    'erros_24h', (select count(*) from public.operacao_erros where criado_em >= now() - interval '24 hours'),
    'erros_500_24h', (select count(*) from public.operacao_erros where criado_em >= now() - interval '24 hours' and status = 500),
    'emails_mes', envios_mes,
    'emails_24h', envios_dia,
    'gerado_em', now()
  );
end;
$$;

create function public.operacao_limpar_erros(dias integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  apagados integer;
begin
  if dias is null or dias < 1 then
    raise exception 'dias precisa ser 1 ou mais' using errcode = 'check_violation';
  end if;
  delete from public.operacao_erros where criado_em < now() - make_interval(days => dias);
  get diagnostics apagados = row_count;
  return apagados;
end;
$$;

revoke all on function public.operacao_resumo() from public, anon, authenticated;
revoke all on function public.operacao_limpar_erros(integer) from public, anon, authenticated;
grant execute on function public.operacao_resumo() to service_role;
grant execute on function public.operacao_limpar_erros(integer) to service_role;
