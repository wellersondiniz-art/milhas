# Permissões da extensão, com justificativa

Texto pronto para o formulário "Práticas de privacidade" da Chrome Web Store. A lista vem do `manifest.json` gerado por `npm run extensao` (o teste `testes/extensao.test.mjs` reprova qualquer permissão a mais).

## Finalidade única (single purpose)

Na página de produto de uma loja cadastrada, mostrar com qual cartão e programa de pontos a pessoa ganha mais pontos naquela compra.

## Permissões pedidas

| Permissão | Para quê | Justificativa para a loja |
| --- | --- | --- |
| `storage` | Guardar os cartões e programas que a pessoa escolheu nas opções. | Os cartões e programas escolhidos ficam em `chrome.storage.local`, só no navegador. Nada é sincronizado nem enviado. |
| Acesso aos sites das lojas (via `content_scripts.matches`, por exemplo `https://www.magazineluiza.com.br/*`) | Ler o texto do preço na página do produto e mostrar o selo. | Só os sites das lojas cadastradas, com o endereço exato (sem `<all_urls>`, sem curinga de domínio). A lista sai de `extensao/seletores.json`: só entra loja com seletor verificado. |

## Permissões que a extensão NÃO pede

| Não pede | Por quê |
| --- | --- |
| `<all_urls>`, `*://*/*`, `host_permissions` | A extensão só roda nas lojas cadastradas, declaradas uma a uma. |
| `tabs`, `activeTab`, `scripting` | Não precisa ver abas nem injetar código sob demanda: o script de conteúdo é declarado no manifesto. |
| `cookies`, `history`, `webRequest`, `webNavigation` | Não lê navegação, cookies nem tráfego. |
| `identity`, `notifications`, `alarms` | Sem conta, sem alerta, sem tarefa agendada (alertas são da Fase 3, se o usuário pedir). |
| `web_accessible_resources` | A página da loja não consegue enxergar nem carregar arquivos da extensão. |
| `externally_connectable` | Nenhum site conversa com a extensão. |

## Respostas para o formulário de privacidade

- **Uso de código remoto:** Não. Todo o código está no pacote; a CSP da extensão (`script-src 'self'`) não deixa carregar script de fora.
- **Dados coletados:** Nenhum. (Não marcar nenhuma das categorias: informação pessoal, de saúde, financeira, de autenticação, comunicações, localização, histórico da web, atividade do usuário, conteúdo do site.)
  - Observação: o texto do preço é lido na página só para fazer a conta dentro do navegador e não é guardado nem transmitido, então não conta como dado coletado.
- **Certificações:** marcar as três (não vende dados a terceiros; não usa para fins alheios à finalidade única; não usa para crédito).

## Política de segurança (CSP) das páginas da extensão

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

`connect-src 'none'` faz o próprio navegador bloquear qualquer `fetch`, `XMLHttpRequest` ou `WebSocket` vindo da extensão.
