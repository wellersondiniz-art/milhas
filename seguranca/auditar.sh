#!/usr/bin/env bash
# Auditoria de segurança do comprador de milhas.
#
# Heurística: aponta os problemas típicos, não garante que o resto está seguro.
# Nunca imprime o valor de um segredo, só o arquivo e a linha.
#
# Uso: bash seguranca/auditar.sh
# Saída: 0 se não houver FALHA (ALERTA não reprova), 1 se houver.

set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 2

falhas=0
alertas=0

ok()     { printf '  [OK]     %s\n' "$1"; }
falha()  { printf '  [FALHA]  %s\n' "$1"; falhas=$((falhas + 1)); }
alerta() { printf '  [ALERTA] %s\n' "$1"; alertas=$((alertas + 1)); }
secao()  { printf '\n== %s\n' "$1"; }
# Lista ocorrências só como arquivo:linha (sem o conteúdo da linha).
listar() { cut -d: -f"$1" | sort -u | sed 's/^/           - /'; }

# Arquivos rastreados pelo Git, sem este próprio script (que contém os padrões).
EXCLUIR=(':!seguranca/auditar.sh' ':!seguranca/CHECKLIST.md')

# Padrões de segredos comuns.
SEGREDOS='AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{10,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}|(api[_-]?key|secret|token|senha|password|passwd)["'\'']?[[:space:]]*[:=][[:space:]]*["'\''][^"'\'' ]{8,}["'\'']'

# Dados pessoais: CPF formatado e número de cartão (16 dígitos).
PESSOAIS='[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}|\b[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}\b'

printf 'Auditoria de segurança: %s\n' "$(basename "$RAIZ")"
printf 'Data: %s\n' "$(date +%Y-%m-%d)"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Não é um repositório Git. Rode na raiz do projeto."
  exit 2
fi

# ---------------------------------------------------------------------------
secao "1. Segredos nos arquivos atuais"
achados="$(git grep -nIiE "$SEGREDOS" -- . "${EXCLUIR[@]}" 2>/dev/null || true)"
if [ -n "$achados" ]; then
  falha "possível segredo em arquivo rastreado (revogue a chave antes de apagar):"
  printf '%s\n' "$achados" | listar 1,2
else
  ok "nenhum padrão de segredo nos arquivos rastreados"
fi

# ---------------------------------------------------------------------------
secao "2. Segredos no histórico do Git"
historico=""
for commit in $(git rev-list --all); do
  r="$(git grep -nIiE "$SEGREDOS" "$commit" -- . "${EXCLUIR[@]}" 2>/dev/null || true)"
  [ -n "$r" ] && historico+="$r"$'\n'
done
if [ -n "$historico" ]; then
  falha "possível segredo no histórico (revogue a chave; limpar o histórico vem depois):"
  printf '%s' "$historico" | listar 1-3 | sed 's/:/ em /'
else
  ok "nenhum padrão de segredo em $(git rev-list --all | wc -l | tr -d ' ') commit(s)"
fi

# ---------------------------------------------------------------------------
secao "3. Arquivos sensíveis rastreados"
sensiveis="$(git ls-files | grep -iE '(^|/)\.env($|\.)|\.(pem|key|p12|pfx|jks|keystore|gpg|sql|dump|bak|xls|xlsx|xlsm|ods|csv|pdf|docx?)$|(^|/)id_(rsa|ed25519)|credentials.*\.json$|service-account.*\.json$|(^|/)\.npmrc$|(^|/)\.dev\.vars$' || true)"
if [ -n "$sensiveis" ]; then
  falha "arquivo que não deveria estar no Git:"
  printf '%s\n' "$sensiveis" | sed 's/^/           - /'
else
  ok "nenhum .env, chave, dump, planilha ou PDF rastreado"
fi

for padrao in '.env' 'node_modules/' '*.pem' '*.key' '*.xlsx' '*.csv' '*.pdf'; do
  if ! grep -qxF "$padrao" .gitignore 2>/dev/null; then
    alerta ".gitignore não tem a linha '$padrao'"
  fi
done
[ -f .gitignore ] && ok ".gitignore presente"

# ---------------------------------------------------------------------------
secao "4. Arquivos expostos na pasta publicada (site/)"
if [ -d site ]; then
  expostos="$(find site \( -name '.env*' -o -name '.git' -o -name '*.map' -o -name '*.bak' -o -name '*.sql' \
    -o -name '*.dump' -o -name '*.zip' -o -name '*.log' -o -name '*.pem' -o -name '*.key' -o -name '.DS_Store' \) -print)"
  if [ -n "$expostos" ]; then
    falha "arquivo que não deveria ser publicado:"
    printf '%s\n' "$expostos" | sed 's/^/           - /'
  else
    ok "nenhum .env, .git, backup, dump ou source map em site/"
  fi
else
  falha "pasta site/ não encontrada"
fi

# ---------------------------------------------------------------------------
secao "5. XSS e execução de código (site/)"
xss="$(git grep -nIE '\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setTimeout\([[:space:]]*["'\'']|setInterval\([[:space:]]*["'\'']' -- site 2>/dev/null || true)"
if [ -n "$xss" ]; then
  falha "uso de innerHTML/eval ou similar (use textContent / createElement):"
  printf '%s\n' "$xss" | listar 1,2
else
  ok "sem innerHTML, outerHTML, document.write ou eval"
fi

inline="$(git grep -nIiE '<script>|<script[^>]*>[^<[:space:]]|[[:space:]]on(click|load|error|submit|change|input)=|style=' -- 'site/*.html' 'site/**/*.html' 2>/dev/null || true)"
if [ -n "$inline" ]; then
  alerta "script, evento ou estilo inline no HTML (a CSP vai bloquear):"
  printf '%s\n' "$inline" | listar 1,2
else
  ok "sem script, evento ou estilo inline no HTML"
fi

# ---------------------------------------------------------------------------
secao "6. Scripts e estilos de terceiros"
externos="$(git grep -nIiE '<(script|link)[^>]+(src|href)=["'\'']?(https?:)?//' -- 'site/*.html' 'site/**/*.html' 2>/dev/null || true)"
sem_sri="$(printf '%s\n' "$externos" | grep -v 'integrity=' | grep -v '^$' || true)"
if [ -n "$sem_sri" ]; then
  falha "recurso externo sem integrity (SRI):"
  printf '%s\n' "$sem_sri" | listar 1,2
elif [ -n "$externos" ]; then
  ok "recursos externos têm integrity"
else
  ok "nenhum script ou estilo de terceiros"
fi

# ---------------------------------------------------------------------------
secao "7. Cabeçalhos de segurança (site/_headers)"
if [ -f site/_headers ]; then
  for cab in Content-Security-Policy Strict-Transport-Security X-Content-Type-Options X-Frame-Options Referrer-Policy Permissions-Policy; do
    if grep -qi "^[[:space:]]*$cab:" site/_headers; then ok "$cab"; else falha "falta $cab"; fi
  done
  if grep -iE '^[[:space:]]*Content-Security-Policy:' site/_headers | grep -qE "unsafe-inline|unsafe-eval|\*"; then
    falha "CSP com unsafe-inline, unsafe-eval ou curinga *"
  fi
  if grep -qiE "frame-ancestors 'none'" site/_headers; then ok "CSP bloqueia o site dentro de iframe"; else alerta "CSP sem frame-ancestors 'none'"; fi
else
  falha "site/_headers não existe"
fi

# ---------------------------------------------------------------------------
secao "8. CORS"
cors="$(git grep -nIiE 'Access-Control-Allow-Origin:?[[:space:]]*["'\'']?\*' -- . "${EXCLUIR[@]}" 2>/dev/null || true)"
if [ -n "$cors" ]; then
  falha "CORS liberado para qualquer origem (*):"
  printf '%s\n' "$cors" | listar 1,2
