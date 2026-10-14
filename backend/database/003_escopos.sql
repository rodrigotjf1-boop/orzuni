-- 003_escopos.sql — liga a checagem de permissão por chave sem quebrar ERP existente.
--
-- O guard passa a exigir o escopo da rota (403 sem) e o teto por chave (429).
-- Chaves criadas antes disso só têm o escopo padrão {catalogo:ler} e parariam de
-- escrever. Então AMPLIAMOS as antigas (só as que ainda estão no padrão) para o
-- conjunto completo — o que elas fazem hoje continua valendo; o dono estreita
-- depois pela tela "API & ERP".
--
-- Idempotente: após rodar, nenhuma chave fica no padrão {catalogo:ler}, então
-- reaplicar é no-op. Chaves novas escolhem o escopo na criação.

update api_key
   set escopos = ARRAY[
     'catalogo:ler','catalogo:escrever','preco:escrever','status:escrever',
     'loja:ler','loja:escrever','vigia:ler','vigia:escrever'
   ]
 where revogada_em is null
   and escopos = ARRAY['catalogo:ler']::text[];
