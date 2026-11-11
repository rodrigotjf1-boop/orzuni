# Porta MCP do Orzuni (produto DMS)

> Contrato da porta de integração do Orzuni no **Padrão DMS** (`C:\HubDMS\docs\padrao-dms-integracao.md`
> §6 porta MCP, §13 manifesto). O Orzuni é **produto**; o Regem é o app que **consome** (decisão do dono,
> 04/11/2026). Piloto direto pelo DMS ID. Este arquivo é a fonte do `x-dms-ferramentas` do manifesto e o
> contrato que o Regem usa no conector. Mudou aqui → muda no manifesto (gerado no CI) e avisa o HubDMS.

## Endereços
- Porta MCP: `POST /v1/mcp` (spec **2026-07-28**, sem estado; aceita também a geração 2025 com `initialize`).
- Ligação (atalho F2-3): `POST /v1/dms-id/ligacao` (token do DMS ID + `{ "chave_orzuni": "orz_live_…" }`) → o segredo da ligação.
- **Revogar a própria ligação:** `DELETE /v1/dms-id/ligacao`, autenticada pela PRÓPRIA ligação (token do DMS ID + cabeçalho `DMS-Ligacao`). Para de valer na chamada seguinte (a revogada responde 401 `ligacao-invalida`). Idempotente; devolve `{ ok: true, revogada_em }`. Desligada (`ORZUNI_MCP_ATIVO=false`) → 404.
- Metadados do recurso: `GET /.well-known/oauth-protected-resource/v1/mcp` (RFC 9728; `resource` = o endereço da porta, `authorization_servers` = `["https://id.dmstecnologias.com/oidc"]`).
- Manifesto público: `GET /.well-known/dms-manifesto` (OpenAPI 3.1 + `x-dms-*`, **sem credencial**).
- Recurso/`aud` (DMS ID) = `https://api.orzuni.com/v1/mcp` — o MESMO texto na porta, no DMS ID e no `resource` dos metadados (senão a conferência `dmsid-mcp-metadados` do kit falha).
- ⚠️ As duas `/.well-known/*` ficam FORA do prefixo global `v1` → `setGlobalPrefix('v1', { exclude: [...] })`.

## Credenciais (§2, §6)
- A porta MCP aceita **só token do DMS ID** (`Authorization: Bearer`, `aud` = recurso do Orzuni, RFC 8707)
  **+** o segredo da ligação no cabeçalho `DMS-Ligacao` (qual loja autorizou). Nenhum outro token.
- 401 → `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`. Permissão faltando → 403
  `error="insufficient_scope"` com **todas** as que faltam. Erros em `application/problem+json` (§7).
- A API key própria `orz_live_` (classe `proprio`) **segue valendo nas rotas REST `/v1`**, não na porta MCP.
- A conferência reusa o **pacote comum v0.9.0** — JÁ COPIADO em `backend/src/dms/integracao-dms.ts`
  (SHA-256 LF `1bee8b1b…`, conferido) e o kit em `backend/scripts/dms/kit-conformidade.mts`. Funções:
  `ChavesDmsId` (uma por processo, `jwks: <emissor>/jwks`), `conferirTokenDmsId`, `ErroTokenDmsId`(401) /
  `ErroPermissaoFaltando`(403), `permissoesDaChamada`, `CABECALHO_LIGACAO`, `cabecalhoWwwAuthenticate`,
  `gerarChave('lg','orzuni')` / `lerChave` / `resumoChave` / `chaveConfere` / `prefixoVisivel`, `ErroProblema`
  / `corpoProblema` / `TIPO_CONTEUDO_PROBLEMA`, `chaveIdempotenciaMcpValida`, `impressaoPedido`, `JanelaFixa`,
  `montarManifesto` / `conferirManifesto` / `CAMINHO_MANIFESTO`. O adaptador NestJS é PRÓPRIO (não há um
  comum — ADR-002); referência de código = porta MCP do **RegemCast** (`backend/src/modules/integracao/
  dms-id.service.ts` + `dms-id.controller.ts`, `ligacao.regras.ts`, `config/env.ts`, `docs/mcp.md`,
  `scripts/dms/kit-conformidade.mts` + `mcp.dmsid.spec.ts`). Import sem extensão: `'../../dms/integracao-dms'`.