else
  ok "nenhum CORS com *"
fi

# ---------------------------------------------------------------------------
secao "9. Debug, cookies, hash fraco e SQL"
debug="$(git grep -nIE '\bdebugger\b|console\.(log|debug)\(' -- site 2>/dev/null || true)"
if [ -n "$debug" ]; then
  alerta "debugger ou console.log no código publicado:"
  printf '%s\n' "$debug" | listar 1,2
else
  ok "sem debugger nem console.log em site/"
fi

cookies="$(git grep -nIE 'document\.cookie' -- site 2>/dev/null || true)"
if [ -n "$cookies" ]; then
  alerta "uso de document.cookie (preferências ficam no localStorage):"
  printf '%s\n' "$cookies" | listar 1,2
else
  ok "sem cookies criados pelo site"
fi

hash="$(git grep -nIiE "\b(md5|sha1)\b|createHash\([\"']?(md5|sha1)" -- site scripts testes 2>/dev/null || true)"
if [ -n "$hash" ]; then
  alerta "uso de MD5 ou SHA-1:"
  printf '%s\n' "$hash" | listar 1,2
else
  ok "sem MD5 nem SHA-1"
fi

sql="$(git grep -nIiE "(select|insert|update|delete)[[:space:]].*(\+[[:space:]]*[A-Za-z_]|\\\$\{)" -- '*.js' '*.mjs' 2>/dev/null || true)"
if [ -n "$sql" ]; then
  alerta "possível SQL montado com concatenação:"
  printf '%s\n' "$sql" | listar 1,2
else
  ok "sem SQL concatenado"
fi

# ---------------------------------------------------------------------------
secao "10. Dependências"
if [ -f package.json ]; then
  if node -e 'const p=require("./package.json");process.exit(Object.keys({...p.dependencies,...p.devDependencies,...p.optionalDependencies,...p.peerDependencies}).length?1:0)' 2>/dev/null; then
    ok "package.json sem dependências"
  else
    falha "package.json tem dependências (a Fase 1 é sem dependências de runtime)"
  fi
fi
[ -d node_modules ] && alerta "pasta node_modules presente (não deve ir para o Git)"

if [ -d .github/workflows ]; then
  soltas="$(git grep -nE 'uses:[[:space:]]*[^[:space:]]+@' -- .github/workflows | grep -vE '@[0-9a-f]{40}' || true)"
  if [ -n "$soltas" ]; then
    alerta "action do GitHub sem versão fixa por SHA:"
    printf '%s\n' "$soltas" | listar 1,2
  else
    ok "actions do GitHub fixadas por SHA"
  fi
fi

# ---------------------------------------------------------------------------
secao "11. Dados pessoais (CPF e número de cartão)"
pessoais="$(git grep -nIE "$PESSOAIS" -- . "${EXCLUIR[@]}" 2>/dev/null || true)"
if [ -n "$pessoais" ]; then
  falha "possível CPF ou número de cartão em arquivo rastreado:"
  printf '%s\n' "$pessoais" | listar 1,2
else
  ok "nenhum CPF ou número de cartão"
fi

# ---------------------------------------------------------------------------
printf '\n== Resumo: %d falha(s), %d alerta(s)\n' "$falhas" "$alertas"
echo "Este script é heurístico. Siga também seguranca/CHECKLIST.md."
[ "$falhas" -eq 0 ]
