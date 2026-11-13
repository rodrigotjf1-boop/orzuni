# Conectar pelo Regem (a conexão de "Importar do Regem" por clique)

> Do lado do Orzuni. O contrato da porta do Regem está em `docs/integracao-orzuni.md` do repositório do Regem; o plano
> é o documento "Clique Orzuni → Regem" do Hub DMS (F6, 13/11/2026).

## O que é

"Importar do Regem" lê o cardápio da loja no Regem (`GET /api/v1/integracao/catalogo`) e cria no iFood o que falta.
Para ler, o Orzuni precisa da autorização da loja. Ela nasce de dois jeitos:

| Jeito | Como | Credencial guardada |
|---|---|---|
| **Pelo clique** (o caminho principal) | O dono clica em "Conectar pelo Regem", autoriza como presidente na página do Regem e volta ligado | A ligação da loja, `dms_lg_regem_…`, cifrada |
| **Pela chave colada** (suporte) | A distribuição emite a chave `rgm_it_` da loja e o dono cola em "Tenho uma chave de integração" | A chave, cifrada |

`conexao_regem.origem` diz qual vale (`clique` ou `chave`). O que o Orzuni lê é o mesmo nos dois: o cardápio e o preço do
iFood. Nenhuma escrita, nada de vendas nem de clientes.

## O caminho do clique (Padrão DMS §3)

1. **Começar** — `POST /v1/importar-regem/clique/iniciar` (sessão do dono). O servidor gera o `state` e o par do PKCE,
   pede ao DMS ID o token do aplicativo do Orzuni para o recurso do Regem e empurra o pedido:
   `POST {Regem}/api/v1/integracao/autorizacao/pedido`, com `scope=catalogo.ler catalogo.ifood.ler`, o endereço de
   volta e a conta que pede (o nome da loja do iFood e o e-mail da conta; o Orzuni não tem CNPJ da conta). Guarda o
   pedido em `conexao_regem_pedido` (só o resumo do `state`; o verificador, cifrado) e devolve a página do Regem.
2. **Autorizar** — o navegador vai a `app.dmsregem.com/integracoes/autorizar`. O presidente marca a loja e confirma com
   a senha. Como a conta vem sem CNPJ, o Regem pede a confirmação de "outra empresa".
3. **Voltar** — o Regem devolve o navegador a `/importar/volta` com `code`, `state` e `iss`. A página entrega isso a
   `POST /v1/importar-regem/clique/concluir`.
4. **Concluir** — o servidor confere o `iss` (tem de ser a origem da API do Regem), gasta o pedido (uma vez só, de quem
   começou, em até 10 minutos) e troca o código: `POST {Regem}/api/v1/integracao/autorizacao/token`. Guarda a ligação de
   cada loja marcada em `conexao_regem_ligacao` (cifrada) e põe uma em uso em `conexao_regem`.

Regras que o código garante (testes em `regem-clique.regras.spec.ts` e `regem-clique.pg.spec.ts`):

- a volta sem o `iss` do Regem é recusada antes de procurar o pedido;
- o `state` de uma conta não vale para outra, vale uma vez e vence em 10 minutos;
- o presidente cancelou (`error=access_denied`): o pedido é gasto e nada muda;
- resposta torta do Regem (segredo com outra cara, sem a leitura do cardápio): nada é guardado;
- o segredo da ligação nunca fica em claro no banco nem vai para a tela ou o log;
- com mais de uma loja marcada, a primeira entra em uso e a tela deixa trocar (`POST /v1/importar-regem/loja`), só
  entre as lojas ligadas àquela conta. Trocar de loja zera o resumo da importação.

## A leitura pela ligação

Com `origem = 'clique'`, a chamada ao Regem leva o token do DMS ID do Orzuni no `Authorization` e a ligação da loja no
`DMS-Ligacao`. No `401`, o servidor pede outro token ao DMS ID e tenta uma vez mais. Se a recusa continuar (a loja
desligou o Orzuni em Configurações › Aplicativos conectados, no Regem), a tela manda conectar de novo.

Quando o presidente autoriza pelo clique, o Regem troca o acesso antigo daquela loja: a chave `rgm_it_` que o Orzuni
tinha para ela para de valer na hora.

## O que a distribuição configura

Tudo nasce desligado: sem `ORZUNI_REGEM_CLIQUE=true`, a tela é a de antes (só a chave colada) e as rotas do clique
recusam.

| Onde | O quê |
|---|---|
| Supabase do Orzuni (SQL Editor) | A migration `011_conexao_regem_clique.sql`, **antes** do deploy. A conferência do fim tem de vir com três linhas `ok = true`. |
| DMS ID | O aplicativo do Orzuni com as permissões `catalogo.ler` e `catalogo.ifood.ler` no recurso do Regem. |
| EasyPanel, API do Regem | `DMS_ID_APLICATIVOS` com `"orzuni":"<client_id do aplicativo do Orzuni>"`. |
| EasyPanel, API do Orzuni | `ORZUNI_REGEM_CLIQUE=true`. O aplicativo é o mesmo do hub: `DMS_ID_EMISSOR`, `HUB_APLICATIVO` e `HUB_SEGREDO`, que já existem. |

Só para teste e desenvolvimento: `ORZUNI_REGEM_BASE` (a API do Regem), `ORZUNI_REGEM_APP_URL` (o site do Regem) e
`ORZUNI_APP_URL` (o site do Orzuni). Os padrões são os de produção. O endereço de volta
(`<site do Orzuni>/importar/volta`) tem de estar na ficha do Orzuni no Regem.