## Permissões (mapa dos 8 escopos REST → permissão do manifesto, estilo `ponto`)
| Escopo REST do Orzuni | Permissão no manifesto | Classe máxima (teto) | Sensível |
|---|---|---|---|
| `catalogo:ler`    | `catalogo.ler`    | dms, parceiro, proprio | não |
| `catalogo:escrever` | `catalogo.escrever` | dms, proprio        | não |
| `preco:escrever`  | `preco.escrever`  | dms, proprio           | não |
| `status:escrever` | `status.escrever` | dms, proprio           | não |
| `loja:ler`        | `loja.ler`        | dms, parceiro, proprio | não |
| `loja:escrever`   | `loja.escrever`   | dms, proprio           | não |
| `vigia:ler`       | `vigia.ler`       | dms, parceiro, proprio | não |
| `vigia:escrever`  | `vigia.escrever`  | dms, proprio           | não |

## Catálogo curado de tools (uma tarefa por tool; `snake_case` ≤64; sem ponto)
Toda tool que grava exige o argumento `chaveIdempotencia` (8–100 chars). A loja vem da ligação (nunca
`merchantId` no argumento — à prova de IDOR). Ligação por **código de PDV** (`externalCode`).

### Leitura
| Tool | Permissão | Rota REST traduzida | Argumentos |
|---|---|---|---|
| `cardapio_listar`     | `catalogo.ler` | GET `/cardapio`      | `{ contexto? }` |
| `categorias_listar`   | `catalogo.ler` | GET `/categorias`   | `{}` |
| `item_ler`            | `catalogo.ler` | GET `/itens/{pdv}`  | `{ codigo_pdv }` |
| `complementos_listar` | `catalogo.ler` | GET `/complementos` | `{}` |
| `alertas_listar`      | `vigia.ler`    | GET `/vigia/alertas`| `{}` (itens fora do ar + "desde quando") |
| `loja_status_ler`     | `loja.ler`     | GET `/loja`         | `{}` |
| `loja_horarios_ler`   | `loja.ler`     | GET `/loja/horarios`| `{}` |
| `interrupcoes_listar` | `loja.ler`     | GET `/loja/interrupcoes` | `{}` (pausas vigentes e futuras: id, início, fim, descrição) |

### Escrita (com `chaveIdempotencia`)
| Tool | Permissão | Rota REST traduzida | Argumentos |
|---|---|---|---|
| `preco_definir`       | `preco.escrever`  | PATCH `/itens/{pdv}/preco`  | `{ codigo_pdv, valor, chaveIdempotencia }` — a promo "de/por" atual é **sempre preservada** (não há `valor_de`) |
| `precos_em_massa`     | `preco.escrever`  | PATCH `/precos`             | `{ itens:[{codigo_pdv,valor,manter_promo?}], contexto?, chaveIdempotencia }` (assíncrono → `batchId`; `manter_promo` padrão `true`) |
| `item_pausar`         | `status.escrever` | PATCH `/itens/{pdv}/status` | `{ codigo_pdv, chaveIdempotencia }` → UNAVAILABLE |
| `item_reativar`       | `status.escrever` | PATCH `/itens/{pdv}/status` | `{ codigo_pdv, chaveIdempotencia }` → AVAILABLE |
| `complemento_preco_definir` | `preco.escrever` | PATCH `/complementos/opcao/{id}/preco` (todas com o código) | `{ codigo_pdv, valor, chaveIdempotencia }` — **1 preço por código de PDV → todas as opções com esse código, em todos os grupos** |
| `complemento_pausar`  | `status.escrever` | PATCH `/complementos/opcao/{id}/status` | `{ codigo_pdv \| opcao_id, chaveIdempotencia }` (exatamente um) |
| `complemento_reativar`| `status.escrever` | PATCH `/complementos/opcao/{id}/status` | `{ codigo_pdv \| opcao_id, chaveIdempotencia }` (exatamente um) |
| `item_editar`         | `catalogo.escrever` | PUT `/items` (nome/descrição do produto) | `{ codigo_pdv, nome?, descricao?, chaveIdempotencia }` — ao menos um de nome/descrição; **nome ≤ 100, descrição ≤ 500**; resposta lista `dados.campos:[{campo,antes,depois}]` (R3) |
| `item_foto_definir`   | `catalogo.escrever` | upload + PUT `/items` (foto) | `{ codigo_pdv, imagem, chaveIdempotencia }` — `imagem` em **data-URI** JPEG/png (`data:image/jpeg;base64,…`), **até 8 MB** (iFood recomenda quadrada, ≥ 300×300 px); acima do teto → `recusado`/`imagem_grande` antes do iFood; resposta `dados:{foto:true}` (R3) |
| `complemento_nome_definir` | `catalogo.escrever` | PUT `/products/{id}` (nome da opção) | `{ codigo_pdv \| opcao_id, nome, chaveIdempotencia }` — renomeia TODAS as opções com o código (como o preço); **nome ≤ 100**; resposta lista cada opção (R3) |
| `item_codigo_pdv_definir` | `catalogo.escrever` | PUT `/items` (externalCode) | `{ codigo_pdv, codigo_pdv_novo, chaveIdempotencia }` — recusa `codigo_ja_existe` se o novo já está em uso; resposta `dados:{de,para}` (R3) |
| `interrupcao_criar`   | `loja.escrever`   | POST `/loja/interrupcoes`   | `{ inicio, fim, descricao?, chaveIdempotencia }` (pausa a LOJA; duração 1 min–7 dias; devolve `interrupcao_id`, início, fim e descrição; 409 → `interrupcao_sobreposta` + a pausa que já vale) |
| `interrupcao_remover` | `loja.escrever`   | DELETE `/loja/interrupcoes/{id}` | `{ interrupcao_id, chaveIdempotencia }` — "reabrir agora"; **idempotente** (já removida/inexistente = sucesso) |

