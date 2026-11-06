-- 007_conexao_regem.sql — conexão de leitura do cardápio do Regem (import Regem→iFood).
-- Um registro por tenant (a conta do usuário). O token de integração do Regem fica
-- CIFRADO (AES-256-GCM, common/cifra.ts) — nunca em claro. Só-nuvem na prática, mas
-- idempotente e inofensivo em qualquer banco. Aplicação na nuvem: o dono.
create table if not exists conexao_regem (
  tenant_id         uuid primary key,
  base_url          text not null,                 -- origem do Regem (https), informada pelo dono da conta
  token_cifrado     text not null,                 -- token de integração do Regem, cifrado
  ultima_importacao timestamptz,
  ultimo_resumo     jsonb,                          -- {criados, jaExistiam, semCodigo, semPrecoIfoodOuNoIfood, falhas}
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
