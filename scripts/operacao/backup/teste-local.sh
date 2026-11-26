#!/usr/bin/env bash
# Teste de restauração de ponta a ponta, SEM tocar no Supabase:
#   1. cria um banco "origem" num Postgres local, com os papéis do Supabase,
#      todas as migrações de supabase/migrations/ e dados FALSOS;
#   2. faz o backup com fazer-backup.sh (destino: uma pasta temporária);
#   3. restaura num banco "restaurado" vazio com restaurar.sh, que confere
#      linhas e resumos SHA-256 de todas as tabelas e a RLS;
#   4. prova que um backup com a senha errada não abre.
#
# Postgres: use PG_URL_ADMIN=postgres://usuario:senha@host:porta/postgres
# (um superusuário). Sem ela, sobe um Postgres 17 descartável no Docker.
# MIGRACOES_EXTRAS=/pasta aplica também os .sql dessa pasta (ex.: migrações
# de pull requests ainda abertos).
set -euo pipefail
cd "$(dirname "$0")/../../.."
AQUI=scripts/operacao/backup

if [ -z "${PG_URL_ADMIN:-}" ]; then
  NOME=milhas-pg-backup
  PORTA=${PORTA_PG:-54331}
  docker rm -f "$NOME" >/dev/null 2>&1 || true
  docker run -d --rm --name "$NOME" -e POSTGRES_PASSWORD=teste -p "$PORTA:5432" postgres:17 >/dev/null
  trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
  PG_URL_ADMIN="postgres://postgres:teste@127.0.0.1:$PORTA/postgres"
  for _ in $(seq 1 30); do psql "$PG_URL_ADMIN" -c 'select 1' >/dev/null 2>&1 && break; sleep 1; done
fi
base_de() { printf '%s' "${PG_URL_ADMIN%/*}/$1"; }
ORIGEM="$(base_de milhas_teste_origem)"
RESTAURADO="$(base_de milhas_teste_restaurado)"
admin() { psql "$PG_URL_ADMIN" -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "== 1. Banco de origem (papéis do Supabase, migrações, dados falsos)"
admin -c "drop database if exists milhas_teste_origem" -c "drop database if exists milhas_teste_restaurado"
admin -c "create database milhas_teste_origem" -c "create database milhas_teste_restaurado"
psql "$ORIGEM" -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL
# Ordem pelo nome do arquivo (a data no começo), como no Supabase.
for arquivo in $( { ls supabase/migrations/*.sql; if [ -n "${MIGRACOES_EXTRAS:-}" ]; then ls "$MIGRACOES_EXTRAS"/*.sql; fi; } | awk -F/ '{print $NF "\t" $0}' | sort | cut -f2); do
  echo "   migração: $(basename "$arquivo")"
  psql "$ORIGEM" -X -q -v ON_ERROR_STOP=1 -f "$arquivo"
done
psql "$ORIGEM" -X -q -v ON_ERROR_STOP=1 -f supabase/testes/operacao.sql
psql "$ORIGEM" -X -q -v ON_ERROR_STOP=1 -f supabase/testes/dados-falsos-backup.sql

echo "== 2. Backup"
PASTA="$(mktemp -d)"
trap 'rm -rf "$PASTA"; [ -n "${NOME:-}" ] && docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
SENHA="$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | head -c 40)"
BACKUP_BANCO_URL="$ORIGEM" BACKUP_SENHA="$SENHA" BACKUP_DESTINO="pasta:$PASTA" bash "$AQUI/fazer-backup.sh"
ARQ="$(ls "$PASTA"/*.tar.gpg)"
if grep -a -q -E 'exemplo\.invalid|alertas_inscricoes' "$ARQ"; then
  echo "FALHOU: o arquivo do backup não está cifrado" >&2; exit 1
fi
echo "ok  o arquivo enviado não mostra nenhum e-mail nem nome de tabela (está cifrado)"

echo "== 3. Restauração num banco vazio"
RESTAURAR_URL="$RESTAURADO" BACKUP_SENHA="$SENHA" bash "$AQUI/restaurar.sh" "$ARQ"

# A proteção veio junto: pela chave pública (papel anon) nada é lido.
for tabela in $(psql "$RESTAURADO" -X -At -c "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1"); do
  if psql "$RESTAURADO" -X -q -At -c "set role anon; select count(*) from public.$tabela" >/dev/null 2>&1; then
    echo "FALHOU: o papel anon leu $tabela no banco restaurado" >&2; exit 1
  fi
done
echo "ok  o papel anon (chave pública) não lê nenhuma tabela do banco restaurado"
psql "$RESTAURADO" -X -q -At -c "set role service_role; select public.operacao_resumo() ->> 'erros_24h'" | grep -qE '^[0-9]+$'
echo "ok  as funções do banco voltaram (operacao_resumo responde)"

echo "== 4. Recusas"
if RESTAURAR_URL="$RESTAURADO" BACKUP_SENHA="$SENHA" bash "$AQUI/restaurar.sh" "$ARQ" >/dev/null 2>&1; then
  echo "FALHOU: restaurou por cima de um banco com dados" >&2; exit 1
fi
echo "ok  recusa restaurar por cima de um banco com dados"
admin -c "drop database milhas_teste_restaurado" -c "create database milhas_teste_restaurado"
if RESTAURAR_URL="$RESTAURADO" BACKUP_SENHA="senha-errada-senha-errada-senha-errada" bash "$AQUI/restaurar.sh" "$ARQ" >/dev/null 2>&1; then
  echo "FALHOU: abriu o backup com a senha errada" >&2; exit 1
fi
echo "ok  senha errada não abre o backup"
printf 'x' >> "$ARQ"
if RESTAURAR_URL="$RESTAURADO" BACKUP_SENHA="$SENHA" bash "$AQUI/restaurar.sh" "$ARQ" >/dev/null 2>&1; then
  echo "FALHOU: aceitou um arquivo alterado" >&2; exit 1
fi
echo "ok  arquivo alterado é recusado pelo SHA-256"

admin -c "drop database milhas_teste_origem" -c "drop database milhas_teste_restaurado"
echo "Teste de restauração: tudo certo."
