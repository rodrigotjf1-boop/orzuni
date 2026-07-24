# Orzuni · backend

Controle de cardápio do iFood **sem passar pelo portal**: um editor mais rápido, um
**vigia** que avisa item pausado (e há quanto tempo), e uma **API aberta** para o
ERP/CRM do lojista (Saipos, Eclética, TOTVS…) editar o cardápio e dar push ao iFood.

Produto **separado** do Regem — o Regem é só mais um cliente da API.

## Como funciona

- **Auth centralizada** (`client_credentials`): 1 app do Orzuni acessa N lojas. As
  credenciais ficam no `.env` (nunca por lojista). Ver `src/ifood/ifood-auth.service.ts`.
- **Catalog v2**: todo o cliente em `src/ifood/ifood-catalog.service.ts` — cada método
  é um endpoint provado ao vivo (ver `docs/ifood-catalog-api.md` no repo do Regem).
- **Vigia** (`src/vigia/vigia.service.ts`): varre o cardápio, compara com o snapshot
  anterior e sabe **quando** cada item caiu — o iFood só dá o status atual, nunca o "desde".
- **Modo ponte**: preço/status em lote casam por **código de PDV** (`externalCode`),
  então o ERP do cliente não precisa conhecer nenhum id do iFood.

## Estrutura

```
backend/
  src/
    ifood/
      ifood-auth.service.ts      OAuth client_credentials + cache 6h single-flight
      ifood-catalog.service.ts   Catalog v2 (leitura, escrita leve, lote, imagem)
      ifood.types.ts
    vigia/
      vigia.service.ts           snapshot → duração → alertas (cascata/manual/estoque)
  database/
    001_init.sql                 conta_ifood, item_estado, alerta, api_key
  scripts/
    vigia-scan.mjs               varredura standalone (sem Nest/banco) — prova o vigia
```

## Rodar

Pré-requisito: Node 20+.

```bash
cd backend
cp .env.example .env          # preencher IFOOD_CLIENT_ID/SECRET/MERCHANT_ID
npm install                   # (para o Nest; o vigia-scan roda sem deps)
npm run vigia:scan            # varre a loja de teste e imprime os alertas
```

O `vigia:scan` grava `scripts/snapshot.json`. **Rode duas vezes**: na 1ª ele carimba
o estado; da 2ª em diante o "fora do ar há X" passa a valer de verdade.

## Roadmap curto

- [x] Estudo da API + testes ao vivo (leitura e escrita) na loja de teste
- [x] Cliente do Catalog v2 + serviço do vigia + schema
- [ ] Wiring NestJS (módulos, controllers) + poller agendado (`@nestjs/schedule`)
- [ ] Persistir snapshot/alertas no Postgres (hoje o scan usa JSON)
- [ ] API aberta (chaves, `/cardapio`, `/precos`, `/itens/{pdv}/status`, `/alertas`) + webhooks
- [ ] Frontend (as 5 telas já prototipadas: Vigia, Cardápio, Preços, Editor, API&ERP)
- [ ] App de **produção** no iFood + homologação do módulo Catalog

## ⚠️ Notas

- **Nunca** commitar `.env`. O `clientSecret` do app de teste vai ser invalidado
  (o app Teste C será excluído e recriado).
- `unsellableItems` é **eventual** (~10s) — o poller varre em intervalo folgado.
- O iFood **não** guarda custo → o Orzuni não mostra margem (só preço).
