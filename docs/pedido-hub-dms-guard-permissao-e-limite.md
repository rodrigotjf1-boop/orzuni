# Pedido para a sessão do Orzuni — o guard conferir a permissão e o limite da chave

**De:** sessão do Hub DMS · **Em:** 14/10/2026 · **Base lida:** `origin/main` `834c36c`
**Antes de tudo:** confirmar com o dono se o Orzuni está em uso. Se não estiver, este pedido espera.
**É tarefa com plano antes do código:** apresente o plano ao dono e espere o "pode".

## O que o dono decidiu

No plano do Hub DMS, o dono escolheu (D10, 14/10/2026) **abrir já os pedidos de correção das brechas que existem hoje
nos produtos**. A do Orzuni foi classificada como "a confirmar": só pesa se ele estiver em uso.

## O que achei

- `backend/database/001_init.sql:60` — a chave guarda `escopos text[]` (padrão `{catalogo:ler}`) e, na linha 61,
  `rate_limit int` (120 por minuto).
- `backend/src/auth/api-key.service.ts:62` — a tela "API & ERP" grava os escopos escolhidos.
- `backend/src/auth/api-key.guard.ts` — o `ApiKeyGuard` confere a chave e a loja ligada a ela, e nunca lê `escopos`
  nem `rate_limit`.
- `backend/src/app.module.ts:21` — vale só o limite global de 120 chamadas por minuto por IP.

## O risco

Uma chave criada só para ler o cardápio consegue mudar preço, pausar item e criar produto no iFood da loja. E não há
teto por chave: o limite por IP não segura um sistema que chama de vários endereços.

## A correção sugerida

1. Cada rota declara a permissão que exige (`catalogo:ler`, `preco:escrever`, `status:escrever`), e o guard recusa com
   403 a chave que não a tem. A chave de administração (variável de ambiente) segue com tudo.
2. O limite por chave (`rate_limit`) passa a valer, com 429 e `Retry-After`.
3. Chaves antigas com o escopo padrão: avisar na tela antes de passar a valer, para nenhum ERP parar sem aviso.

## Como provar

- Teste por rota: chave sem a permissão recebe 403; com a permissão, segue.
- Teste: a chamada acima do limite da chave recebe 429 com `Retry-After`.

## Depois

Ao mesclar, informe o dono com o número do PR. A sessão do hub atualiza `C:\HubDMS\docs\trilha-paralela.md`.