### Envelope de resposta das escritas (`structuredContent`)
Toda escrita devolve, em `structuredContent`, o que a porta FEZ. **Padrão §6:** o `content` de TEXTO
é SEMPRE uma frase pt-BR legível (a que a tela mostraria) — no sucesso um resumo (ex.: `Preço alterado
de R$ 19,90 para R$ 29,90.`), na recusa o motivo (ex.: `Código de PDV "137" não existe no cardápio do
iFood desta loja.`) —, **nunca o JSON**. Quem precisa dos campos (`situacao`/`codigo`/`pode_repetir`/
`opcoes`) lê o `structuredContent`; um cliente que só guarda o texto não corta o envelope nem mostra JSON cru.
- `situacao`: `aplicado` · `sem_mudanca` · `nao_encontrado` · `parcial` · `recusado`.
- `repetido`: `true` quando a resposta veio da MESMA `chaveIdempotencia` (não gravou de novo).
- `antes` / `depois`: o preço antes e depois (nas tools de preço de item).
- `opcoes`: `[{ grupo, optionId, antes?, depois?, situacao }]` — cada opção tocada por `complemento_preco_definir`/`_pausar`/`_reativar`/`complemento_nome_definir` por código de PDV, inclusive as `sem_mudanca`.
- `dados`: extras da tool (ex.: `batchId`/`ignorados` em `precos_em_massa`; `campos:[{campo,antes,depois}]` em `item_editar`; `{de,para}` em `item_codigo_pdv_definir`).
- Recusa (`situacao` `nao_encontrado`/`recusado` → também `isError: true`): `codigo` distinto + `pode_repetir`.
  Códigos: `pdv_inexistente` (não repetir) · `ifood_indisponivel` (**pode repetir**) · `dados_invalidos` (nome >100 / descrição >500 devolvem o limite na frase) ·
  `conflito` · `erro_ifood` · `erro_interno` (pode repetir) · `chave_reutilizada` (chaveIdempotencia reusada com outro pedido) ·
  `codigo_ja_existe` (R3, `item_codigo_pdv_definir`: o novo código já está em uso) · `opcao_inexistente` (R3, `complemento_nome_definir` por `opcao_id`).
  Pausa da loja (interrupção): `interrupcao_sobreposta` (não repetir; `dados.interrupcao` = a pausa que já vale: id, início, fim, descrição) ·
  `interrupcao_duracao_invalida` (fora de 1 min–7 dias) · `interrupcao_datas_invalidas` (início/fim não-ISO) · `interrupcao_recem_criada` (**pode repetir**; criada há pouco, aguarde para remover).
- "Loja fechada/desligada" **não** é um código de tool: a loja revogada no Orzuni dá **403 `conta-bloqueada`**
  no portão (antes da tool); a situação de abertura é consultada por `loja_status_ler`.

## Decisões consolidadas (material do HubDMS, 04/11)
- **Endereço FIXADO:** porta `/v1/mcp`, recurso/`aud` `https://api.orzuni.com/v1/mcp`, metadados
  `/.well-known/oauth-protected-resource/v1/mcp` — os três batem.
- **Pacote 0.9.0 e kit COPIADOS** (ver "Credenciais").
- **Permissões em `recurso.acao` (ponto)** — o `conferirManifesto` recusa dois-pontos. Os nomes `:` seguem
  valendo como apelido das chaves `orz_live_` já emitidas. `preco.escrever` é **sensível** (dinheiro).
