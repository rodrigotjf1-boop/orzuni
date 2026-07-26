# Homologação Catalog do iFood — checklist do Orzuni

> Estado do Orzuni frente aos critérios oficiais de homologação do módulo Catalog.
> Legenda: ✅ pronto · 🟡 parcial · ❌ pendente · ⛔ N/A (não se aplica ao caso de uso).

## Pré-requisitos
- ✅ Conta Profissional (CNPJ Sister Tecnologia)
- ✅ Credenciais + merchant de teste (app `orzuni ifood`, loja 3972982)
- ✅ Aplicação com UI real (painel app.orzuni.com) — **não** curl
- 🟡 Cobertura dos critérios (ver abaixo)

## 1. Fundamentos do catálogo
- ✅ Criar/atualizar **categoria** (POST /categories) — backend + criada por nome na tela de item
- ✅ Criar **item simples** (PUT /items) — tela /item/novo
- ✅ Listar/recuperar (GET /catalogs, /items)

## 2. Complementos e estruturas especiais
- ✅ **Complementos** com min/max — construtor de grupos/opções na tela /item/novo
- ⛔ Pizza (loja não usa)
- ⛔ Combo (loja não usa)

## 3. Operações em produção
- ✅ Preço em massa (PATCH) — tela Preços
- ✅ Status em massa — multi-seleção no Cardápio → PATCH /status (lote)
- ✅ Contexto por canal (contextModifiers) — GET /contextos + seletor de canal em Preços; reprice/status por `?contexto` (loja de teste só tem DEFAULT, mas a capacidade está pronta)
- ✅ Agendamento de disponibilidade (shifts) — criar/editar item com janelas (horário + dias) na UI; provado (round-trip)
- ⛔ Multi-catálogo (loja tem 1 catálogo)

## 4. Qualidade e resiliência
- ✅ **Validação** (título ≤100, desc ≤500, preço >0, min/max) — backend + UI, antes de enviar
- ✅ Tratamento de erros (CONFLICT/NOT_FOUND/VALIDATION_ERROR → mensagens pt-BR)
- ✅ Retry com backoff (5xx/timeout; não 4xx)
- ✅ Sincronização ≤2s — atualização otimista (reflexão instantânea na UI)
- ✅ Performance 100+ em ≤10s — endpoints de lote

## Checklist de testes (extra)
- ✅ Auth OAuth 2.0
- ✅ Multi-idioma (pt/es/en) + acentos (UTF-8)
- ✅ Rate limiting + concorrência (throttler + retry concurrently-modified)
- ✅ Timeout >30s — AbortController de 30s no cliente iFood (retry/504)

## Plano de fases
- **H1** (bloqueadores): criar categoria + criar item (simples e c/ complementos) + validação + erros. Backend → Frontend.
- **H2** (operações/resiliência): status em massa na UI + timeout + sincronização ≤2s.
- **H3** (condicional): contexto por canal + shifts — esclarecer com o iFood se são exigidos.

## A esclarecer com o iFood (no ticket)
- Contexto por canal é exigido para loja **Delivery-only**? (a loja de teste não tem Cardápio Digital/salão)
- Agendamento (shifts) é exigido no caso de uso?
