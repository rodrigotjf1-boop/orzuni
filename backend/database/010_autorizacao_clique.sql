-- 010 — A autorização por clique (Padrão DMS §3; plano "Clique Regem → Orzuni", parte O1, 13/11/2026).
--
-- O aplicativo (o Regem, hoje) empurra o pedido de servidor para servidor, com o token do DMS ID (RFC 9126); o
-- navegador leva só o número. O dono da conta abre a página do Orzuni, escolhe a loja do iFood, liga as opcionais e
-- confirma com a senha; o Orzuni devolve um código de uso único (10 min) ao endereço de volta, e o aplicativo troca o
-- código pela ligação (`ligacao_dms`, a mesma do atalho de hoje), com o verificador do PKCE.
--
-- A 009 está reservada para o aceite dos termos (plano do jurídico, 11/11). Idempotente: pode rodar de novo.
-- Aplicar no SQL Editor do Supabase do Orzuni, ANTES do deploy que traz as rotas novas.

create table if not exists autorizacao_pedido (
  id               uuid primary key default gen_random_uuid(),
  numero_hash      text not null,                  -- sha-256 do número do pedido (o número nunca é guardado)
  aplicativo       text not null,                  -- client_id do DMS ID que pediu
  produto          text not null,                  -- o produto do mapa DMS_ID_APLICATIVOS (regem, ...)
  volta            text not null,                  -- endereço de volta, conferido contra a lista do aplicativo
  estado           text not null,                  -- o state do aplicativo: volta como veio
  desafio          text not null,                  -- code_challenge S256
  necessarias      jsonb not null default '[]'::jsonb,
  opcionais        jsonb not null default '[]'::jsonb,
  conta_pede       jsonb not null,                 -- {nome, cnpj, email, marca, loja, loja_id}: quem pede, no aplicativo
  criado_em        timestamptz not null default now(),
  vence_em         timestamptz not null,
  -- a decisão do dono
  decidido_em      timestamptz,
  recusado         boolean,
  tenant_id        uuid,
  usuario_id       uuid,
  conta_id         uuid references conta_ifood(id) on delete cascade,
  concedidas       jsonb,
  texto            text,                           -- o texto mostrado, guardado como prova
  versao_texto     int,
  -- o código de uso único
  codigo_hash      text,
  codigo_vence_em  timestamptz,
  trocado_em       timestamptz,
  ligacao_id       uuid references ligacao_dms(id) on delete set null,
  constraint ck_autorizacao_pedido_listas check (jsonb_typeof(necessarias) = 'array' and jsonb_typeof(opcionais) = 'array')
);
create unique index if not exists ux_autorizacao_pedido_numero on autorizacao_pedido (numero_hash);
create unique index if not exists ux_autorizacao_pedido_codigo on autorizacao_pedido (codigo_hash) where codigo_hash is not null;
create index if not exists ix_autorizacao_pedido_vence on autorizacao_pedido (vence_em);

-- As senhas erradas na página: 5 em 15 minutos travam a AUTORIZAÇÃO (não o login) por 15 minutos.
create table if not exists autorizacao_senha_erro (
  usuario_id uuid not null references usuario(id) on delete cascade,
  em         timestamptz not null default now()
);
create index if not exists ix_autorizacao_senha_erro on autorizacao_senha_erro (usuario_id, em);

-- A ligação guarda quem pediu (para a página saber se a loja já está ligada a OUTRA loja do aplicativo) e a
-- autorização que a criou (o texto que o dono leu, em "Aplicativos conectados").
alter table ligacao_dms add column if not exists conta_pede jsonb;
alter table ligacao_dms add column if not exists autorizacao_id uuid references autorizacao_pedido(id) on delete set null;
