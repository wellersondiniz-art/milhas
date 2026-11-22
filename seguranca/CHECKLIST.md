# Checklist de segurança

Revisar antes de cada publicação e sempre que o projeto mudar de fase.
Para cada item: **feito** (verificado), **não se aplica** (com o motivo) ou **pendente**.
Não marcar "feito" sem ter verificado. O `seguranca/auditar.sh` cobre parte dos itens de forma automática, mas é heurístico.

Situação em 2026-11-22 (Fase 1, só a estrutura inicial, sem lógica nem dados).

| # | Item | Situação | Observação |
| --- | --- | --- | --- |
| 1 | Autenticação adequada (serviço pronto, nunca login feito do zero) | Não se aplica | Fase 1 não tem login. Rever na Fase 3. |
| 2 | Banco protegido (RLS em toda tabela, chave de servidor fora do navegador) | Não se aplica | Fase 1 não tem banco. |
| 3 | HTTPS obrigatório + HSTS | Pendente | HSTS está em `site/_headers`. Conferir com curl depois do primeiro deploy na Cloudflare Pages. |
| 4 | Validação de formulários no servidor | Não se aplica | Não há servidor. Entradas do usuário são validadas no navegador e só afetam o próprio aparelho. |
| 5 | Proteção contra XSS (textContent, CSP) | Feito | CSP sem `unsafe-inline` em `site/_headers`; `auditar.sh` barra innerHTML, eval e afins. Reconferir a cada mudança na interface. |
| 6 | Monitoramento de atividade suspeita | Não se aplica | Site estático, sem conta nem servidor. Rever na Fase 2 (métricas). |
| 7 | Rotas de admin restritas | Não se aplica | Não há área de admin. |
| 8 | Variáveis de ambiente conferidas | Feito | Não há variáveis. `.env*` no `.gitignore`. |
| 9 | Limite de requisições | Não se aplica | Só arquivos estáticos; a Cloudflare cuida do tráfego. Rever se surgir API. |
| 10 | Cabeçalhos de segurança | Feito no código | CSP, HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP e CORP em `site/_headers`. Testar em produção (item 20). |
| 11 | Cookies de sessão (HttpOnly, Secure, SameSite) | Não se aplica | Sem sessão e sem cookies. Preferências ficam no `localStorage`. |
| 12 | Proteção contra CSRF | Não se aplica | Sem formulário enviado a servidor e sem sessão. |
| 13 | Links de redefinição de senha que expiram | Não se aplica | Sem senha. |
| 14 | Upload com tipos permitidos e limite de tamanho | Não se aplica | Sem upload. |
| 15 | Debug desligado em produção | Feito | `auditar.sh` alerta sobre `console.log` e `debugger` em `site/`. |
| 16 | Dependências atualizadas e versões fixas | Feito | Zero dependências. Actions do GitHub fixadas por SHA. |
| 17 | Arquivos expostos fora das pastas publicadas | Feito | Só `site/` é publicada. `auditar.sh` procura .env, .git, backups e dumps nela. |
| 18 | Segredos no histórico do Git | Feito | `auditar.sh` varre todos os commits. Nenhum encontrado. |
| 19 | Chaves comprometidas revogadas e substituídas | Não se aplica | Nenhuma chave existe ou vazou. Se vazar: revogar primeiro, limpar o histórico depois. |
| 20 | Proteções testadas de verdade | Pendente | Testar com curl os cabeçalhos e o redirecionamento HTTPS no site publicado. O servidor local não aplica o `_headers`. |
| 21 | Relatório das falhas | Feito | Saída do `auditar.sh` e esta tabela. |
| 22 | Chaves de API escondidas | Feito | Não há chaves. `auditar.sh` procura padrões de chave nos arquivos e no histórico. |
| 23 | Senhas com hash forte | Não se aplica | Sem senha. |
| 24 | Consultas parametrizadas | Não se aplica | Sem SQL. |
| 25 | CORS restrito à origem do site | Feito | Nenhum cabeçalho CORS; o padrão do navegador bloqueia outras origens. |
| 26 | Revisão final por um agente que não viu a construção | Pendente | Fazer antes da primeira publicação. |

## Regras do projeto (CLAUDE.md)

- [ ] Nenhum número de cartão, CPF ou dado pessoal coletado ou guardado (o `auditar.sh` procura CPF e número de cartão).
- [ ] Preferências só no `localStorage`; nada enviado para servidor.
- [ ] Sem `innerHTML` com dado variável.
- [ ] Script de terceiros só com `integrity` (SRI).
- [ ] Sem segredo no repositório.
- [ ] `seguranca/auditar.sh` rodado antes de cada commit grande.
