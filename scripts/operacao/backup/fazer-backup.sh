#!/usr/bin/env bash
# Backup do banco (Supabase) com cópia fora do provedor.
#
# O que faz, nesta ordem:
#   1. abre uma "foto" do banco (transação só de leitura) e, nessa mesma foto,
#      tira o pg_dump do esquema public e o manifesto (linhas e resumo SHA-256
#      de cada tabela). Assim o manifesto descreve exatamente o que está no dump;
#   2. junta dump + manifesto num .tar e cifra com GPG (AES-256, senha);
#   3. envia o arquivo cifrado e o SHA-256 dele para o destino:
#        BACKUP_DESTINO=r2          Cloudflare R2 (fora do Supabase), ou
#        BACKUP_DESTINO=pasta:/dir  uma pasta local (teste).
#
# Variáveis (no GitHub: ambiente "backup"; nunca no código):
#   BACKUP_BANCO_URL   conexão do Postgres (Supabase → Connect → Session pooler)
#   BACKUP_SENHA       senha da cifra (32+ caracteres; guarde uma cópia FORA do GitHub)
#   R2_CONTA_ID, R2_CHAVE_ID, R2_CHAVE_SECRETA, R2_BALDE   (só com BACKUP_DESTINO=r2)
# Sem BACKUP_BANCO_URL ou BACKUP_SENHA: avisa que está desligado e sai sem erro.
#
# O backup tem dado pessoal (e-mails dos alertas e do plano): por isso sai
# cifrado daqui e nunca é impresso. O log mostra só nomes, tamanhos e contagens.
set -euo pipefail

if [ -z "${BACKUP_BANCO_URL:-}" ] || [ -z "${BACKUP_SENHA:-}" ]; then
  echo "Backup desligado: faltam BACKUP_BANCO_URL e/ou BACKUP_SENHA (veja docs/operacao.md)."
  exit 0
fi
if [ "${#BACKUP_SENHA}" -lt 32 ]; then
  echo "BACKUP_SENHA precisa ter 32 caracteres ou mais." >&2
  exit 2
fi
DESTINO="${BACKUP_DESTINO:-r2}"
case "$DESTINO" in
  r2)
    for v in R2_CONTA_ID R2_CHAVE_ID R2_CHAVE_SECRETA R2_BALDE; do
      [ -n "${!v:-}" ] || { echo "Falta $v para enviar ao R2." >&2; exit 2; }
    done ;;
  pasta:/*) ;;
  *) echo "BACKUP_DESTINO inválido: use r2 ou pasta:/caminho" >&2; exit 2 ;;
esac

AQUI="$(cd "$(dirname "$0")" && pwd)"
TRABALHO="$(mktemp -d)"
trap 'rm -rf "$TRABALHO"' EXIT
chmod 700 "$TRABALHO"
NOME="milhas-$(date -u +%Y-%m-%dT%H%MZ)"

# 1. Foto do banco: uma sessão psql segura a transação aberta enquanto o
#    pg_dump usa a mesma foto (--snapshot).
# stdbuf -oL: sem ele o psql guarda a saída num buffer e as respostas não chegam.
coproc PSQL { stdbuf -oL psql "$BACKUP_BANCO_URL" -X -q -At -v ON_ERROR_STOP=1 2>&1; }
exec {PARA_PSQL}>&"${PSQL[1]}" {DO_PSQL}<&"${PSQL[0]}"
echo "begin isolation level repeatable read read only; select pg_export_snapshot();" >&$PARA_PSQL
read -r -t 60 FOTO <&$DO_PSQL || { echo "Não consegui abrir a foto do banco (conexão recusada?)." >&2; exit 1; }
if ! [[ "$FOTO" =~ ^[0-9A-F-]+$ ]]; then echo "Resposta inesperada do banco ao abrir a foto." >&2; exit 1; fi

{ cat "$AQUI/manifesto.sql"; echo "select '--fim--';"; } >&$PARA_PSQL
: > "$TRABALHO/manifesto.txt"
while read -r -t 300 linha <&$DO_PSQL; do
  [ "$linha" = "--fim--" ] && break
  [[ "$linha" =~ ^[a-z0-9_]+\ [0-9]+\ [0-9a-f]{64}$ ]] || { echo "Linha inesperada no manifesto." >&2; exit 1; }
  printf '%s\n' "$linha" >> "$TRABALHO/manifesto.txt"
done

pg_dump --dbname="$BACKUP_BANCO_URL" --snapshot="$FOTO" --schema=public --format=custom --compress=6 \
  --no-owner --file="$TRABALHO/banco.dump"
printf 'commit;\n\\q\n' >&$PARA_PSQL
exec {PARA_PSQL}>&- {DO_PSQL}<&-
wait "$PSQL_PID" 2>/dev/null || true

TABELAS=$(wc -l < "$TRABALHO/manifesto.txt")
LINHAS=$(awk '{s+=$2} END {print s+0}' "$TRABALHO/manifesto.txt")
date -u +%Y-%m-%dT%H:%M:%SZ > "$TRABALHO/feito-em.txt"

# 2. Pacote cifrado (a senha entra por um descritor, nunca na linha de comando).
tar -C "$TRABALHO" -cf "$TRABALHO/$NOME.tar" banco.dump manifesto.txt feito-em.txt
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 \
  --output "$TRABALHO/$NOME.tar.gpg" "$TRABALHO/$NOME.tar" 3<<<"$BACKUP_SENHA"
rm -f "$TRABALHO/$NOME.tar" "$TRABALHO/banco.dump"
( cd "$TRABALHO" && sha256sum "$NOME.tar.gpg" > "$NOME.tar.gpg.sha256" )
TAMANHO=$(du -h "$TRABALHO/$NOME.tar.gpg" | cut -f1)

# 3. Envio.
case "$DESTINO" in
  r2)
    export AWS_ACCESS_KEY_ID="$R2_CHAVE_ID" AWS_SECRET_ACCESS_KEY="$R2_CHAVE_SECRETA" AWS_DEFAULT_REGION=auto
    # O R2 não aceita os checksums novos que o aws-cli manda por padrão.
    export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
    PONTO="https://${R2_CONTA_ID}.r2.cloudflarestorage.com"
    for f in "$NOME.tar.gpg" "$NOME.tar.gpg.sha256"; do
      aws s3 cp --only-show-errors --endpoint-url "$PONTO" "$TRABALHO/$f" "s3://$R2_BALDE/banco/$f"
    done
    ONDE="R2, balde $R2_BALDE, pasta banco/" ;;
  pasta:*)
    PASTA="${DESTINO#pasta:}"
    mkdir -p "$PASTA"
    cp "$TRABALHO/$NOME.tar.gpg" "$TRABALHO/$NOME.tar.gpg.sha256" "$PASTA/"
    ONDE="$PASTA" ;;
esac

echo "Backup feito: $NOME.tar.gpg ($TAMANHO, cifrado), $TABELAS tabela(s), $LINHAS linha(s), enviado para $ONDE."