- **Preço de cardápio = R1** (escrita reversível), NÃO R3 — recomendação do HubDMS acatada: assim NÃO entra
  o pedido de ação do §8.1 (que exigiria aprovação com 2º fator na tela do Orzuni e atrasaria o piloto). Se o
  dono quiser tratar `precos_em_massa` como R3, avisar — muda o fluxo.
- **App do Regem:** reaproveitar o aplicativo que o Regem JÁ tem no DMS ID (o de `HUB_PRODUTOS.regem`) com um
  papel novo com as permissões do Orzuni — uma identidade só, um segredo a menos. Classe `dms` via
  `DMS_ID_APLICATIVOS={"regem":"<client_id>"}` (nenhum id no repositório).
- **Ligação no piloto (atalho F2-3 do RegemCast):** rota `POST /dms-id/ligacao` recebe o token do Regem + uma
  chave `orz_live_` da conta e devolve o `dms_lg_orzuni_`. A tela de autorização do §3 entra antes da 2ª loja
  ou do 1º parceiro. Guardar só o resumo (SHA-256 hex) + o prefixo; a chave aparece uma vez.
- **Manifesto:** `credenciais: ['dms_id']` (o `orz_live_` não está no formato do Padrão); `mcp: { endereco,
  versao: '2026-07-28' }`; `rotas: []` é aceito.
- **No hub, nada agora** (dono): o endereço do Orzuni entra em `HUB_PORTAS`/`HUB_RECURSOS` no próximo PR do
  hub, depois do manifesto passar no kit contra a produção.

## Complemento por código de PDV — RESOLVIDO no O4 (05/11)
Via **(a)**: a porta resolve `codigo_pdv → todas as opções com esse externalCode` (varrendo os grupos,
`complementos()`) e aplica a cada `optionId` (`patchOptionPrice` / `setOptionStatus`, síncronos). A regra do
Regem — **1 preço por código de PDV vale para todas as opções com o código, em todos os grupos** — fica DO
LADO DA PORTA (o id não envelhece no Regem). A resposta lista cada opção (grupo, optionId, antes → depois).
⚠️ Opções cujo código no iFood é gerado pelo Orzuni (`ORZ-*`) vêm com `pdv` vazio em `complementos_listar` e
**não são ligáveis por código** — isso é material da conciliação (R3).

## Saída das leituras (para o R3 do Regem)
- `cardapio_listar` → `{ itens: [{ pdv, nome, descricao, categoria, preco, promo:{de}|null, status:'no_ar'|'pausado', imagem, ordem }] }` (lista inteira, **sem paginação**; `ordem` = posição na ordem do iFood, 0,1,2…; `descricao` = o que está no iFood — R3).
- `categorias_listar` → `{ categorias: [{ nome, template, itens, ordem }] }` (`ordem` = posição no iFood — R3).
- `complementos_listar` → `{ grupos: [{ id, nome, tipo, min, max, ordem, opcoes:[{ id(=optionId), nome, preco, status, pdv, imagem, ordem }], itens:[{ nome, pdv }] }] }` (sem paginação; `ordem` dos grupos e das opções = ordem do iFood — R3).
- `item_ler` → detalhe do item (inclui `descricao`) + `complementos:[{ grupo, obrigatorio, min, max, opcoes:[{ nome, status, preco, pdv, imagem }] }]`.
- `contexto`: `DEFAULT` (o padrão que o Regem usa), mais `INDOOR`/`WHITELABEL` quando a loja tiver.
- **Limite:** 120 chamadas/min por ligação; estouro → 429 `limite-de-chamadas` com `Retry-After`.

## Registro e parada no hub (Padrão §10)
O produto entra no hub pelo `ClienteHub` do pacote comum (`backend/src/hub/`), **desligado por padrão**
(`HUB_LIGADO=false`): sem ele, nada sai daqui e nada é parado pelo hub.
- **Registro central:** cada chamada da porta MCP (e a troca/revogação da ligação) é anotada e enviada ao hub em
  lote — código do pedido, aplicativo, prefixo da ligação, conta, ferramenta (o nome da tool; `dms-id.ligacao` na
  troca/revogação), credencial `dms_id`, resultado, problema, status e duração. **Nunca o conteúdo** (argumentos,
  cardápio, preço). Quem abre a chamada é o middleware `RegistroDaPorta`; o código volta no cabeçalho `request-id`.
