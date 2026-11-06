-- 006_tenant_fundacao.sql — Fundação multi-tenant (Fase 0).
-- Cada conta de usuário (usuario.tenant_id, default gen_random_uuid() em 004) vê
-- só as PRÓPRIAS lojas. A resolução de loja por sessão consulta conta_ifood pelo
-- tenant do usuário logado — este índice cobre essa consulta.
-- NADA de coluna nova: tenant_id já existe em usuario/conta_ifood/api_key.
-- NÃO mexe nas linhas TENANT_PADRAO existentes. Idempotente.

create index if not exists ix_conta_ifood_tenant
  on conta_ifood (tenant_id)
  where status = 'connected';
