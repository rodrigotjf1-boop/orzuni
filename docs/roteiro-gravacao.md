# Roteiro de gravação — homologação Catalog (por vídeo)

> A homologação do iFood é **por vídeo** (sem sessão ao vivo). Grave a interface
> (`app.orzuni.com`) executando os cenários abaixo. Envie os links (Google Drive,
> com acesso liberado) + o **Client ID do app de teste** no chamado.

## Antes de gravar
- **App de teste / Client ID a informar:** Teste (C) — `b95f3eaa-a651-4372-9780-deabd72c3370`
  (o Orzuni já está apontado para ele; loja Ativa com itens reais).
- **No ticket**, deixe uma linha: "evidências gravadas no app de teste Teste C
  (b95f3eaa); app a homologar: orzuni ifood (060f1a4d)".
- **Regras da gravação:** tela inteira; **data e hora do computador visíveis**;
  cada ação deve virar requisição real (o Orzuni faz isso via a API). Narração opcional.
- Faça login em `app.orzuni.com` antes de começar.

## Cenários (Catalog) — grave um a um, na ordem

1. **Autenticação + listar catálogos + recuperar itens**
   Abra o **Cardápio**. Mostre os itens reais carregando (vindos da API). Isso já
   cobre auth OAuth + GET /catalogs + leitura de itens.

2. **Criar categoria + item simples**
   Cardápio → **+ Novo item** → nome, descrição, preço; em Categoria digite uma
   **categoria nova** (ex.: "Lanches Teste") → **Criar item**. Volte ao Cardápio e
   mostre o item aparecendo na nova categoria. (POST /categories + PUT /items)

3. **Criar item com complementos (≥2 grupos, min/max)**
   + Novo item → nome/preço/categoria → em **Complementos**: adicione o grupo
   "Ponto da carne" (mín 1 / máx 1, opções "Mal passado", "Ao ponto") e o grupo
   "Adicionais" (mín 0 / máx 3, opções "Bacon" R$4, "Cheddar" R$3,50) → **Criar**.
   Abra o item criado e mostre os complementos. (PUT /items com optionGroups)

4. **Atualizar preço (reflete rápido)**
   Cardápio → clique no nome de um item (Editor) → mude o **preço** → **Publicar**.
   Mostre refletindo na hora e depois no Cardápio. (PATCH de preço)

5. **Atualizar status (pausar/reativar)**
   Cardápio → **Pausar** um item → mostre a etiqueta "pausado" → **Reativar**.
   (PATCH de status)

6. **Preço em massa**
   Menu **Preços** → edite o preço de **vários** itens (o contador "N pendentes"
   aparece) → **Publicar N preços** (uma chamada em lote). (PATCH /products/price)

7. **Status em massa**
   Cardápio → marque as **caixas de seleção** de vários itens → barra "N selecionados"
   → **Pausar selecionados** → mostre; depois **Reativar selecionados**.
   (PATCH /products/status em lote)

8. **Agendamento de disponibilidade (shifts)**
   + Novo item (ou Editor de um item) → seção **Disponibilidade** → **+ Janela de
   horário** → escolha os dias (ex.: seg-sex) e o horário (ex.: 11:00–15:00) →
   **Criar/Publicar**. Abra o item e mostre a disponibilidade salva. (PUT /items com shifts)

9. **Validação de dados + tratamento de erro**
   + Novo item → deixe o **nome vazio** e **preço negativo** → mostre a mensagem de
   **erro** (o app não envia dados inválidos). Corrija e crie. Se quiser reforçar,
   tente criar um item com um **código de PDV já existente** e mostre a mensagem de
   **conflito** (CONFLICT). (validação + erros claros)

## Ressalvas (dois critérios)
- **Contexto por canal (contextModifiers):** a loja de teste só tem o canal
  **Delivery (DEFAULT)** — não há como *mostrar* preços diferentes por canal sem uma
  loja multi-canal. O app tem o seletor de canal (tela Preços), mas a demonstração
  de preço-por-canal exige loja com Cardápio Digital/salão. **Abrir chamado separado**
  perguntando se é exigido para integração Food Delivery single-channel.
- **Módulo Merchant:** avaliar os critérios do Merchant antes de incluir no vídeo
  (podem exigir abrir/fechar loja, horários — que o app não faz). Recomendação:
  homologar **Catalog** primeiro; Merchant depois, se necessário.

## Depois
- Suba os vídeos no Google Drive, **libere o acesso** e cole os links no chamado de
  homologação, junto com o Client ID `b95f3eaa-...`.
- Ao fim, apague as categorias/itens de teste criados (ou deixe — a loja é de teste).
