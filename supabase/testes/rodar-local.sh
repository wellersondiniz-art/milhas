#!/usr/bin/env bash
# Sobe um Postgres 17 descartável no Docker, cria os papéis do Supabase
# (anon, authenticated, service_role), aplica as migrações e roda os testes
# SQL dos alertas. Não toca em nenhum projeto do Supabase.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=milhas-pg-teste
PORTA=${PORTA_PG:-54330}
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --rm --name "$NOME" -e POSTGRES_PASSWORD=teste -p "$PORTA:5432" postgres:17 >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
export PGPASSWORD=teste
for _ in $(seq 1 30); do psql -h 127.0.0.1 -p "$PORTA" -U postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 1; done
psql -q -h 127.0.0.1 -p "$PORTA" -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
-- Como no Supabase: tabelas novas do public ganham grant automático para os papéis da API.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL
for arquivo in supabase/migrations/*.sql; do
  psql -q -h 127.0.0.1 -p "$PORTA" -U postgres -v ON_ERROR_STOP=1 -f "$arquivo"
done
psql -q -h 127.0.0.1 -p "$PORTA" -U postgres -v ON_ERROR_STOP=1 -f supabase/testes/alertas_email.sql
