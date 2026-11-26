-- Plano pago opcional (assinatura mensal pelo Stripe).
--
-- Regras de ouro:
-- - O número do cartão nunca passa por aqui: a pessoa paga na página do
--   Stripe. Guardamos só o e-mail, os códigos do Stripe e a situação.
-- - A situação só muda pelo webhook do Stripe (Pages Function
--   /api/plano/stripe), com a assinatura do aviso conferida. Nenhuma rota do
--   navegador escreve aqui.
-- - Cada aviso é processado uma vez: plano_eventos guarda o id do evento.
--
-- Quem acessa: só o servidor, com a chave secreta do Supabase. RLS ligada e
-- forçada, nenhuma política e nenhum grant para anon/authenticated.
--
-- Ranking e cálculo de pontos não olham para estas tabelas: o plano só muda
-- o limite de alertas por e-mail.

create table public.plano_assinaturas (
  id uuid primary key default gen_random_uuid(),
  stripe_assinatura_id text not null unique check (stripe_assinatura_id ~ '^sub_[A-Za-z0-9]{1,250}$'),
  stripe_cliente_id text not null check (stripe_cliente_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  email text not null
    check (
      length(email) between 6 and 254
      and email = lower(btrim(email))
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
  -- ativa: pago e dentro do período. pendente: primeiro pagamento ainda não
  -- confirmado. falhou: cobrança recusada (o Stripe ainda pode tentar de novo).
  -- cancelada: acabou. reembolsada: devolvemos o dinheiro e encerramos.
  situacao text not null check (situacao in ('pendente', 'ativa', 'falhou', 'cancelada', 'reembolsada')),
  cancela_no_fim boolean not null default false,
  fim_do_periodo timestamptz,
  contestada boolean not null default false,
  reembolsada_em timestamptz,
  -- Data do evento do Stripe que gerou esta linha: um aviso velho que chega
  -- atrasado não desfaz um mais novo.
  evento_criado_em timestamptz not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check ((situacao = 'reembolsada') = (reembolsada_em is not null))
);
create index plano_assinaturas_email_idx on public.plano_assinaturas (email);
create index plano_assinaturas_cliente_idx on public.plano_assinaturas (stripe_cliente_id);

-- Avisos já processados (idempotência). Sem dado pessoal: só id, tipo e data.
create table public.plano_eventos (
  stripe_evento_id text primary key check (stripe_evento_id ~ '^evt_[A-Za-z0-9]{1,250}$'),
  tipo text not null check (length(tipo) between 1 and 100),
  processado_em timestamptz not null default now()
);

create function public.plano_assinaturas_atualizado_em()
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
create trigger plano_assinaturas_atualizado_em
  before update on public.plano_assinaturas
  for each row execute function public.plano_assinaturas_atualizado_em();

-- Quem tem o plano agora. A mesma regra está em servidor/plano/regras.js
-- (temBeneficio); os dois lados são testados.
create function public.plano_ativo(p_email text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.plano_assinaturas
    where email = lower(btrim(p_email))
      and situacao = 'ativa'
      and not contestada
      and fim_do_periodo > now()
  );
$$;

-- Limite de alertas por e-mail: 10 no grátis, 50 com o plano.
-- Troca a função criada em 20261123000000_alertas_email.sql.
create or replace function public.alertas_email_limite()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  limite integer := 10;
begin
  if public.plano_ativo((select email from public.alertas_inscricoes where id = new.inscricao_id)) then
    limite := 50;
  end if;
  if (select count(*) from public.alertas_email where inscricao_id = new.inscricao_id) >= limite then
    raise exception 'limite de % alertas por e-mail', limite using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- Até 7 e-mails de alerta por semana com o plano (o grátis segue em 2): cabe
-- no check de alertas_recentes (até 10 datas) que já existe.

alter table public.plano_assinaturas enable row level security;
alter table public.plano_assinaturas force row level security;
alter table public.plano_eventos enable row level security;
alter table public.plano_eventos force row level security;

revoke all on public.plano_assinaturas, public.plano_eventos from public, anon, authenticated, service_role;
revoke execute on function public.plano_ativo(text), public.plano_assinaturas_atualizado_em(), public.alertas_email_limite() from public, anon, authenticated;

grant select, insert, update on public.plano_assinaturas to service_role;
grant select, insert on public.plano_eventos to service_role;
grant execute on function public.plano_ativo(text) to service_role;

comment on table public.plano_assinaturas is 'Plano pago. Dado pessoal: só o e-mail. Muda só pelo webhook do Stripe. Sem número de cartão.';
comment on table public.plano_eventos is 'Ids dos avisos do Stripe já processados (idempotência). Sem dado pessoal.';
