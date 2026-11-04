-- Orzuni · porta MCP (via DMS ID) — a ligação dms_lg_orzuni_
-- Guarda só o HASH do segredo + o prefixo visível; o valor em claro aparece uma
-- vez na troca. Aditivo e idempotente. Multi-tenant: tenant_id em toda linha.
create table if not exists ligacao_dms (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  conta_id      uuid not null references conta_ifood(id) on delete cascade,
  aplicativo    text not null,                 -- client_id do DMS ID dono da ligacao
  produto       text not null default 'orzuni',-- o produto que CONSOME (regem, ...)
  classe        text not null,                 -- dms | parceiro | proprio
  segredo_hash  text not null,                 -- sha-256 da chave inteira
  prefixo       text not null,                 -- dms_lg_orzuni_ab12c
  escopos       jsonb not null default '[]'::jsonb,
  criado_em     timestamptz not null default now(),
  segredo_em    timestamptz not null default now(),
  ultimo_uso_em timestamptz,
  revogada_em   timestamptz,
  revogada_por  text,
  constraint ck_ligacao_dms_classe check (classe in ('dms', 'parceiro', 'proprio')),
  constraint ck_ligacao_dms_escopos check (jsonb_typeof(escopos) = 'array')
);

create unique index if not exists ux_ligacao_dms_segredo on ligacao_dms (segredo_hash);
-- Uma ligação ATIVA por loja e aplicativo (repetir a troca gira o segredo).
create unique index if not exists ux_ligacao_dms_ativa on ligacao_dms (conta_id, aplicativo) where revogada_em is null;
