-- Manifesto de conferência do backup: para cada tabela do esquema public,
-- o número de linhas e um resumo SHA-256 de todo o conteúdo (linhas em ordem).
-- Roda igual no banco de origem (no mesmo instante do pg_dump) e no banco
-- restaurado: se as duas listas forem idênticas, a restauração trouxe tudo.
-- Não mostra nenhum dado: só nome da tabela, contagem e resumo.
-- Uso: psql -X -q -At -v ON_ERROR_STOP=1 -f manifesto.sql
set timezone = 'UTC';
set datestyle = 'ISO, YMD';
set intervalstyle = 'postgres';
set extra_float_digits = 3;
select format(
  $f$select %L || ' ' || count(*) || ' ' || encode(sha256(convert_to(coalesce(string_agg(t::text, E'\n' order by t::text), ''), 'UTF8')), 'hex') from public.%I t$f$,
  c.relname, c.relname
)
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
order by c.relname
\gexec
