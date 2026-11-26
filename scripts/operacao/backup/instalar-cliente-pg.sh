#!/usr/bin/env bash
# Instala o cliente do Postgres (pg_dump, pg_restore, psql) da versão pedida,
# pelo repositório oficial do Postgres (apt.postgresql.org). Só no GitHub Actions.
# O pg_dump precisa ser da mesma versão do servidor do Supabase ou mais novo.
set -euo pipefail
VERSAO="${1:-17}"
[[ "$VERSAO" =~ ^[0-9]{2}$ ]] || { echo "Versão inválida: $VERSAO" >&2; exit 2; }
sudo apt-get update -qq
sudo apt-get install -y -qq postgresql-common >/dev/null
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
sudo apt-get install -y -qq "postgresql-client-$VERSAO" >/dev/null
echo "/usr/lib/postgresql/$VERSAO/bin" >> "$GITHUB_PATH"
"/usr/lib/postgresql/$VERSAO/bin/pg_dump" --version
