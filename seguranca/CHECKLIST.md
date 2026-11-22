# Checklist de segurança

Revisar antes de cada publicação e sempre que o projeto mudar de fase.
Para cada item: **feito** (verificado), **não se aplica** (com o motivo) ou **pendente**.
Não marcar "feito" sem ter verificado. O `seguranca/auditar.sh` cobre parte dos itens de forma automática, mas é heurístico.

Situação em 2026-11-22, depois da revisão de segurança (Fase 1: PWA estático publicado de `dist/`, sem login, sem banco, perfil só no `localStorage`).

A Cloudflare Pages publica `dist/`, gerada por `npm run build` a partir de `site/`. O `dist/_headers` é gerado (ganha o sha256 de cada `<style>` embutido), por isso o `auditar.sh` roda o build e confere as duas pastas.

| # | Item | Situação | Observação |
| --- | --- | --- | --- |
| 1 | Autenticação adequada (serviço pronto, nunca login feito do zero) | Não se aplica | Fase 1 não tem login. Rever na Fase 3. |
| 2 | Banco protegido (RLS em toda tabela, chave de servidor fora do navegador) | Não se aplica | Fase 1 não tem banco. |
| 3 | HTTPS obrigatório + HSTS | Feito no código, conferir no ar | HSTS de 1 ano com subdomínios e `upgrade-insecure-requests`. Sem `preload` (decisão do dono, depois do domínio próprio). No domínio próprio, ligar "Always Use HTTPS" na Cloudflare. |
| 4 | Validação de formulários no servidor | Não se aplica | Não há servidor. Entradas do usuário são validadas no navegador e só afetam o próprio aparelho. |
| 5 | Proteção contra XSS (textContent, CSP) | Feito e testado | Sem innerHTML/eval; o gerador de páginas escapa tudo e só faz link para `https://`; CSP sem `unsafe-inline` (CSS embutido entra por sha256). Testado com dado malicioso em todos os JSON. |
| 6 | Monitoramento de atividade suspeita | Não se aplica | Site estático, sem conta nem servidor. Rever na Fase 2 (métricas). |
| 7 | Rotas de admin restritas | Não se aplica | Não há área de admin. |
| 8 | Variáveis de ambiente conferidas | Feito | Não há variáveis. `.env*` no `.gitignore`. |
| 9 | Limite de requisições | Não se aplica | Só arquivos estáticos; a Cloudflare cuida do tráfego. Rever se surgir API. |
| 10 | Cabeçalhos de segurança | Feito e testado localmente | CSP (`img-src 'self'`, sem `data:`), HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP e CORP. `auditar.sh` confere `site/_headers` e `dist/_headers`. |
| 11 | Cookies de sessão (HttpOnly, Secure, SameSite) | Não se aplica | Sem sessão e sem cookies. Preferências ficam no `localStorage`. |
| 12 | Proteção contra CSRF | Não se aplica | Sem formulário enviado a servidor e sem sessão. |
| 13 | Links de redefinição de senha que expiram | Não se aplica | Sem senha. |
| 14 | Upload com tipos permitidos e limite de tamanho | Não se aplica a servidor | "Importar perfil" só lê o arquivo no próprio aparelho: até 50 KB, só campos e ids conhecidos, nada é enviado (`connect-src 'self'`). |
| 15 | Debug desligado em produção | Feito | `auditar.sh` alerta sobre `console.log` e `debugger` em `site/`. |
| 16 | Dependências atualizadas e versões fixas | Feito | Zero dependências de runtime. Actions do GitHub fixadas por SHA. `npm audit` roda no CI (reprova falha moderada ou pior) e no `auditar.sh`. |
| 17 | Arquivos expostos fora das pastas publicadas | Feito | Só `dist/` é publicada. `auditar.sh` procura .env, .git, backups, dumps, source maps e package.json em `site/` e `dist/`, e confere que a vitrine de estilo ficou fora. |
| 18 | Segredos no histórico do Git | Feito | `auditar.sh` varre todos os commits. Nenhum encontrado. |
| 19 | Chaves comprometidas revogadas e substituídas | Não se aplica | Nenhuma chave existe ou vazou. Se vazar: revogar primeiro, limpar o histórico depois. |
| 20 | Proteções testadas de verdade | Parcial | Testado em navegador real e com curl em `dist/` servida com o `_headers`. Falta conferir no site publicado: cabeçalhos com `curl -I` e redirecionamento de http para https. |
| 21 | Relatório das falhas | Feito | Saída do `auditar.sh` e esta tabela. |
| 22 | Chaves de API escondidas | Feito | Não há chaves. `auditar.sh` procura padrões de chave nos arquivos e no histórico. |
| 23 | Senhas com hash forte | Não se aplica | Sem senha. |
| 24 | Consultas parametrizadas | Não se aplica | Sem SQL. |
| 25 | CORS restrito à origem do site | Feito | Nenhum cabeçalho CORS; o padrão do navegador bloqueia outras origens. |
| 26 | Revisão final por um agente que não viu a construção | Feito em 2026-11-22 | Refazer a cada fase nova. |

## Regras do projeto (CLAUDE.md)

- [ ] Nenhum número de cartão, CPF ou dado pessoal coletado ou guardado (o `auditar.sh` procura CPF e número de cartão).
- [ ] Preferências só no `localStorage`; nada enviado para servidor.
- [ ] Sem `innerHTML` com dado variável.
- [ ] Script de terceiros só com `integrity` (SRI).
- [ ] Sem segredo no repositório.
- [ ] `seguranca/auditar.sh` rodado antes de cada commit grande.
