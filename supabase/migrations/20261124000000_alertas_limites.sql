-- Limites do formulário de alertas por endereço de internet (IP) e no total
-- do dia (achado S1 da revisão independente de 24/11/2026).
--
-- Sem dado pessoal: a chave guarda só um resumo HMAC-SHA-256 do IP, feito no
-- servidor com o segredo IP_SEGREDO, mais o dia. Ninguém volta do resumo para
-- o IP sem o segredo. As linhas somem na rodada semanal (dias antigos).
--
-- A contagem é atômica (insert ... on conflict ... returning): dois pedidos ao
-- mesmo tempo não leem o mesmo número, então não dá para furar o limite
-- mandando tudo de uma vez.

create table public.alertas_contadores (
  chave text primary key
    check (chave ~ '^(ip:[0-9a-f]{64}|total):[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  dia date not null,
  quantidade integer not null default 0 check (quantidade >= 0)
);
create index alertas_contadores_dia_idx on public.alertas_contadores (dia);

-- Soma 1 e devolve o total depois da soma.
create function public.alertas_contar(p_chave text, p_dia date)
returns integer
language sql
security invoker
set search_path = ''
as $$
  insert into public.alertas_contadores as c (chave, dia, quantidade)
  values (p_chave, p_dia, 1)
  on conflict (chave) do update set quantidade = c.quantidade + 1
  returning c.quantidade;
$$;

alter table public.alertas_contadores enable row level security;
alter table public.alertas_contadores force row level security;

revoke all on public.alertas_contadores from public, anon, authenticated, service_role;
revoke execute on function public.alertas_contar(text, date) from public, anon, authenticated;

grant select, insert, update, delete on public.alertas_contadores to service_role;
grant execute on function public.alertas_contar(text, date) to service_role;

comment on table public.alertas_contadores is 'Contadores diários do formulário de alertas. Sem IP: só o resumo HMAC. Acesso só pelo servidor.';
