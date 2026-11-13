-- 011 — "Conectar pelo Regem": a conexão de leitura do cardápio do Regem nasce por clique (Padrão DMS §3; plano
-- "Clique Orzuni → Regem" do hub, 13/11/2026).
--
-- Até aqui o dono da conta colava a chave de integração do Regem (`conexao_regem.token_cifrado`, migration 007). Agora
-- o Orzuni PEDE: empurra o pedido ao Regem com o token do DMS ID, o presidente autoriza na página do Regem e o Orzuni
-- troca o código pela LIGAÇÃO de cada loja marcada (`dms_lg_regem_…`). A chave colada segue valendo para quem já tem.
--
--   • conexao_regem.origem        como a conexão nasceu: 'chave' (colada) ou 'clique' (a ligação do DMS ID);
--   • conexao_regem.loja_regem_*  a loja do Regem em uso (uma por conta, como hoje);
--   • conexao_regem_ligacao       a ligação de cada loja que o presidente marcou, cifrada (common/cifra.ts);
--   • conexao_regem_pedido        o pedido em andamento: o `state` (só o resumo) e o verificador do PKCE (cifrado),
--                                 presos a quem começou. Vale 10 minutos e uma vez só.
--
-- A 009 segue reservada para o aceite dos termos. Idempotente: pode rodar de novo.
-- Aplicar no SQL Editor do Supabase do Orzuni, ANTES do deploy que traz as rotas novas.

alter table conexao_regem add column if not exists origem text not null default 'chave';
alter table conexao_regem add column if not exists loja_regem_id text;
alter table conexao_regem add column if not exists loja_regem_nome text;

do $$
begin
  if not exists (
    select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
     where c.conname = 'ck_conexao_regem_origem' and n.nspname = current_schema()
  ) then
    alter table conexao_regem add constraint ck_conexao_regem_origem check (origem in ('chave', 'clique'));
  end if;
end $$;

create table if not exists conexao_regem_ligacao (
  tenant_id        uuid not null,
  loja_regem_id    text not null,                  -- o id da loja no Regem (como a troca devolve)
  loja_regem_nome  text,
  ligacao_cifrada  text not null,                  -- o segredo da ligação, cifrado; nunca em claro
  prefixo          text,                           -- o começo do segredo, para o suporte reconhecer
  permissoes       text[] not null default '{}',
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  primary key (tenant_id, loja_regem_id)
);

create table if not exists conexao_regem_pedido (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  usuario_id           uuid not null references usuario(id) on delete cascade,
  estado_hash          text not null,              -- sha-256 do state (o state nunca é guardado)
  verificador_cifrado  text not null,              -- o verificador do PKCE, cifrado
  criado_em            timestamptz not null default now(),
  vence_em             timestamptz not null,
  usado_em             timestamptz
);
create unique index if not exists ux_conexao_regem_pedido_estado on conexao_regem_pedido (estado_hash);
create index if not exists ix_conexao_regem_pedido_vence on conexao_regem_pedido (vence_em);

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'conexao_regem: origem, loja_regem_id e loja_regem_nome' as objeto,
       (select count(*) = 3 from information_schema.columns
         where table_schema = current_schema() and table_name = 'conexao_regem'
           and column_name in ('origem', 'loja_regem_id', 'loja_regem_nome')) as ok
union all
select 'tabela conexao_regem_ligacao', to_regclass(current_schema() || '.conexao_regem_ligacao') is not null
union all
select 'tabela conexao_regem_pedido', to_regclass(current_schema() || '.conexao_regem_pedido') is not null;
