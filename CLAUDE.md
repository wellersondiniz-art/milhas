# CLAUDE.md — comprador de milhas

Regras permanentes do projeto. Valem para todo trabalho, em todas as fases. Na dúvida, siga este arquivo; se algo aqui estiver errado ou desatualizado, pergunte antes de mudar.

## 1. Produto

**O que é:** o "comprador de milhas" é um comparador de milhas e pontos para o Brasil. A pessoa informa os cartões e programas de fidelidade que tem, escolhe uma loja e um valor de compra, e o site mostra qual combinação (programa de fidelidade × cartão) rende mais pontos e quanto isso vale em reais.

**Para quem é:** o consumidor brasileiro que junta milhas e quer saber, na hora da compra, onde comprar e com qual cartão para ganhar mais.

**Fases:**

- **Fase 1 (atual):** site estático instalável (PWA). Sem login e sem banco de dados.
- **Fase 2:** operação. Atualização semanal das ofertas, links de afiliados e métricas de uso.
- **Fase 3:** contas de usuário, extensão de navegador, alertas de ofertas e app nas lojas de aplicativos.

Não antecipar funcionalidades de fases futuras sem pedido explícito.

## 2. Stack da Fase 1

- HTML, CSS e JavaScript puro, com módulos ES (`import`/`export`).
- Sem frameworks e sem dependências de runtime. Ferramentas de desenvolvimento só quando forem realmente necessárias, e com aprovação.
- Testes com o runner nativo do Node: `node --test`.
- Hospedagem estática na Cloudflare Pages.

## 3. Regras de negócio

- O cálculo de pontos é código determinístico em funções puras (mesma entrada, mesma saída, sem efeitos colaterais). **NUNCA** uma chamada de IA.
- Dinheiro sempre em **centavos inteiros** (`12990` = R$ 129,90). Nunca usar float para valores em reais.
- Arredondar **só na exibição**. Os cálculos internos guardam a precisão total.
- Toda regra de cálculo tem teste.

## 4. Dados

- Ofertas, cartões, programas e lojas ficam em arquivos JSON validados por schema.
- Todo registro tem `fonte_url` (link da fonte) e `verificado_em` (data da verificação, no formato `AAAA-MM-DD`).
- **Nunca inventar dado.** O que não se sabe fica como `"A_CONFIRMAR"` e **não entra no cálculo**.
- Registrar só fatos (números, datas, condições), sempre com o link da fonte. Não copiar textos de blogs ou sites.

## 5. Privacidade

- Nunca coletar nem guardar número de cartão, CPF ou qualquer dado pessoal.
- O usuário escolhe cartões e programas pelo nome (ex.: "Cartão X Platinum"), nunca pelo número.
- As preferências do usuário ficam só no `localStorage` do aparelho dele. Nada vai para servidor.

## 6. Segurança

- Sem `innerHTML` com dado variável. Usar `textContent` (ou criar elementos com `document.createElement`).
- Sem script de terceiros sem `integrity` (Subresource Integrity).
- Sem segredo no repositório (chaves, tokens, senhas).
- Cabeçalhos de segurança definidos em `site/_headers`.
- Rodar `seguranca/auditar.sh` antes de cada commit grande.

## 7. Idioma e tom

- Português do Brasil, texto simples e direto.
- Explicar termos como **milheiro**, **clube** e **bônus** na primeira vez que aparecem na tela.
- Moeda em R$ com vírgula decimal e ponto de milhar (ex.: R$ 1.234,56).

## 8. Qualidade

- Mobile-first: projetar primeiro para a tela do celular.
- Acessível: funciona só com teclado, tem contraste adequado e é compreensível em leitor de tela.
- Rápido em celular simples e conexão lenta.
- Todo trabalho termina com os testes passando.

## 9. Jeito de trabalhar

- Perguntar antes de decisões que não dá para desfazer.
- Entre o simples e o esperto, escolher o simples.
- No fim de cada tarefa, dizer: o que foi feito, o que foi testado e o que ficou pendente.

## 10. Comandos do projeto

Vamos preenchendo conforme o projeto cresce.

| Para quê | Comando |
| --- | --- |
| Rodar testes | `npm test` (unitários, dados, navegador e extensão) |
| Validar dados | `npm run validar` |
| Montar o que vai para o ar | `npm run build` (gera `dist/`, a pasta publicada na Cloudflare Pages) |
| Servir localmente | `npm run servir` (serve `dist/`) |
| Auditar segurança | `npm run auditar` |
| Atualizar fotos de referência | `npm run test:fotos:atualizar` (Docker) |
| Alertas por e-mail | `npm run alertas -- --simular` (só conta) e `npm run test:banco` (migração num Postgres local, Docker) |
| Plano pago | testes em `npm run test:unidade` (`testes/plano*.test.mjs`) e `npm run test:banco`; ligar só seguindo o README, seção "Plano pago" |
| Produtos com preço (APIs oficiais) | `npm run produtos` (o build já roda); ver sem credencial: `npm run produtos:demo` |
| Atualizar ofertas (semanal) | `npm run coletar`, `npm run extrair`, `npm run propor` e, depois de revisar, `npm run aprovar -- --data AAAA-MM-DD --codigo <código>` |
| O que reconferir esta semana | `npm run reconferir` (ou `-- --hoje AAAA-MM-DD`; ordem pela `prioridade` de `dados/lojas.json`) |
| Painel semanal das métricas | `PLAUSIBLE_API_KEY=... npm run painel` (grava `painel/painel-AAAA-MM-DD.md`; `-- --exemplo` mostra sem chave) |
| Montar a extensão de navegador | `npm run extensao` (gera `extensao/pacote/`; seletores em `extensao/seletores.json`) |
| Testar a extensão | `npm run test:extensao` (Playwright, páginas de exemplo locais) |
| Operação (monitor, vigia, custos, backup) | `npm run monitor`, `npm run vigia`, `npm run custos`, `npm run backup:teste` (guia em `docs/operacao.md`) |
