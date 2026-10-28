-- 004_usuario.sql — contas de usuário (revenda).
-- Login por e-mail + senha (hash scrypt). SEM confirmação por e-mail nesta fase.
-- Cada conta tem seu próprio tenant (multi-tenant real vem na F2: conta_ifood e
-- api_key passam a referenciar o tenant da conta; TENANT_PADRAO = distribuição/nós).

create table if not exists usuario (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default gen_random_uuid(),   -- o "tenant" da conta
  email        text not null,
  senha_hash   text not null,                             -- scrypt: "<salt hex>:<hash hex>"
  criado_em    timestamptz not null default now(),
  ultimo_login timestamptz
);

-- e-mail único (case-insensitive)
create unique index if not exists ux_usuario_email on usuario (lower(email));
