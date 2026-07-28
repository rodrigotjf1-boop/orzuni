# Roteiro de gravação — homologação Catalog (por vídeo)

> A homologação do iFood é **por vídeo**. Grave a **interface** (`app.orzuni.com`)
> executando os cenários abaixo — cada ação vira uma **requisição real** à API.
> Envie os links (Google Drive, acesso liberado) + o **Client ID do app** no chamado.
> **Chamadas curl causam cancelamento** — filme sempre a tela do app.

## Antes de gravar

- **Login** em `app.orzuni.com` antes de começar.
- **Tela inteira**, com **data e hora do computador visíveis**.
- **Client ID a informar no ticket:** (o do app que você vai homologar — informar junto com os vídeos).
- **Modelo de negócio:** food delivery, 1 catálogo, canal Delivery. Por isso:
  **Multi-catálogo = N/A** (não grave). **Contexto por canal**: filme o *mecanismo*
  (seletor de canal) — a loja de teste só tem o canal Delivery, então não há como
  *mostrar* preços diferentes entre canais sem uma loja multi-canal (ver Ressalvas).
- Dica: grave **na ordem** — os cenários finais reaproveitam itens criados nos primeiros.

---

## Parte A — Fundamentos e leitura (critério 1)

### A1. Autenticação + listar catálogo + recuperar itens
Abra o **Cardápio**. Os itens reais carregam da API.
→ cobre **OAuth 2.0** + **GET /catalogs** + leitura de itens. *(1. Listagem e recuperação)*

### A2. Criar categoria + item simples
**Cardápio → + Novo item** → nome, descrição, preço; em **Categoria** digite uma
**categoria nova** (ex.: "Lanches Teste") → **Criar item**. Volte ao Cardápio e mostre
o item na categoria nova.
→ **POST /categories** + **PUT /items**. *(1. Gerenciamento de categorias + Criação de item simples)*

---

## Parte B — Complementos e estruturas especiais (critério 2)

### B1. Item com complementos (≥2 grupos, min/max)
**+ Novo item** → nome/preço/categoria → em **Complementos** adicione **2 grupos**:
- "Ponto da carne" (mín 1 / máx 1: "Mal passado", "Ao ponto")
- "Adicionais" (mín 0 / máx 3: "Bacon" R$4, "Cheddar" R$3,50)
→ **Criar**. Abra o item e mostre os complementos. *(2. Complementos com min/max)*

### B2. 🍕 Pizza (SIZE / CRUST / EDGE / TOPPING)
**Cardápio → + Pizza**. Preencha:
- **Tamanhos**: Pequena (4 fatias, máx 1 sabor, R$20), Média (8, máx 2, R$25), Grande (12, máx 2, R$32)
- **Massas**: Tradicional (R$0), Fina (R$2)
- **Bordas**: Tradicional (R$0), Catupiry (R$3)
- **Sabores**: Calabresa, Margherita
→ **Criar pizza**. Abra a pizza criada e mostre os **4 grupos**.
*(2. Pizza — grupos obrigatórios SIZE/CRUST/EDGE/TOPPING)*

### B3. 🍔 Combo (grupos principais + modificador aninhado)
**Cardápio → + Combo**. Monte:
- Grupo **"Escolha o lanche"** (marque **principal**, mín 1/máx 1): opções "X-Burger" (R$15),
  "X-Bacon" (R$18). Em **X-Burger** adicione **customização** "Ponto da carne"
  (especificação: "Ao ponto", "Bem passado") e "Retirar" (ingredientes: "Sem alface").
- Grupo **"Bebida"** (mín 1/máx 1): "Coca" (R$8), "Guaraná" (R$8).
→ **Criar combo**. Abra e mostre os grupos + a customização aninhada.
*(2. Combo — grupo principal MAIN + modificadores aninhados)*

---

## Parte C — Operações do dia a dia (critério 3)

### C1. Atualizar preço (reflete ≤2s)
**Cardápio → clique no nome de um item** (Editor) → mude o **preço** → **Publicar**.
Mostre refletindo na hora e depois no Cardápio.
*(3. + 4. Sincronização em tempo real ≤2s)*

### C2. Atualizar status (pausar / reativar)
**Cardápio → Pausar** um item → mostre a etiqueta "pausado" → **Reativar**.
*(3. Atualização de status)*

### C3. Preço em massa (uma chamada, vários itens)
**Menu Preços** → edite o preço de **vários** itens (aparece "N pendentes") →
**Publicar N preços**.
*(3. Atualização em massa de preços — PATCH lote)*

