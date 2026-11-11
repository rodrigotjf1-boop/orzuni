# Integrar com o Orzuni — guia para outros sistemas (MCP e REST)

> Guia para **qualquer sistema** gerir o cardápio e a loja de um iFood pelo Orzuni: o ERP da loja, um
> sistema próprio, um agente de IA ou outro app. O Orzuni é um gerenciador **fino sobre o iFood ao
> vivo** — ele fala com o iFood por você; você fala só com o Orzuni, por **código de PDV** (não precisa
> conhecer os ids internos do iFood).
>
> Base de produção: **`https://api.orzuni.com`**. Textos de erro em português; respostas em JSON.

## Dois caminhos — qual usar

| | **REST** (`/v1/...`) | **MCP** (`/v1/mcp`) |
|---|---|---|
| Para quem | ERP, PDV, sistema próprio, automações | agente de IA / cliente MCP, produtos DMS |
| Credencial | uma **chave `orz_live_`** (Bearer) | token do **DMS ID** + **ligação** da loja |
| Self-service hoje | **sim** (o dono cria a chave na tela "API / ERP") | precisa de onboarding do app (ver "Como obter acesso") |
| Formato | REST comum (GET/PATCH/POST) | protocolo MCP (ferramentas curadas) |

**Resumo:** se você só quer ler/alterar o cardápio a partir de um sistema seu, o **REST** é o caminho
direto e self-service. O **MCP** é para quem fala o protocolo MCP (agentes de IA, ou produtos que
seguem o Padrão DMS) e quer as ferramentas prontas com envelope de resultado e idempotência.

---

## Parte 1 — REST (self-service)

### 1.1 Criar a chave

No app do Orzuni, tela **"API / ERP"** (acesso de admin da conta): **Nova chave** → escolha os escopos
→ copie o segredo **`orz_live_…`** (aparece **uma vez**). A chave pode ficar **ligada a uma loja** ou
valer para a conta.

### 1.2 Autenticar

Todas as chamadas levam o cabeçalho:

```
Authorization: Bearer orz_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

### 1.3 Endpoints principais (base `https://api.orzuni.com/v1`)

```
GET    /cardapio                     → itens (pdv, nome, descrição, preço, promoção, situação, ordem)
GET    /categorias                   → categorias do cardápio
GET    /complementos                 → grupos de complemento e opções
GET    /itens/{pdv}                  → detalhe de um item
PATCH  /itens/{pdv}/preco            → { "preco": 33.5 }
PATCH  /itens/{pdv}/status           → { "status": "pausado" | "no_ar" }
PATCH  /precos                       → { "itens": [ { "pdv": "2051", "preco": 33.5 } ] }  (lote)
GET    /loja                         → status da loja no iFood
GET    /loja/interrupcoes            → pausas (interrupções) vigentes
POST   /loja/interrupcoes            → { "descricao": "...", "inicio": "ISO", "fim": "ISO" }  (pausar a loja)
GET    /vigia/alertas                → itens fora do ar e há quanto tempo (o vigia como serviço)
```

Exemplo:

```bash
curl -s https://api.orzuni.com/v1/cardapio \
  -H "Authorization: Bearer orz_live_xxxxx"
```

> O contrato completo da REST sai no Swagger da API; peça o `openapi.json` à distribuição se precisar
> de todos os campos e rotas.

---

## Parte 2 — MCP

A porta MCP (`POST /v1/mcp`, spec **2026-07-28**) expõe um conjunto **curado de ferramentas** sobre o
cardápio e a loja no iFood: cada ferramenta faz UMA tarefa, as de escrita devolvem um **envelope** com
o que foi feito e aceitam uma **chave de idempotência**. É o caminho ideal para agentes de IA e para
produtos que seguem o **Padrão DMS de integração**.

### 2.1 Credenciais

Cada chamada à porta MCP leva **dois** cabeçalhos:

```
Authorization: Bearer <token do DMS ID>     ← diz QUAL APLICATIVO chama
DMS-Ligacao:  dms_lg_orzuni_xxxxxxxxxxxx     ← diz QUAL LOJA autorizou
```

- O **token do DMS ID** é um access token (JWT) emitido pelo servidor de identidade da DMS
  (`https://id.dmstecnologias.com/oidc`), máquina a máquina (`client_credentials`), com `aud` =
  `https://api.orzuni.com/v1/mcp`.
- A **ligação** (`dms_lg_orzuni_…`) é o segredo que amarra o seu aplicativo a UMA loja. Você a obtém
  trocando uma chave `orz_live_` da loja (ver 2.3).

Um só dos dois não abre nada: o token sem ligação não sabe a loja; a ligação sem o token do aplicativo
certo é recusada.

