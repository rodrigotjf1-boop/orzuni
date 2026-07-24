# Orzuni

Controle de cardápio do iFood **sem passar pelo portal** — mais rápido, mais leve e
com o que o portal não tem: um **vigia** que avisa item pausado e **há quanto tempo**.

Três modos de uso:

1. **Editor** — puxa o cardápio, edita em rascunho (preço, nome, código de PDV, foto)
   e publica de uma vez.
2. **Vigia** ⭐ — o iFood pausa itens sozinho (política, estoque, complemento esgotado
   derruba o item pai). A API dá o status atual, mas nunca "desde quando". O Orzuni
   sabe, pelos próprios snapshots. Editar cardápio é raro; pausar/despausar é o dia a dia.
3. **Ponte** — API aberta para o ERP/CRM do lojista (Regem, Saipos, Eclética, TOTVS…)
   editar o cardápio de lá e dar push ao iFood. O ERP fala **código de PDV**; o Orzuni
   traduz para o marketplace.

Produto **separado** do Regem — o Regem é só mais um cliente da API.

## Estrutura

```
backend/    NestJS + Catalog v2 do iFood + vigia + (futuro) API aberta
design/     protótipos das 5 telas (Vigia, Preços, Editor, API&ERP) — identidade oficial
tools/      testes-ifood.mjs — bancada de exploração da API (leitura + escrita)
```

## Começar

```bash
cd backend
cp .env.example .env      # IFOOD_CLIENT_ID / SECRET / MERCHANT_ID
npm run vigia:scan        # varre a loja de teste e lista os itens fora do ar
```

Ver `backend/README.md` para o resto (schema, roadmap, notas).

## Estado

- ✅ Estudo da Catalog API v2 + testes ao vivo (leitura e escrita) na loja de teste
- ✅ Cliente do iFood + serviço do vigia (provado: pausa detectada com duração)
- ✅ 5 telas prototipadas
- ⏳ Wiring NestJS + poller agendado · Postgres · API aberta · frontend · homologação

## Modelo iFood

App **centralizado** (`client_credentials`): 1 app do Orzuni acessa N lojas; o lojista
só autoriza no Portal do Parceiro. Exige app de produção (CNPJ) + homologação do
módulo **Catalog** (separada da do módulo Order).
