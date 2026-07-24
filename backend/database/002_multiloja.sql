-- Orzuni · multi-loja
-- Liga uma chave de API a UMA loja (conta_ifood). Aditivo e seguro:
-- chaves antigas ficam com conta_id NULL (não ligadas → acessam a loja padrão).

alter table api_key add column if not exists conta_id uuid references conta_ifood(id) on delete set null;
create index if not exists ix_api_key_conta on api_key(conta_id) where revogada_em is null;

-- Garante a coluna `ativo` semântica via status (o schema já tem status default 'connected').
-- Nada mais a fazer: conta_ifood já é o registro de lojas (tenant_id + merchant_id + nome + status).