### 2.2 Descoberta (sem credencial)

```
GET /.well-known/oauth-protected-resource/v1/mcp   → metadados RFC 9728:
     { "resource": "https://api.orzuni.com/v1/mcp",
       "authorization_servers": ["https://id.dmstecnologias.com/oidc"] }

GET /.well-known/dms-manifesto                      → o manifesto da porta (OpenAPI 3.1 + x-dms-*):
     versão do contrato, permissões, limites e TODAS as ferramentas com o esquema de entrada.
```

O manifesto é a fonte da verdade do contrato — gere a documentação e valide os esquemas a partir dele.

### 2.3 Criar a ligação da loja

Com o token do DMS ID e uma chave **`orz_live_`** da loja (criada na tela "API / ERP"):

```bash
curl -s https://api.orzuni.com/v1/dms-id/ligacao \
  -H "Authorization: Bearer <token do DMS ID>" \
  -H "Content-Type: application/json" \
  -d '{ "chave_orzuni": "orz_live_xxxxx" }'
# → { "ligacao": "dms_lg_orzuni_...", "prefixo": "...", "loja": "<merchant>", "permissoes": [...], "segredo_em": "ISO" }
```

Guarde o `ligacao` (o segredo aparece uma vez; repetir a troca **gira** o segredo). As permissões da
ligação saem dos escopos da chave `orz_live_` usada.

### 2.4 Falar com a porta

Use um **cliente MCP** (o SDK oficial `@modelcontextprotocol/sdk`, o conector MCP do seu agente de IA,
etc.) apontando para `https://api.orzuni.com/v1/mcp`, com os dois cabeçalhos de 2.1. Comece sempre por
`integracao_situacao` para conferir a loja e as permissões.

Exemplo cru (transporte HTTP streamable) listando as ferramentas:

```bash
curl -s https://api.orzuni.com/v1/mcp \
  -H "Authorization: Bearer <token do DMS ID>" \
  -H "DMS-Ligacao: dms_lg_orzuni_xxxxx" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-protocol-version: 2026-07-28" \
  -H "mcp-method: tools/list" \
  -d '{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }'
```

Chamar uma ferramenta de escrita (`method: tools/call`, `params: { name, arguments }`):

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": { "name": "preco_definir",
              "arguments": { "codigo_pdv": "2051", "valor": 33.5, "chaveIdempotencia": "sua-chave-unica-123" } } }
