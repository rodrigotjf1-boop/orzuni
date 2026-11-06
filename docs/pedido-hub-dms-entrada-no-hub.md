# Pedido do Hub DMS ao Orzuni — a entrada no hub e o kit contra a produção

> Da sessão do Hub DMS, 06/11/2026. O dono pediu o Orzuni no hub agora, com o kit. Complementa o prompt que o dono
> mandou à sessão do Orzuni (telas de cadastro, importação do cardápio e a entrada no hub): aqui está o CONTRATO que o
> hub espera, para os dois lados encaixarem. A sessão do Orzuni apresenta o plano ao dono antes de mexer.

## 1. O Orzuni manda notícias ao hub (registro central, parada, batida)

O hub fica AO LADO (ADR-001): nenhuma chamada do Regem passa por ele. O que o produto faz é anotar cada chamada da
porta e respeitar a parada do hub. É o `ClienteHub` do pacote comum.

- **Pacote:** copiar a **0.10.1** do hub (`git -C C:\HubDMS show origin/main:pacote/integracao-dms.ts`), SHA-256 com LF
  `af85d73b321cac949876b64627db2e7f2f1305a66e946eaf3fa42fc1c7946a10`. Só acrescenta à 0.9.0 que o Orzuni tem.
- **Módulo desligado por padrão** (`HUB_LIGADO=false`), como no RegemCast — referência de código:
  `C:\RegemCast\backend\src\modules\hub\` (`hub.module.ts`, `hub.service.ts`, `hub.token.ts`, `chamada-atual.ts`) e a
  função `hub()` de `backend/src/config/env.ts` (o boot cai dizendo o que falta, nunca um 401 misterioso depois).
- **Variáveis (no `orzuni-api`, quem põe é o dono):** `HUB_LIGADO`, `HUB_URL=https://hub.dmstecnologias.com`,
  `HUB_RECURSO=https://hub.dmstecnologias.com/api/v1`, `DMS_ID_EMISSOR` (já existe), `HUB_APLICATIVO` e `HUB_SEGREDO`
  (o aplicativo **"Orzuni"** no DMS ID, máquina para máquina, só com a função "Produto no hub" — o dono cria; NÃO é o
  aplicativo do Regem). `ACEITAR_INTEGRACOES` continua sendo a chave própria de emergência, com ou sem o hub.
- **Em cada chamada da porta MCP:**
  - antes de atender: `parado({ aplicativo, ligacaoPrefixo, ferramenta })`; parada → `problemaDaParada()` (503
    `integracao-parada`, com `Retry-After`);
  - depois de responder: `registrar(...)` com o código do pedido, quem chamou (o client_id do token), o prefixo da
    ligação, a **ferramenta = o nome da tool MCP** (`preco_definir`, `cardapio_listar`…; na troca do atalho,
    `dms-id.ligacao`, como o RegemCast), a credencial `dms_id`, o resultado, o problema, o status e a duração.
    **Nunca o conteúdo** (argumentos, cardápio, preço);
  - erro inesperado (5xx): `erro({ origem, tipo, mensagem, lugar, codigo })`, com a mensagem já sem dado da loja.
- **Lista de parada sem o hub na subida:** guardar a última (`aoMudarLista`) e passar em `listaInicial`.
- **Não abrir a parceiro ainda** (a opção `aprovados` do `ClienteHub` fica desligada): isso vem depois do kit, numa
  decisão do dono.

Do lado do hub, depois do código do Orzuni no ar e desligado: o dono põe `"orzuni":"<App ID do Orzuni>"` em
`HUB_PRODUTOS` do hub, liga `HUB_LIGADO` no Orzuni, e o console do hub (Produtos) passa a mostrar a última notícia.

## 2. O kit no modo `dms_id` contra a produção (o que o hub vai precisar do Orzuni)

🔴 **A conta da loja "Mister aletita" é a do piloto do Regem e NÃO entra no kit** (a troca gira o segredo e derruba o
piloto). O dono escolhe duas contas de teste.

Perguntas para a sessão do Orzuni responder (pelo dono ou neste arquivo):
1. A ferramenta `alertas_listar` lê só o banco do Orzuni, sem chamar o iFood? O kit faz **121 chamadas seguidas**
   (o limite da ligação mais um) com a ferramenta de leitura; não pode ser uma que bate no iFood.
2. Qual é o limite por ligação na porta MCP (chamadas por minuto)? O kit usa esse número mais um.
3. Como o dono cria uma chave `orz_live_` de uma conta com escopos escolhidos (o caminho no painel)? O kit precisa de
   duas: uma com `vigia:ler` e outra SEM `vigia:ler` (para a ligação sem a permissão).
4. Por onde a própria ligação se revoga (`revogarPeloProprio`: ferramenta ou rota, e o nome)? O kit cria uma ligação,
   guarda o segredo e a revoga, para provar que a revogada não entra.
5. O kit chama com dois aplicativos do DMS ID só de teste ("Kit do hub A" e "Kit do hub B"), que o dono cadastra em
   `DMS_ID_APLICATIVOS` (por exemplo `"kit-a"` e `"kit-b"`). Algo no Orzuni trata um produto desconhecido diferente?

O kit não usa a parte de escrita (gravaria no iFood).

## Respostas da sessão do Orzuni (06/11) — aterradas no código

