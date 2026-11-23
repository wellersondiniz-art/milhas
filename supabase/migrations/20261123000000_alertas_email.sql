-- Alertas por e-mail ("me avise quando a [loja] tiver [X] pontos por real ou
-- mais para o meu perfil"), SEM conta: inscrição por e-mail com duplo opt-in.
--
-- Quem acessa: só o servidor (Pages Functions e GitHub Actions), com uma
-- chave secreta do Supabase guardada no ambiente de cada um. As três tabelas
-- têm RLS ligada e forçada, NENHUMA política e nenhum grant para anon ou
-- authenticated: pela chave pública ninguém lê nem escreve nada aqui.
--
-- Dado pessoal: só o e-mail (alertas_inscricoes.email). O perfil guardado é
-- o mesmo do aparelho, só com ids do cadastro e datas do clube. Cancelar
-- apaga a inscrição e, em cascata, os alertas. O log de envios não tem
-- e-mail nem id de inscrição.
--
-- Unidades iguais às da tabela alertas do modelo de contas:
-- pontos_por_real em centésimos inteiros (250 = 2,5 pontos por real).

-- Mesmo domain do modelo de contas. Postgres não tem "create domain if not
-- exists": confere antes, para a ordem das migrações não importar.
do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'id_cadastro' and typnamespace = 'public'::regnamespace
  ) then
    create domain public.id_cadastro as text check (
      length(value) between 1 and 64
      and value ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      and value !~ '[0-9]{6}'
    );
  end if;
end
$$;

create table public.alertas_inscricoes (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
    check (
      length(email) between 6 and 254
      and email = lower(btrim(email))
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
  -- Retrato do perfil (ids, clube, data do clube). Só existe depois da confirmação.
  perfil jsonb
    check (
      perfil is null or (
        jsonb_typeof(perfil) = 'object'
        and jsonb_typeof(perfil -> 'programas') = 'array'
        and jsonb_typeof(perfil -> 'cartoes') = 'array'
        and octet_length(perfil::text) <= 4000
        and perfil::text !~ '[0-9]{6}'           -- número de cartão não entra nem por engano
      )
    ),
  confirmado_em timestamptz,
  -- Link de confirmação: só o SHA-256 do token (64 hex), vale uma vez.
  token_hash text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_expira_em timestamptz,
  -- Pedido esperando confirmação: { loja_id, programa_id, minimo_centesimos, perfil }.
  pendente jsonb
    check (
      pendente is null or (
        jsonb_typeof(pendente) = 'object'
        and octet_length(pendente::text) <= 4500
        and pendente::text !~ '[0-9]{6}'
      )
    ),
  -- Limites por pessoa (datas dos últimos envios).
  confirmacoes_recentes timestamptz[] not null default '{}' check (cardinality(confirmacoes_recentes) <= 10),
  alertas_recentes timestamptz[] not null default '{}' check (cardinality(alertas_recentes) <= 10),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (confirmado_em is null or perfil is not null),
  check ((token_hash is null) = (pendente is null))
);

create table public.alertas_email (
  id uuid primary key default gen_random_uuid(),
  inscricao_id uuid not null references public.alertas_inscricoes(id) on delete cascade,
  loja_id public.id_cadastro not null,
  programa_id public.id_cadastro,
  minimo_centesimos integer not null check (minimo_centesimos between 1 and 100000),
  -- O que já foi avisado (oferta|pontos), para não repetir o mesmo aviso.
  ultimo_aviso_chave text check (ultimo_aviso_chave is null or length(ultimo_aviso_chave) <= 200),
  ultimo_aviso_em timestamptz,
  criado_em timestamptz not null default now(),
  unique nulls not distinct (inscricao_id, loja_id, programa_id)
);
create index alertas_email_inscricao_idx on public.alertas_email (inscricao_id);

-- Log de envios SEM dado pessoal: nem e-mail, nem id da inscrição, nem loja.
create table public.alertas_envios (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  tipo text not null check (tipo in ('confirmacao', 'alerta', 'cancelamento')),
  resultado text not null check (resultado in ('enviado', 'erro', 'limite', 'feito')),
  quantidade_alertas integer not null default 0 check (quantidade_alertas between 0 and 100),
  status_http integer check (status_http is null or status_http between 100 and 599)
);

-- Até 10 alertas por e-mail (o servidor confere antes; o banco garante).
create function public.alertas_email_limite()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.alertas_email where inscricao_id = new.inscricao_id) >= 10 then
    raise exception 'limite de 10 alertas por e-mail' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger alertas_email_limite
  before insert on public.alertas_email
  for each row execute function public.alertas_email_limite();

create function public.alertas_inscricoes_atualizado_em()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end
$$;
create trigger alertas_inscricoes_atualizado_em
  before update on public.alertas_inscricoes
  for each row execute function public.alertas_inscricoes_atualizado_em();

-- Fechado duas vezes: RLS forçada sem política E sem grant para os papéis da API.
alter table public.alertas_inscricoes enable row level security;
alter table public.alertas_inscricoes force row level security;
alter table public.alertas_email enable row level security;
alter table public.alertas_email force row level security;
alter table public.alertas_envios enable row level security;
alter table public.alertas_envios force row level security;

revoke all on public.alertas_inscricoes, public.alertas_email, public.alertas_envios from public, anon, authenticated, service_role;
revoke all on sequence public.alertas_envios_id_seq from public, anon, authenticated, service_role;
revoke execute on function public.alertas_email_limite(), public.alertas_inscricoes_atualizado_em() from public, anon, authenticated;

-- service_role (chave secreta) passa por cima da RLS; ainda assim, só o necessário.
grant select, insert, update, delete on public.alertas_inscricoes, public.alertas_email to service_role;
grant insert on public.alertas_envios to service_role;
grant usage on sequence public.alertas_envios_id_seq to service_role;

comment on table public.alertas_inscricoes is 'Alertas por e-mail sem conta. Dado pessoal: só o e-mail. Acesso só pelo servidor.';
comment on table public.alertas_envios is 'Log de envios sem dado pessoal (sem e-mail, sem id de inscrição, sem loja).';
