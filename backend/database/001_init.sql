-- Orzuni · schema inicial
-- Postgres. Aplicar com scripts/apply-sql.mjs (DATABASE_URL do .env).
-- Multi-tenant desde já: toda linha tem tenant_id (o cliente do Orzuni).

-- ── Contas / lojas iFood vinculadas ────────────────────────────────────────
-- No modo centralizado as credenciais do APP ficam no .env (não aqui).
-- Esta tabela guarda só o vínculo tenant ↔ merchant e um snapshot da loja.
create table if not exists conta_ifood (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  merchant_id   text not null,                 -- UUID da loja no iFood
  nome          text,
  catalog_id    text,
  group_id      text,
  contexto      text[] default '{DEFAULT}',
  status        text not null default 'connected',  -- connected | revoked
  modified_at   timestamptz,                   -- último modifiedAt do catálogo (guarda de concorrência)
  criado_em     timestamptz not null default now(),
  unique (tenant_id, merchant_id)
);

-- ── Estado por item (memória do vigia) ─────────────────────────────────────
-- O "desde" é o que o iFood não dá: quando o item entrou no estado atual.
create table if not exists item_estado (
  conta_id       uuid not null references conta_ifood(id) on delete cascade,
  item_id        text not null,
  external_code  text,
  nome           text,
  no_ar          boolean not null,
  desde          timestamptz not null,         -- entrou no estado atual
  atualizado_em  timestamptz not null default now(),
  primary key (conta_id, item_id)
);
create index if not exists ix_item_estado_fora on item_estado(conta_id) where no_ar = false;

-- ── Alertas (histórico de quedas) ──────────────────────────────────────────
-- Append-only: cada queda vira uma linha; resolvido_em preenche ao voltar.
create table if not exists alerta (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null references conta_ifood(id) on delete cascade,
  item_id        text not null,
  external_code  text,
  nome           text,
  motivo         text not null,                -- cascade | manual | stock | unknown
  grupo_afetado  text,
  caiu_em        timestamptz not null,
  resolvido_em   timestamptz,
  criado_em      timestamptz not null default now()
);
create index if not exists ix_alerta_aberto on alerta(conta_id) where resolvido_em is null;

-- ── Chaves de API (para ERP/CRM do cliente) ────────────────────────────────
-- Guardar só o hash do segredo; o valor em claro aparece uma vez na criação.
create table if not exists api_key (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  nome         text not null,                  -- "Saipos · Burger Centro"
  prefixo      text not null,                  -- orz_live_9f2c (mostrável)
  hash         text not null,                  -- sha-256 do segredo completo
  escopos      text[] not null default '{catalogo:ler}',
  rate_limit   int not null default 120,       -- req/min
  ultimo_uso   timestamptz,
  revogada_em  timestamptz,
  criado_em    timestamptz not null default now()
);
create index if not exists ix_api_key_tenant on api_key(tenant_id) where revogada_em is null;