### C4. Status em massa (uma chamada, vários itens)
**Cardápio → marque as caixas** de vários itens → barra "N selecionados" →
**Pausar selecionados** → mostre → **Reativar selecionados**.
*(3. Atualização em massa de status — PATCH lote)*

### C5. Contexto por canal (mecanismo)
**Menu Preços** → mostre o **seletor de canal** (Delivery / Cardápio Digital / Salão).
Explique que os preços são publicados **por canal** (`contextModifiers`).
*(3. Customização por contexto — ver Ressalvas: loja de teste é só Delivery)*

### C6. Agendamento de disponibilidade (shifts)
**+ Novo item** (ou no Editor) → seção **Disponibilidade → + Janela de horário** →
escolha dias (ex.: seg–sex) e horário (ex.: 11:00–15:00) → **Criar/Publicar**.
Abra o item e mostre a disponibilidade salva.
*(3. Agendamento de disponibilidade)*

---

## Parte D — Qualidade, validação e erros (critério 4)

### D1. Validação de dados
**+ Novo item** → deixe **nome vazio** e **preço negativo** → mostre a **mensagem de erro**
(o app **não envia** dados inválidos). Corrija e crie.
*(4. Validação — título ≤100, descrição ≤500, preço positivo)*

### D2. Tratamento de erros (CONFLICT / NOT_FOUND)
Tente criar um item com um **código de PDV já existente** → mostre a mensagem de
**conflito** (CONFLICT) clara.
*(4. Tratamento de erros — mensagens compreensíveis, sem falha silenciosa)*

### D3. Multi-idioma + caracteres especiais
Crie itens com títulos em **pt-BR** ("Pão de Alho à Moda"), **es-CO** ("Empanada con Ají")
e **en-US** ("Grilled Chicken") → mostre os **acentos** corretos no Cardápio.
*(Checklist — suporte multi-idioma + caracteres especiais)*

### D4. Texto longo (50+ caracteres)
Crie um item com **nome/descrição longos** (>50 caracteres) e mostre o contador
(nome …/100, descrição …/500) e o item salvo.
*(Checklist — estrutura de itens: 50+ caracteres)*

---

## Ressalvas (diga isto no vídeo ou no ticket)

- **Contexto por canal:** a loja de teste opera **só Delivery**, então não há um segundo
  canal para *mostrar* preços diferentes. O app **tem** o mecanismo (seletor de canal,
  publicação por `contextModifiers`). Se o iFood exigir a diferença por canal, basta uma
  loja de teste com **Cardápio Digital** habilitado.
- **Multi-catálogo:** N/A (1 catálogo) — marcado "(se aplicável)".
- **Retry/backoff, rate limiting, timeout 30s, concorrência, JSON inválido→400:** são
  critérios **de código/comportamento**, não de tela. Estão implementados (retry
  exponencial 5xx/timeout no cliente iFood; `AbortController` de 30s; retry de
  "concurrently modified"; throttler; validação antes do envio). Se o analista pedir,
  mostre o código — não precisam de cena no vídeo.

---

## Cobertura dos critérios (checklist para conferir antes de enviar)

| Critério | Cenário | Filma na UI? |
|---|---|---|
| 1. Categorias (POST /categories) | A2 | ✅ |
| 1. Item simples (PUT /items) | A2 | ✅ |
| 1. Listar/recuperar (GET /catalogs, /items) | A1, C1 | ✅ |
| 2. Complementos min/max | B1 | ✅ |
| 2. Pizza (SIZE/CRUST/EDGE/TOPPING) | B2 | ✅ |
| 2. Combo (principal + aninhado) | B3 | ✅ |
| 3. Preço em massa | C3 | ✅ |
| 3. Status em massa | C4 | ✅ |
| 3. Contexto por canal | C5 | ⚠️ mecanismo (single-channel) |
| 3. Agendamento (shifts) | C6 | ✅ |
| 3. Multi-catálogo | — | ⛔ N/A |
| 4. Validação | D1 | ✅ |
| 4. Tratamento de erros | D2 | ✅ |
| 4. Sincronização ≤2s | C1, C2 | ✅ |
| 4. Performance em massa | C3, C4 | ✅ |
| 4. Retry / rate-limit / timeout 30s / concorrência | — | 🔒 código |
| Multi-idioma + acentos | D3 | ✅ |
| Texto 50+ / campos faltando / 404 | D4, D1 | ✅ |
| OAuth 2.0 | A1 | ✅ |

## Depois de gravar
- Suba no Google Drive, **libere o acesso**, cole os links no chamado de homologação
  junto com o **Client ID** do app.
- Apague as categorias/itens de teste (ou deixe — é loja de teste).
