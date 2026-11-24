#!/usr/bin/env bash
# Auditoria de segurança do Milhas da Vez.
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
SEGREDOS='AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{10,}|rk_live_[A-Za-z0-9]{10,}|(sk|rk)_test_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{24,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]{10,}|\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9_]{10,}|(api[_-]?key|secret|token|senha|password|passwd)["'\'']?[[:space:]]*[:=][[:space:]]*["'\''][^"'\'' ]{8,}["'\'']'

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
# Migrações e testes SQL do Supabase são código (esquema), não dump de dados.
sensiveis="$(printf '%s\n' "$sensiveis" | grep -vE '^supabase/(migrations|testes)/[A-Za-z0-9_.-]+\.sql$' | grep -v '^$' || true)"
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
secao "4. Arquivos expostos (site/ e a pasta publicada, dist/)"
# A Cloudflare Pages publica dist/, gerada por npm run build. Auditar só site/
# deixaria de fora o que o build acrescenta (o _headers final, por exemplo).
if [ -d site ]; then
  if npm run build >/dev/null 2>&1; then
    ok "npm run build gerou dist/"
  else
    falha "npm run build falhou (rode-o para ver o erro); dist/ não foi auditada"
  fi
else
  falha "pasta site/ não encontrada"
fi
PROIBIDOS=( -name '.env*' -o -name '.git' -o -name '*.map' -o -name '*.bak' -o -name '*.sql' -o -name '*.dump'
  -o -name '*.zip' -o -name '*.log' -o -name '*.pem' -o -name '*.key' -o -name '.DS_Store' -o -name 'package*.json'
  -o -name 'node_modules' )
for pasta in site dist; do
  [ -d "$pasta" ] || continue
  expostos="$(find "$pasta" \( "${PROIBIDOS[@]}" \) -print)"
  if [ -n "$expostos" ]; then
    falha "arquivo que não deveria ser publicado em $pasta/:"
    printf '%s\n' "$expostos" | sed 's/^/           - /'
  else
    ok "nenhum .env, .git, backup, dump, source map ou package.json em $pasta/"
  fi
done
if [ -d dist ]; then
  # Só para quem desenvolve: fica em site/, mas não pode ir para o ar.
  dev="$(find dist \( -name 'estilo.html' -o -name 'vitrine.*' \) -print)"
  if [ -n "$dev" ]; then
    falha "página de desenvolvimento publicada em dist/:"
    printf '%s\n' "$dev" | sed 's/^/           - /'
  else
    ok "vitrine de estilo fora de dist/"
  fi
fi

# ---------------------------------------------------------------------------
secao "5. XSS e execução de código (site/, functions/ e servidor/)"
xss="$(git grep -nIE '\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setTimeout\([[:space:]]*["'\'']|setInterval\([[:space:]]*["'\'']' -- site scripts/pwa functions servidor 2>/dev/null || true)"
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

if [ -d functions ]; then
  # Com functions/, a Cloudflare roda a função em todo pedido, a não ser que
  # _routes.json diga quais caminhos são dela.
  if [ -f dist/_routes.json ] && node -e 'const r=require("./dist/_routes.json");process.exit(r.version===1&&r.include.length>0&&r.include.every((c)=>c.startsWith("/api/"))?0:1)' 2>/dev/null; then
    ok "dist/_routes.json limita as funções a /api/*"
  else
    falha "functions/ existe, mas dist/_routes.json não limita as funções a /api/*"
  fi
  # Chaves dos alertas só vêm do ambiente (Cloudflare e GitHub Actions).
  chave_fixa="$(git grep -nIE '(SUPABASE_SECRET_KEY|RESEND_API_KEY|ALERTAS_SEGREDO|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|service_role_key)[[:space:]]*[:=][[:space:]]*["'\''`]' -- functions servidor scripts .github 2>/dev/null || true)"
  if [ -n "$chave_fixa" ]; then
    falha "chave dos alertas ou do Stripe escrita no código (use segredo no ambiente):"
    printf '%s\n' "$chave_fixa" | listar 1,2
  else
    ok "chaves do Supabase, do Resend e do Stripe só vêm do ambiente"
  fi
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
secao "7. Cabeçalhos de segurança (site/_headers e dist/_headers)"
conferir_headers() {
  local arq="$1" cab csp
  if [ ! -f "$arq" ]; then falha "$arq não existe"; return; fi
  for cab in Content-Security-Policy Strict-Transport-Security X-Content-Type-Options X-Frame-Options Referrer-Policy Permissions-Policy Cross-Origin-Opener-Policy; do
    if grep -qi "^[[:space:]]*$cab:" "$arq"; then ok "$arq: $cab"; else falha "$arq: falta $cab"; fi
  done
  csp="$(grep -iE '^[[:space:]]*Content-Security-Policy:' "$arq")"
  if printf '%s' "$csp" | grep -qE "unsafe-inline|unsafe-eval|unsafe-hashes|[[:space:]]\*|[[:space:]]https?:[;[:space:]]"; then
    falha "$arq: CSP com unsafe-inline, unsafe-eval, curinga * ou esquema inteiro liberado"
  else
    ok "$arq: CSP sem unsafe-inline, unsafe-eval nem curinga"
  fi
  if printf '%s' "$csp" | grep -qi "frame-ancestors 'none'"; then ok "$arq: CSP bloqueia o site dentro de iframe"; else alerta "$arq: CSP sem frame-ancestors 'none'"; fi
}
conferir_headers site/_headers
if [ -d dist ]; then
  conferir_headers dist/_headers
  # Cada <style> embutido pelo build precisa do seu sha256 na CSP, e nenhuma
  # página publicada pode ter <script> inline (só JSON-LD) ou evento on*=.
  inline_dist="$(node -e '
    const fs = require("fs"), path = require("path"), crypto = require("crypto");
    const csp = fs.readFileSync("dist/_headers", "utf8");
    const paginas = fs.readdirSync("dist", { recursive: true }).map(String).filter((f) => f.endsWith(".html"));
    for (const p of paginas) {
      const html = fs.readFileSync(path.join("dist", p), "utf8");
      for (const [, css] of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
        const h = "sha256-" + crypto.createHash("sha256").update(css, "utf8").digest("base64");
        if (!csp.includes(h)) console.log(p + ": <style> sem resumo na CSP");
      }
      for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
        if (!/\ssrc=/.test(tag) && !/type="?application\/ld\+json/.test(tag)) console.log(p + ": <script> inline");
      }
      if (/<[^>]+\son[a-z]+=/i.test(html)) console.log(p + ": atributo de evento on*=");
    }' 2>&1)"
  if [ -n "$inline_dist" ]; then
    falha "HTML publicado que a CSP vai bloquear ou que foge dela:"
    printf '%s\n' "$inline_dist" | sed 's/^/           - /'
  else
    ok "dist/: todo <style> tem resumo na CSP; nenhum script ou evento inline"
  fi
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
# Fase 1: nenhuma dependência de runtime. Ferramenta de teste (devDependencies)
# só da lista aprovada e com versão exata.
DEV_PERMITIDAS='["@playwright/test"]'
if [ -f package.json ]; then
  if node -e 'const p=require("./package.json");process.exit(Object.keys({...p.dependencies,...p.optionalDependencies,...p.peerDependencies}).length?1:0)' 2>/dev/null; then
    ok "package.json sem dependências de runtime"
  else
    falha "package.json tem dependências de runtime (a Fase 1 não usa nenhuma)"
  fi
  if node -e 'const p=require("./package.json");const ok=JSON.parse(process.argv[1]);const d=p.devDependencies||{};process.exit(Object.entries(d).every(([n,v])=>ok.includes(n)&&/^\d+\.\d+\.\d+$/.test(v))?0:1)' "$DEV_PERMITIDAS" 2>/dev/null; then
    ok "ferramentas de teste só da lista aprovada, com versão exata"
  else
    falha "devDependencies fora da lista aprovada ($DEV_PERMITIDAS) ou sem versão exata"
  fi
fi
[ -n "$(git ls-files node_modules | head -1)" ] && falha "pasta node_modules está no Git"

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