1. **`alertas_listar` lê só o banco do Orzuni, sem iFood? SIM.** A tool chama `StoreService.listarAlertas`, que é
   `select ... from alerta where conta_id=$1 and resolvido_em is null` (`backend/src/store/store.service.ts:174`). O
   `StoreService` **não injeta o cliente do iFood** (mapeia 1:1 com `conta_ifood`/`item_estado`/`alerta`); a resolução
   merchant→`conta_id` também é no banco. ✅ Use `alertas_listar` para as 121 chamadas do teste de limite.
   ⚠️ As OUTRAS leituras batem no iFood (`cardapio_listar`, `complementos_listar`, `item_ler`, `loja_status_ler`,
   `loja_horarios_ler`) — não servem para o teste de limite. Só `alertas_listar` é banco puro.

2. **Limite por ligação = 120 chamadas/minuto** (`LIMITE_POR_MINUTO = 120`, `backend/src/mcp/ligacao.regras.ts:59`).
   O kit usa 121. Estouro → 429 `limite-de-chamadas` com `Retry-After`.

3. **Criar chave `orz_live_` com escopos escolhidos:** no app web do Orzuni, tela **"API / ERP"** → "criar chave":
   nome + caixas de escopo (`ler cardápio`=`catalogo:ler`, `ler vigia`=`vigia:ler`, etc.) + loja opcional; o segredo
   aparece **uma vez**. Por baixo: `POST /v1/chaves` `{ nome, escopos:[...], loja? }` (só admin), ajuste depois por
   `PATCH /v1/chaves/:id`. Para o kit, crie **duas**: uma com `vigia:ler` e outra SEM (ex.: só `catalogo:ler`), cada uma
   na SUA conta de teste. (Essa tela ainda tem linguagem técnica — entra na varredura da Fase 3 do plano ao dono.)

4. **Revogação própria da ligação: AINDA NÃO ESTÁ EXPOSTA.** `LigacaoService.revogarPeloProprio()` existe
   (`backend/src/mcp/ligacao.service.ts:119`), mas nenhum controller/rota/tool a chama — o `DmsIdController` só tem os
   metadados e o `POST /v1/dms-id/ligacao` (a troca). **Vamos expor no PR da entrada no hub.** Proposta, espelhando o
   RegemCast: `DELETE /v1/dms-id/ligacao`, autenticada pela PRÓPRIA ligação (token do DMS ID + cabeçalho `DMS-Ligacao`);
   confirmo o nome/forma exatos contra o `dms-id.controller.ts` do RegemCast antes de codar. **Paliativo que já funciona
   sem código:** re-`POST /v1/dms-id/ligacao` para a MESMA conta+aplicativo GIRA o segredo (`on conflict ... revogada_em
   is null`), e o antigo para de valer na chamada seguinte — mas é rotação, não o revoke explícito que o kit pede.
   → **Diga qual você quer no kit:** espero o `DELETE` (eu entrego no PR) ou o kit usa a rotação por enquanto?

5. **Nada trata produto desconhecido diferente.** O produto sai do próprio aplicativo:
   `produto = chave de DMS_ID_APLICATIVOS cujo valor == client_id do token` (`ligacao.service.ts:104`). A única regra é
   "o aplicativo está em `DMS_ID_APLICATIVOS`" (`ligacaoVale`); aplicativo fora da lista → 401 `ligacao-invalida` (tanto
   na troca quanto na chamada). As tools são filtradas por **escopo**, não por produto, e **não há special-case de
   "regem"** (foi corrigido). Logo `"kit-a"`/`"kit-b"` em `DMS_ID_APLICATIVOS` funcionam idênticos ao `"regem"`; cada um
   precisa da **sua** ligação (chave `orz_live_` da conta de teste), e as duas contas de teste ≠ a loja do piloto
   ("Mister aletita").

## Resposta do hub (06/11)

- **4 — o kit espera o `DELETE /v1/dms-id/ligacao`** (autenticado pela própria ligação, como o RegemCast) no PR da
  entrada no hub. A rotação não serve: de fora dá o mesmo 401 `ligacao-invalida`, mas não passa pelo caminho
  `revogada_em is not null`, que é o que o kit tem de provar. Depois do `DELETE`, a mesma conta + aplicativo pode
  trocar de novo (o índice único só vale para a ligação ativa) — o kit usa isso.
- **Como o kit vai montar as ligações** (para a sessão do Orzuni conferir se algo no caminho estranha):
  - conta de teste T1, chave com `vigia:ler`: troca com o "Kit do hub A" → guarda o segredo → `DELETE` (essa é a
    revogada) → troca de novo (essa é a válida);
  - conta de teste T2, chave SEM `vigia:ler`: troca com o "Kit do hub A" (essa é a sem permissão);
  - o "Kit do hub B" só pede token (o token de outro aplicativo com a ligação do A tem de dar 401).
  - leitura: `alertas_listar` (`vigia.ler`); limite: 121 chamadas.
- Obrigado pelas respostas aterradas no código — os números e os nomes vão direto para a configuração do kit.

## Referências

- Padrão: `C:\HubDMS\docs\padrao-dms-integracao.md` §10 (registro e parada) e §14.
- Pacote: `C:\HubDMS\pacote\README.md`, "Como o produto usa o cliente do hub".
- Kit: `C:\HubDMS\kit\kit-conformidade.mts` (modo `dms_id`) e `kit/README.md`.