```

> O `tools/list` mostra **só** as ferramentas que a sua credencial pode usar (pelo escopo). Uma
> ferramenta sem permissão nem aparece; chamada direta a ela responde "não encontrada".

### 2.5 Catálogo de ferramentas

A loja vem **sempre** da ligação (nunca no argumento — à prova de IDOR). Os produtos são endereçados
por **código de PDV**.

**Leitura**

| Ferramenta | Permissão | O que faz |
|---|---|---|
| `integracao_situacao` | (nenhuma) | a loja, o produto do token e as permissões — comece por ela |
| `cardapio_listar` | `catalogo.ler` | os itens do cardápio (pdv, nome, descrição, preço, promoção, situação, **ordem**) |
| `categorias_listar` | `catalogo.ler` | as categorias (com **ordem**) |
| `item_ler` | `catalogo.ler` | o detalhe de um item por PDV |
| `complementos_listar` | `catalogo.ler` | os grupos de complemento e as opções (com **ordem**) |
| `alertas_listar` | `vigia.ler` | itens fora do ar e há quanto tempo |
| `loja_status_ler` | `loja.ler` | o status da loja no iFood |
| `loja_horarios_ler` | `loja.ler` | o horário de funcionamento |
| `interrupcoes_listar` | `loja.ler` | as pausas (interrupções) vigentes e futuras |

**Escrita** (exigem `chaveIdempotencia`, 8–100 caracteres)

| Ferramenta | Permissão | O que faz |
|---|---|---|
| `preco_definir` | `preco.escrever` | muda o preço de UM item por PDV |
| `precos_em_massa` | `preco.escrever` | muda o preço de vários itens (lote assíncrono → `batchId`) |
| `complemento_preco_definir` | `preco.escrever` | muda o preço de uma opção por código (todas com o código) |
| `item_pausar` / `item_reativar` | `status.escrever` | tira/põe um item no ar |
| `complemento_pausar` / `complemento_reativar` | `status.escrever` | pausa/reativa uma opção (por código ou id) |
| `item_editar` | `catalogo.escrever` | muda nome e/ou descrição de um item (nome ≤ 100, descrição ≤ 500) |
| `complemento_nome_definir` | `catalogo.escrever` | muda o nome de uma opção (por código ou id; ≤ 100) |
| `item_codigo_pdv_definir` | `catalogo.escrever` | troca o código de PDV de um item (recusa se o novo já existe) |
| `item_foto_definir` | `catalogo.escrever` | troca a foto de um item; `imagem` em data-URI JPEG/PNG, até 8 MB (quadrada, ≥ 300×300 px) |
| `interrupcao_criar` | `loja.escrever` | pausa a LOJA inteira (duração 1 min–7 dias) |
| `interrupcao_remover` | `loja.escrever` | remove uma pausa pelo id (idempotente) |

### 2.6 Envelope das escritas

Toda escrita devolve, em `structuredContent`, **o que a porta FEZ**; o texto (`content`) é sempre uma
frase legível em pt-BR (no sucesso um resumo, na recusa o motivo), nunca o JSON.

- `situacao`: `aplicado` · `sem_mudanca` · `nao_encontrado` · `parcial` · `recusado`
- `repetido`: `true` quando a resposta veio da MESMA `chaveIdempotencia` (não gravou de novo)
- `antes` / `depois`, `opcoes`, `campos`, `de`/`para`: os detalhes conforme a ferramenta
- recusa (`nao_encontrado`/`recusado` → também `isError: true`): **`codigo`** distinto + **`pode_repetir`**

Códigos de recusa: `pdv_inexistente` · `opcao_inexistente` · `codigo_ja_existe` · `dados_invalidos` ·
`imagem_grande` (foto acima de 8 MB) · `conflito` · `ifood_indisponivel` (pode repetir) · `erro_ifood` ·
`erro_interno` (pode repetir) · `chave_reutilizada` (a mesma `chaveIdempotencia` com outro pedido).

### 2.7 Idempotência

Toda escrita leva `chaveIdempotencia` (8–100 caracteres, única por ação). A MESMA chave com o MESMO
pedido devolve o resultado guardado (`repetido: true`) sem gravar de novo; a mesma chave com um pedido
**diferente** é recusada (`chave_reutilizada`). Gere uma chave nova por ação (ex.: um UUID).

### 2.8 Permissões (escopos)

`catalogo.ler` · `catalogo.escrever` · `preco.escrever` · `status.escrever` · `loja.ler` ·
`loja.escrever` · `vigia.ler` · `vigia.escrever`. A ligação só tem os escopos da chave `orz_live_`
usada na troca — peça a chave com o mínimo necessário.

### 2.9 Limites e erros

- **120 chamadas por minuto, por ligação.** Estouro → **429** `limite-de-chamadas` com `Retry-After`.
- Erros do protocolo/credencial vêm em **`application/problem+json`**: **401** (sem token/ligação →
  `WWW-Authenticate`), **403** `insufficient_scope` (falta permissão) ou `conta-bloqueada` (loja
  revogada), **503** `integracao-parada` (pausa do hub, com `Retry-After`).
- Erros de regra de uma ferramenta vêm no **envelope** da própria resposta (ver 2.6), não como HTTP 5xx.

### 2.10 Revogar a ligação

```
DELETE /v1/dms-id/ligacao      (Authorization: Bearer <token> + DMS-Ligacao: <ligação>)
→ { "ok": true, "revogada_em": "ISO" }   — para de valer na chamada seguinte (idempotente).
```

O dono da loja também pode revogar a chave `orz_live_` na tela "API / ERP" a qualquer momento.

---

## Como obter acesso

- **REST:** self-service — o dono da conta cria a chave `orz_live_` na tela "API / ERP". Nada mais.
- **MCP:** além da chave `orz_live_` (do dono da loja), o **aplicativo** que vai chamar precisa de uma
  identidade no **DMS ID** reconhecida pelo Orzuni. Hoje esse cadastro do aplicativo é feito pela
  distribuição (não é self-service ainda): peça o acesso informando o seu sistema; você recebe o
  `client_id`/segredo do DMS ID e a distribuição habilita o aplicativo na porta do Orzuni.

## Segurança e boas práticas

- Guarde o segredo `orz_live_` e o do DMS ID **fora do código** (variáveis de ambiente/cofre); nunca
  no front nem em repositório.
- Trate a loja **sempre** pela credencial — a porta ignora qualquer `merchant` que você mande no corpo.
- Respeite o limite de 120/min e o `Retry-After`; repita só quando `pode_repetir`/`ifood_indisponivel`.
- Use uma `chaveIdempotencia` por ação para não gravar em dobro em caso de reenvio.

## Referências

- Contrato interno da porta: `docs/porta-mcp.md`.
- Manifesto público (fonte da verdade do contrato): `https://api.orzuni.com/.well-known/dms-manifesto`.
- Padrão DMS de integração (o modelo de credencial/ligação): a distribuição fornece.
