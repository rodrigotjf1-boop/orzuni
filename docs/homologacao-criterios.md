# Homologação Catalog do iFood — checklist do Orzuni

> Estado do Orzuni frente aos critérios oficiais de homologação do módulo Catalog.
> Legenda: ✅ pronto · 🟡 parcial · ❌ pendente · ⛔ N/A (não se aplica ao caso de uso).

## Pré-requisitos
- ✅ Conta Profissional (CNPJ Sister Tecnologia)
- ✅ Credenciais + merchant de teste (app `orzuni ifood`, loja 3972982)
- ✅ Aplicação com UI real (painel app.orzuni.com) — **não** curl
- 🟡 Cobertura dos critérios (ver abaixo)

## 1. Fundamentos do catálogo
- ❌ Criar/atualizar **categoria** (POST /categories) — falta na UI
- ❌ Criar **item simples** (PUT /items) — UI só edita; falta "novo item"
- ✅ Listar/recuperar (GET /catalogs, /items)

## 2. Complementos e estruturas especiais
- ❌ **Complementos** com min/max — Editor mostra (read-only); falta criar/editar grupos
- ⛔ Pizza (loja não usa)
- ⛔ Combo (loja não usa)

## 3. Operações em produção
- ✅ Preço em massa (PATCH) — tela Preços
- 🟡 Status em massa — backend em lote; UI pausa 1 a 1 (falta multi-seleção)
- 🟡 Contexto por canal (contextModifiers) — só DEFAULT; loja de teste é Delivery-only (a esclarecer)
- ❌ Agendamento de disponibilidade (shifts) — não implementado
- ⛔ Multi-catálogo (loja tem 1 catálogo)

## 4. Qualidade e resiliência
- ❌ **Validação** (título ≤100, desc ≤500, preço >0, status enum) — antes de enviar
- 🟡 Tratamento de erros (CONFLICT/NOT_FOUND/VALIDATION_ERROR → mensagens claras)
- ✅ Retry com backoff (5xx/timeout; não 4xx)
- 🟡 Sincronização ≤2s — escrita assíncrona (batchId); validar
- ✅ Performance 100+ em ≤10s — endpoints de lote

## Checklist de testes (extra)
- ✅ Auth OAuth 2.0
- ✅ Multi-idioma (pt/es/en) + acentos (UTF-8)
- ✅ Rate limiting + concorrência (throttler + retry concurrently-modified)
- ❌ Timeout >30s — fetch sem timeout explícito

## Plano de fases
- **H1** (bloqueadores): criar categoria + criar item (simples e c/ complementos) + validação + erros. Backend → Frontend.
- **H2** (operações/resiliência): status em massa na UI + timeout + sincronização ≤2s.
- **H3** (condicional): contexto por canal + shifts — esclarecer com o iFood se são exigidos.

## A esclarecer com o iFood (no ticket)
- Contexto por canal é exigido para loja **Delivery-only**? (a loja de teste não tem Cardápio Digital/salão)
- Agendamento (shifts) é exigido no caso de uso?
