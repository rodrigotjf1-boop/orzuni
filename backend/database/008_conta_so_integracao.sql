-- 008_conta_so_integracao.sql — marca "loja de teste de integração" em conta_ifood.
--
-- Uma loja marcada `so_integracao` existe para o KIT DE CONFORMIDADE do hub (modo
-- dms_id): a porta MCP a aceita como conta normal (status connected → troca de
-- ligação e leituras só-banco como alertas_listar), mas o VIGIA/POLLER e qualquer
-- rotina que chama o iFood NÃO a varrem (o merchant é inventado), e o LOJISTA não a
-- vê. Só o admin cria/apaga (tela "API / ERP" ou POST /v1/lojas com a marca).
--
-- Aditivo e inofensivo: `default false` mantém toda loja existente como estava.
alter table conta_ifood add column if not exists so_integracao boolean not null default false;