- **Parada:** antes de atender, o portão consulta a lista de parada do hub; chamada parada → 503 `integracao-parada`
  com `Retry-After`. Com o hub desligado, nunca para.
- **Erro inesperado (5xx):** vai também à lista de erros do hub, com a mensagem já sem dado da loja.
- **Variáveis (no `orzuni-api`, quem põe é o dono):** `HUB_LIGADO`, `HUB_URL`, `HUB_RECURSO`, `DMS_ID_EMISSOR`,
  `HUB_APLICATIVO` e `HUB_SEGREDO` (o aplicativo **"Orzuni"** no DMS ID, máquina para máquina, função "Produto no
  hub" — NÃO o aplicativo do Regem). `ACEITAR_INTEGRACOES` segue sendo a chave própria de emergência, com ou sem o hub.

## Plano de PRs (lado Orzuni)
- **O1** — módulo `mcp/`: `POST /v1/mcp` roteando `tools/call` → os services que já existem; `tools/list` só
  mostra o que a credencial pode; metadados + manifesto. Nasce DESLIGADO por `ORZUNI_MCP_ATIVO=false`. **(#49)**
- **O2** — credencial DMS ID (token `aud`=orzuni + `DMS-Ligacao`), 401/403 do Padrão, `ACEITAR_INTEGRACOES=false`. **(#49)**
- **O3** — passar no kit de conformidade do HubDMS. **(#49)**
- **O4** — complemento por código de PDV (`complemento_preco_definir`; `_pausar`/`_reativar` aceitam
  `codigo_pdv`) + **envelope `structuredContent`** nas escritas (situação/antes/depois/`repetido`/código). Fecha
  o R2 do Regem. `lote_ler` do `batchId` fica para depois (o Regem usa `preco_definir` síncrono).
- **O5** — Padrão §6 no `content` de texto das escritas: a frase pt-BR SEMPRE (sucesso = resumo, recusa =
  motivo), nunca o JSON (que fica só no `structuredContent`); frase de "PDV inexistente" nomeia o código. Para
  o cliente que só guarda o texto na recusa, a frase não corta nem vaza JSON. (A perda do `structuredContent`
  na recusa pelo `ClienteMcp 0.10.0` é correção do lado do HubDMS.)
- **O6** — entrada no hub (`ClienteHub` do pacote **0.10.1**, módulo `backend/src/hub/`, desligado por
  `HUB_LIGADO=false`): registro/parada/erro em cada chamada da porta (ver seção acima) + rota
  `DELETE /v1/dms-id/ligacao` (a ligação revoga a si mesma, para o kit de conformidade). Nasce inerte.
- **O7** — pausa da LOJA no iFood (F5 da "pausa por canal" do Regem): `interrupcao_remover` e
  `interrupcoes_listar` novas; `interrupcao_criar` passa a devolver o `interrupcao_id`/início/fim/descrição e,
  no 409, a pausa que já vale. Contrato **1.1.0** (aditivo). Reusa `loja.ler`/`loja.escrever` (sem permissão
  nova). O Regem faz "+10/+30" com remover + criar.
- **O8** — R3 (Gestão do catálogo do Regem): `item_editar` (nome/descrição do item), `complemento_nome_definir`
  (nome da opção, por código ou id), `item_codigo_pdv_definir` (troca do código, recusa `codigo_ja_existe`) —
  todas em `catalogo.escrever`; e nas leituras `ordem` (cardápio, categorias, grupos e opções) + `descricao`
  (cardápio). Contrato **1.2.0** (aditivo). O nome da opção renomeia o PRODUTO da opção (`PUT /products/{id}`,
  propaga a todos os itens que a usam) — sem trocar o id. O Regem edita e testa contra os exemplos deste doc.
- **O9** — `item_foto_definir` (`catalogo.escrever`): troca a FOTO do item, `imagem` em **data-URI**
  (`data:image/jpeg;base64,…` ou png) → upload no iFood + re-PUT; resposta `dados:{foto:true}`. Contrato **1.3.0**
  (aditivo). Fecha o pedido do Regem "chave com `catalogo.escrever` + ferramentas de foto e de nome/descrição".
  Teto da foto: **8 MB** (data-URI) — o corpo do `POST /v1/mcp` é limitado a 12 MB em `main.ts` e base64 infla
  ~1,37×; acima de 8 MB decodificados a porta devolve `recusado`/`imagem_grande` antes de chamar o iFood. A
  **dimensão** quem valida é o iFood (recomenda quadrada, ≥ 300×300 px); imagem pequena demais volta como erro do iFood.
