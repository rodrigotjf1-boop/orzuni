# Porta MCP do Orzuni (produto DMS)

> Contrato da porta de integração do Orzuni no **Padrão DMS** (`C:\HubDMS\docs\padrao-dms-integracao.md`
> §6 porta MCP, §13 manifesto). O Orzuni é **produto**; o Regem é o app que **consome** (decisão do dono,
> 04/11/2026). Piloto direto pelo DMS ID. Este arquivo é a fonte do `x-dms-ferramentas` do manifesto e o
> contrato que o Regem usa no conector. Mudou aqui → muda no manifesto (gerado no CI) e avisa o HubDMS.

## Endereços
- Porta MCP: `POST /v1/mcp` (spec **2026-07-28**, sem estado; aceita também a geração 2025 com `initialize`).
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

### Escrita (com `chaveIdempotencia`)
| Tool | Permissão | Rota REST traduzida | Argumentos |
|---|---|---|---|
| `preco_definir`       | `preco.escrever`  | PATCH `/itens/{pdv}/preco`  | `{ codigo_pdv, valor, valor_de?, chaveIdempotencia }` |
| `precos_em_massa`     | `preco.escrever`  | PATCH `/precos`             | `{ itens:[{codigo_pdv,valor,valor_de?}], contexto?, chaveIdempotencia }` (assíncrono → `batchId`) |
| `item_pausar`         | `status.escrever` | PATCH `/itens/{pdv}/status` | `{ codigo_pdv, chaveIdempotencia }` → UNAVAILABLE |
| `item_reativar`       | `status.escrever` | PATCH `/itens/{pdv}/status` | `{ codigo_pdv, chaveIdempotencia }` → AVAILABLE |
| `complemento_pausar`  | `status.escrever` | PATCH `/complementos/opcao/{id}/status` | `{ opcao_id, chaveIdempotencia }` |
| `complemento_reativar`| `status.escrever` | PATCH `/complementos/opcao/{id}/status` | `{ opcao_id, chaveIdempotencia }` |
| `interrupcao_criar`   | `loja.escrever`   | POST `/loja/interrupcoes`   | `{ inicio, fim, descricao?, chaveIdempotencia }` (pausa a LOJA, não um item) |

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

## Questão ainda aberta
- **Complemento por código de PDV.** Hoje o Orzuni reprecifica opção só por `optionId` do iFood
  (`/complementos/opcao/:id/preco`); produtos vão por `externalCode` (`/precos`). O caso de uso do Regem quer
  preço de complemento por canal ligando por **código de PDV**. No O1 investigo (a) resolver `optionId` pelo
  código de PDV da opção, ou (b) `externalCode` em opção se o iFood aceitar. Até lá, as tools de complemento
  ficam só com pausar/reativar (sem `complemento_preco_definir`).

## Plano de PRs (lado Orzuni)
- **O1** — módulo `mcp/`: `POST /v1/mcp` roteando `tools/call` → os services que já existem
  (`CatalogoService`, `VigiaService`, `LojaService`); `tools/list` só mostra o que a credencial pode;
  metadados + manifesto (`montarManifesto`). Nasce DESLIGADO por flag `ORZUNI_MCP_ATIVO=false`.
- **O2** — credencial DMS ID (token `aud`=orzuni + `DMS-Ligacao`), 401/403 do Padrão, `ACEITAR_INTEGRACOES=false`.
- **O3** — passar no kit de conformidade do HubDMS.
