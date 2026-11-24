#!/usr/bin/env bash
# Restaura um backup feito por fazer-backup.sh e CONFERE que veio tudo.
#
# Uso:
#   RESTAURAR_URL=postgres://... BACKUP_SENHA=... restaurar.sh <arquivo.tar.gpg>
#   RESTAURAR_URL=postgres://... BACKUP_SENHA=... R2_...=... restaurar.sh --ultimo
#
# RESTAURAR_URL é o banco que RECEBE os dados. Ele precisa estar VAZIO (sem
# tabelas no esquema public): o script se recusa a escrever por cima de um
# banco com dados, para nunca apagar a produção por engano.
#
# Depois de restaurar, calcula o manifesto no banco restaurado (mesmo
# manifesto.sql) e compara com o que foi gravado no backup: mesmo número de
# linhas e mesmo resumo SHA-256 em todas as tabelas. Termina com erro se
# qualquer coisa for diferente.
set -euo pipefail

ARQUIVO="${1:-}"
[ -n "$ARQUIVO" ] || { echo "Uso: restaurar.sh <arquivo.tar.gpg> | --ultimo" >&2; exit 2; }
[ -n "${RESTAURAR_URL:-}" ] || { echo "Falta RESTAURAR_URL (banco vazio que vai receber os dados)." >&2; exit 2; }
[ -n "${BACKUP_SENHA:-}" ] || { echo "Falta BACKUP_SENHA." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
TRABALHO="$(mktemp -d)"
trap 'rm -rf "$TRABALHO"' EXIT
chmod 700 "$TRABALHO"

if [ "$ARQUIVO" = "--ultimo" ]; then
  for v in R2_CONTA_ID R2_CHAVE_ID R2_CHAVE_SECRETA R2_BALDE; do
    [ -n "${!v:-}" ] || { echo "Falta $v para baixar do R2." >&2; exit 2; }
  done
  export AWS_ACCESS_KEY_ID="$R2_CHAVE_ID" AWS_SECRET_ACCESS_KEY="$R2_CHAVE_SECRETA" AWS_DEFAULT_REGION=auto
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
  PONTO="https://${R2_CONTA_ID}.r2.cloudflarestorage.com"
  NOME=$(aws s3 ls --endpoint-url "$PONTO" "s3://$R2_BALDE/banco/" | awk '{print $4}' | grep -E '^milhas-.*\.tar\.gpg$' | sort | tail -1)
  [ -n "$NOME" ] || { echo "Nenhum backup encontrado no R2." >&2; exit 1; }
  for f in "$NOME" "$NOME.sha256"; do
    aws s3 cp --only-show-errors --endpoint-url "$PONTO" "s3://$R2_BALDE/banco/$f" "$TRABALHO/$f"
  done
  ARQUIVO="$TRABALHO/$NOME"
fi
[ -f "$ARQUIVO" ] || { echo "Arquivo não encontrado: $ARQUIVO" >&2; exit 2; }
NOME="$(basename "$ARQUIVO")"
echo "Backup: $NOME"

# 1. Integridade do arquivo (se o .sha256 estiver ao lado).
if [ -f "$ARQUIVO.sha256" ]; then
  ( cd "$(dirname "$ARQUIVO")" && sha256sum --quiet -c "$NOME.sha256" ) || { echo "SHA-256 não confere: arquivo corrompido." >&2; exit 1; }
  echo "ok  SHA-256 do arquivo confere"
fi

# 2. Decifrar e abrir.
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt --output "$TRABALHO/pacote.tar" "$ARQUIVO" 3<<<"$BACKUP_SENHA" \
  || { echo "Não consegui decifrar (senha errada ou arquivo corrompido)." >&2; exit 1; }
tar -C "$TRABALHO" -xf "$TRABALHO/pacote.tar" banco.dump manifesto.txt feito-em.txt
rm -f "$TRABALHO/pacote.tar"
echo "ok  decifrado (backup feito em $(cat "$TRABALHO/feito-em.txt"))"

# 3. O destino precisa estar vazio.
psql_dest() { psql "$RESTAURAR_URL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
EXISTENTES=$(psql_dest -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p')")
if [ "$EXISTENTES" != "0" ]; then
  echo "O banco de destino já tem $EXISTENTES tabela(s) no esquema public. Use um banco vazio." >&2
  exit 1
fi

# 4. Papéis do Supabase: já existem num projeto Supabase; num Postgres comum, cria.
psql_dest <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;
SQL

# 5. Restaurar (tudo ou nada).
# O esquema public já existe em todo banco novo: tira do roteiro a criação dele
# (e o comentário dele), senão o pg_restore para com "already exists".
pg_restore --list "$TRABALHO/banco.dump" | grep -vE ' (SCHEMA|COMMENT) - (SCHEMA )?public ' > "$TRABALHO/roteiro.txt"
pg_restore --dbname="$RESTAURAR_URL" --no-owner --exit-on-error --single-transaction --use-list="$TRABALHO/roteiro.txt" "$TRABALHO/banco.dump"
echo "ok  pg_restore terminou sem erro"

# 6. Conferir: manifesto do banco restaurado = manifesto gravado no backup.
psql_dest -f "$AQUI/manifesto.sql" > "$TRABALHO/manifesto-restaurado.txt"
if ! diff -u "$TRABALHO/manifesto.txt" "$TRABALHO/manifesto-restaurado.txt" > "$TRABALHO/diferencas.txt"; then
  echo "A restauração NÃO confere com o backup. Tabelas diferentes (nome, linhas):" >&2
  grep -E '^[-+][a-z]' "$TRABALHO/diferencas.txt" | awk '{print "  " $1, $2}' >&2
  exit 1
fi
TABELAS=$(wc -l < "$TRABALHO/manifesto.txt")
LINHAS=$(awk '{s+=$2} END {print s+0}' "$TRABALHO/manifesto.txt")
echo "ok  $TABELAS tabela(s) e $LINHAS linha(s): contagens e resumos SHA-256 iguais aos do backup"
awk '{printf "      %-28s %s linha(s)\n", $1, $2}' "$TRABALHO/manifesto.txt"

# 7. A proteção (RLS) voltou junto?
SEM_RLS=$(psql_dest -c "select string_agg(relname, ', ' order by relname) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not (relrowsecurity and relforcerowsecurity)")
if [ -n "$SEM_RLS" ]; then
  echo "atenção: tabelas sem RLS forçada depois de restaurar: $SEM_RLS" >&2
  exit 1
fi
echo "ok  todas as tabelas com RLS ligada e forçada"
echo "Restauração conferida."
