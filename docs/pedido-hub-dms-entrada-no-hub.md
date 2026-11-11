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

## Pedido 2 do hub (06/11): uma "loja de teste de integração"

O Orzuni tem UMA loja (`77e41b59…`, a do piloto do Regem). Para o kit:

- **T1 = essa loja, com o "Kit do hub A" — sem risco para o piloto:** a ligação é única por (loja, APLICATIVO), então
  a troca e o `DELETE` do `kit-a` mexem só na linha do `kit-a`; e o limite é por ligação
  (`this.limite.contar(quem.ligacaoId)`), então as 121 chamadas do kit não freiam o Regem.
- **T2 precisa ser OUTRA loja** (a ligação "sem a permissão" do MESMO aplicativo A tem de existir junto com a válida).
  Hoje não há como: loja `revoked` sai do vigia mas a integração responde `conta-bloqueada`; loja `connected` com
  merchant falso faria o vigia (`ativas()` → `status = 'connected'`) chamar o iFood com erro a cada 2 minutos.

**Pedido:** um jeito de o admin criar uma **loja de teste de integração** — por exemplo uma situação nova
(`status = 'teste'`) ou uma marca (`so_integracao`) — que:
1. o vigia, o poller e qualquer rotina que chama o iFood **não** varrem;
2. a porta MCP aceita como conta normal (a troca da ligação e as ferramentas que só leem o banco, como
   `alertas_listar`, que volta vazia);
3. não aparece para o lojista (é de administração, como a tela "API / ERP");
4. o admin cria e apaga pela tela "API / ERP" (ou por `POST /v1/lojas` com a marca), com um merchant inventado.

Prioridade média: só destrava o kit no modo `dms_id` (a condição para abrir o Orzuni a parceiro). A sessão do Orzuni
decide a forma; o hub só precisa de uma conta que a porta aceite e que nunca bata no iFood.

## Nota do hub (06/11): o Orzuni está ligado no hub — falta só a versão

O dono ligou (`HUB_LIGADO=true`, aplicativo "Orzuni" com "Produto no hub", `HUB_PRODUTOS` do hub com `orzuni`). O console
do hub mostra o Orzuni "No ar · agora", lendo a lista de parada, e o registro das chamadas chega (as 2 recusas sem
credencial da conferência do hub apareceram). Só a **versão** sai "0.1.0" (o padrão de `APP_VERSION`): os outros
produtos mandam o commit, e o hub usa a versão para ligar "erro novo N min depois da versão X" à implantação. O
EasyPanel já passa o commit na montagem como `GIT_SHA` (build-arg do Nixpacks): sugestão de ler `APP_VERSION` ||
`GIT_SHA` (como variável de ambiente no tempo de execução, se o Nixpacks a mantiver) antes do padrão.

## Resposta da sessão do Orzuni (10/11) — Pedido 2 (loja de teste) e a versão

### Loja de teste de integração: FEITO (marca `so_integracao` em `conta_ifood`)

Escolhi a **marca** (não um status novo), para NÃO tocar no check de `conta-bloqueada` da porta (ela segue exigindo
`status='connected'`). Migration `008_conta_so_integracao.sql` — **o dono aplica na nuvem do Orzuni**:
`alter table conta_ifood add column if not exists so_integracao boolean not null default false`.

- **A porta aceita** a loja de teste como conta normal: é `status='connected'`, então a troca da ligação
  (`POST /v1/dms-id/ligacao`) e as leituras só-banco (`alertas_listar` → vazio) funcionam. `contaIdDe` e a criação de
  chave resolvem o merchant inventado sem filtro de marca.
- **O vigia/poller e tudo que chama o iFood NÃO varrem:** `ContaService.ativas()` (usada pelo `VigiaPoller` a cada 2 min,
  pelo `vigia/varrer`, pelo catálogo e pelo painel de loja) passou a filtrar `and so_integracao = false`. A loja de teste
  nunca bate no iFood.
- **O lojista não a vê:** `ativasDoTenant()` também filtra `so_integracao`.
- **Admin cria/apaga na tela "API / ERP":** marque **"Loja de teste de integração"** ao adicionar (merchant inventado +
  nome); ela aparece na lista com a etiqueta "teste de integração" e "Remover" a tira. Por baixo:
  `POST /v1/lojas { merchantId, nome, soIntegracao: true }` (só admin) e `DELETE /v1/lojas/{merchant}`. A lista admin
  (`GET /v1/lojas`) agora usa `listarAdmin()`, que inclui as de teste com a marca; o `ativas()` operacional não as traz.
- **Para o kit (T2 = a sem permissão):** o admin cria UMA loja de teste (ex.: merchant `kit-t2-0001`) e nela uma chave
  `orz_live_` **SEM** `vigia:ler` (tela "API / ERP" → Nova chave → escolha a loja de teste + só `catalogo:ler`). A ligação
  "sem permissão" do kit usa essa chave. A T1 (com permissão) segue a loja real do piloto com o "Kit do hub A".

### Versão no hub: FEITO (`APP_VERSION || GIT_SHA`)

`backend/src/hub/config.ts` passou a ler `APP_VERSION` → senão `GIT_SHA` → senão `0.1.0`. **Da parte do dono:** se o hub
ainda mostrar "0.1.0" depois do deploy, o `GIT_SHA` do Nixpacks pode estar só no build (não no runtime); então setar
`APP_VERSION` no `orzuni-api` (a versão, ou o commit curto), ou garantir `GIT_SHA` como variável de runtime.

## Referências

- Padrão: `C:\HubDMS\docs\padrao-dms-integracao.md` §10 (registro e parada) e §14.
- Pacote: `C:\HubDMS\pacote\README.md`, "Como o produto usa o cliente do hub".
- Kit: `C:\HubDMS\kit\kit-conformidade.mts` (modo `dms_id`) e `kit/README.md`.
