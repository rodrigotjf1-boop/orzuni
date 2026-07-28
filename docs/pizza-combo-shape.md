# Shape real de Pizza e Combo (Catalog API v2)

> Capturado da doc oficial logada (`developer.ifood.com.br/pt-BR/docs/guides/modules/catalog/guides/{pizza,combos}`)
> em 2026-07-27. Fonte da verdade para o builder do Orzuni. Pizza = confirmado por
> curl + guia completo. Combo = **A PREENCHER** (guia ainda não lido).

## 🍕 Pizza

Item especial com **4 grupos obrigatórios**. Se faltar qualquer um → **422 Unprocessable Entity**.
A loja aceita **no máximo 1 categoria `template: "PIZZA"`**.

### Grupos obrigatórios (`optionGroupType` exato)
| Grupo | optionGroupType | Obrigatório | min/max no produto |
|---|---|---|---|
| Tamanhos | `SIZE` | Sim | 1..1 |
| Massas | `CRUST` | Sim | 1..1 |
| Bordas | `EDGE` | Sim | 0..1 (opcional p/ cliente) |
| Sabores | `TOPPING` | Sim | 1..1 |

### Onde mora cada coisa (do curl real de PUT /items)
- **`item.type = "PIZZA"`**, sem `price` no item (o preço vem do tamanho). Precisa de `categoryId` de categoria PIZZA.
- **Produto principal** referencia os 4 grupos em `optionGroups: [{id, min, max}]`.
- **Preço-base = na opção de SIZE** (`opt-pequena` R$25, `opt-media` R$32, `opt-grande` R$42).
- **CRUST e EDGE têm `price` próprio** na opção (massa fina +R$2, borda recheada +R$3; tradicional 0).
- **Sabor (TOPPING)**: `price` plano na opção (0 no exemplo básico).
- **Meio a meio (fractions)**: campo **`fractions`** na opção de SIZE = quantos sabores aquele tamanho aceita.
  Ex.: Pequena `[1,2]` (aceita até 2), Média `[1,2,3]`, Grande `[1,2,3,4]`.
- **Fatias**: `quantity` no PRODUTO do tamanho (Pequena 4, Média 8, Grande 12).
- Cada tamanho/massa/borda/sabor é um **produto próprio** + uma **option** que o referencia por `productId`.

### Preço de sabor POR tamanho (avançado, opcional — NÃO exigido p/ homologar)
A opção de sabor pode ter **`parentCustomizationOptionId`** apontando p/ a opção de SIZE, com `price` daquela combinação:
```json
{ "id": "opt-calabresa", "parentCustomizationOptionId": "opt-media", "price": { "value": 2.0 } }
```
Matriz: cada (sabor × tamanho) vira uma option amarrada ao tamanho. Ex.: Margherita +R$2 (Pequena) / +R$3 (Média) / +R$4 (Grande).

### Payload de referência (PUT /items) — pizza mínima válida
```json
{
  "item": { "id": "...", "type": "PIZZA", "status": "AVAILABLE", "externalCode": "pizza_calabresa" },
  "products": [
    { "id": "prod-pizza", "name": "Calabresa", "externalCode": "calabresa_prod",
      "optionGroups": [ {"id":"g-size","min":1,"max":1}, {"id":"g-crust","min":1,"max":1},
                        {"id":"g-edge","min":0,"max":1}, {"id":"g-topping","min":1,"max":1} ] },
    { "id": "prod-pequena", "name": "Pequena", "quantity": 6 },
    { "id": "prod-media",   "name": "Média",   "quantity": 8 },
    { "id": "prod-grande",  "name": "Grande",  "quantity": 12 },
    { "id": "prod-massa-trad", "name": "Massa Tradicional" },
    { "id": "prod-borda-trad", "name": "Borda Tradicional" },
    { "id": "prod-calabresa",  "name": "Calabresa" }
  ],
  "optionGroups": [
    { "id": "g-size",    "name": "Tamanho", "status": "AVAILABLE", "optionGroupType": "SIZE",    "optionIds": ["opt-pequena","opt-media","opt-grande"] },
    { "id": "g-crust",   "name": "Massa",   "status": "AVAILABLE", "optionGroupType": "CRUST",   "optionIds": ["opt-massa-trad"] },
    { "id": "g-edge",    "name": "Borda",   "status": "AVAILABLE", "optionGroupType": "EDGE",    "optionIds": ["opt-borda-trad"] },
    { "id": "g-topping", "name": "Sabor",   "status": "AVAILABLE", "optionGroupType": "TOPPING", "optionIds": ["opt-calabresa"] }
  ],
  "options": [
    { "id": "opt-pequena", "productId": "prod-pequena", "status": "AVAILABLE", "index": 0, "price": {"value": 25.0}, "fractions": [1,2] },
    { "id": "opt-media",   "productId": "prod-media",   "status": "AVAILABLE", "index": 1, "price": {"value": 32.0}, "fractions": [1,2,3] },
    { "id": "opt-grande",  "productId": "prod-grande",  "status": "AVAILABLE", "index": 2, "price": {"value": 42.0}, "fractions": [1,2,3,4] },
    { "id": "opt-massa-trad", "productId": "prod-massa-trad", "status": "AVAILABLE", "index": 0, "price": {"value": 0} },
    { "id": "opt-borda-trad", "productId": "prod-borda-trad", "status": "AVAILABLE", "index": 0, "price": {"value": 0} },
    { "id": "opt-calabresa",  "productId": "prod-calabresa",  "status": "AVAILABLE", "index": 0, "price": {"value": 0} }
  ]
}
```

### ⚠️ BLOQUEIO ao vivo (2026-07-27, loja Teste C 77e41b59)
Toda tentativa de `PUT /items` de PIZZA nessa loja é recusada com **400
`Pizza topping option <id> must be linked with all sizes in all contexts`** — inclusive:
- sabor **plano** (o exato do exemplo da doc, só que com UUIDs) → recusa;
- **uma opção por (sabor×tamanho)** com `parentCustomizationOptionId` → recusa (o validador
  cobra CADA opção como "linked with all sizes", o que um único parent não satisfaz);
- opção-base + por-tamanho, e parent = id do produto do tamanho → recusam igual;
- com e sem `categoryId`, com `externalCode` nas opções → mesma recusa.

Ou seja: **o exemplo de criação da doc não passa nessa loja**. A estrutura que o validador
aceita para amarrar 1 sabor a TODOS os tamanhos numa única opção não está documentada no guia
de criação (a doc só mostra `parentCustomizationOptionId` no fluxo de UPDATE `PATCH /options/price`).
requestIds para suporte: 86f86f59, 96a96fce, ed228605, 8f8289c1, 7af9d350.
**Combo está OK** (COMBO_V2 provado ao vivo). Pizza pendente: precisa do `/flat` de uma pizza
real OU de resposta do suporte iFood sobre o shape exato do TOPPING na criação.

### Endpoints de opção (novos, além dos já usados)
- **`PATCH /merchants/{m}/options/price`** — corpo `{ optionId, parentCustomizationOptionId?, price:{value}, priceByCatalog?:[{value, catalogContext}] }`.
- **`PATCH /merchants/{m}/options/status`** — corpo `{ optionId, parentCustomizationOptionId?, status, statusByCatalog?:[{status, catalogContext}] }`.
- `priceByCatalog` / `statusByCatalog` = preço/status **por canal** (ex.: `WHITELABEL`) na própria opção — reforça o critério "contexto por canal".

### Bônus confirmado
- Pizza suporta **preço por canal** (a doc mostra Calabresa com preço diferente em Entrega vs Cardápio Digital).

---

## 🍔 Combo (COMBO_V2)

Item com **até 3 níveis**: (1) item principal, (2) grupos de opções, (3) customizações por opção.

### Estrutura obrigatória
- **`item.type = "COMBO_V2"`**.
- **Um grupo principal** com **`associationType: "MAIN"`** (apenas UM por combo; múltiplos MAIN = erro).
- **`optionGroupType` definido em TODOS os grupos.**
- Sem isso, o combo não aparece ao cliente nem entra nas campanhas automáticas de cross-sell.

### Tipos de grupo (`optionGroupType`)
| Tipo | Uso | Exemplo | 3º nível? |
|---|---|---|---|
| `OFFER_UNIT` | Seleção entre itens | Escolha do hambúrguer / bebida | não |
| `SPECIFICATION` | Especificação de preparo | Ponto da carne | **sim** |
| `INGREDIENTS` | Alteração de ingredientes | Com/sem cebola | **sim** |
| `CUTLERY` | Utensílios | Garfo, faca, guardanapo | não |

Só **`SPECIFICATION`** e **`INGREDIENTS`** aparecem no 3º nível.

### `associationType` (relação grupo↔produto principal)
- **`MAIN`** — grupo principal (só um por combo).
- **`OFFER_UNIT`** — seleção adicional (venda cruzada).
- **ausente** — padrão para 3º nível (deve ficar vazio).
- Ao reutilizar um grupo existente, o `optionGroupType` já vem do grupo original — não redefinir.

### Modificador aninhado (3º nível)
Para customizar após a escolha (ex.: ponto da carne depois de escolher o hambúrguer), o **produto da opção** (não o grupo) recebe seus próprios `optionGroups`:
```json
{ "id": "prod-salad-burger", "name": "Hambúrguer",
  "optionGroups": [
    { "id": "og-remove-ingredients", "min": 0, "max": 2, "index": 0 },
    { "id": "og-meat-doneness",      "min": 0, "max": 1, "index": 1 } ] }
```
Esses grupos de 3º nível **não** têm `associationType` (vazio) e são `INGREDIENTS`/`SPECIFICATION`.

### Regra de ouro do PUT /items para combo
**Todo produto referenciado por `productId` nas options — inclusive os do 3º nível — deve estar explícito no array `products`.** Nada é criado automaticamente. Tudo vai achatado: um só `products[]`, um só `optionGroups[]`, um só `options[]`.

### Hierarquia (exemplo da doc)
```
Combo hambúrguer e refrigerante (item COMBO_V2)
├── Escolha seu hambúrguer (grupo OFFER_UNIT, associationType: MAIN)
│   ├── Hambúrguer (opção) → prod-salad-burger
│   │   ├── Deseja retirar ingrediente? (grupo INGREDIENTS, 3º nível)  → Sem tomate / Sem alface
│   │   └── Qual o ponto da carne? (grupo SPECIFICATION, 3º nível)     → Ao ponto / Médio / Bem-passado
│   └── Hambúrguer de bacon (opção) → prod-bacon-burger
└── Escolha seu refrigerante (grupo OFFER_UNIT)                        → Laranja / Uva
```

### Payload de referência (PUT /items) — combo COMBO_V2
```json
{
  "item": { "id": "item-combo-burger", "type": "COMBO_V2", "status": "AVAILABLE", "externalCode": "combo_burger_001" },
  "products": [
    { "id": "prod-combo", "name": "Combo hambúrguer e refrigerante", "externalCode": "combo_prod_001",
      "optionGroups": [
        { "id": "og-burger-choice", "min": 1, "max": 1, "index": 0, "associationType": "MAIN" },
        { "id": "og-soda-choice",   "min": 1, "max": 1, "index": 1 } ] },
    { "id": "prod-salad-burger", "name": "Hambúrguer", "externalCode": "burger_salad",
      "optionGroups": [
        { "id": "og-remove-ingredients", "min": 0, "max": 2, "index": 0 },
        { "id": "og-meat-doneness",      "min": 0, "max": 1, "index": 1 } ] },
    { "id": "prod-bacon-burger", "name": "Hambúrguer de bacon", "externalCode": "burger_bacon" },
    { "id": "prod-orange-soda",  "name": "Refrigerante de laranja", "externalCode": "soda_orange" },
    { "id": "prod-grape-soda",   "name": "Refrigerante de uva", "externalCode": "soda_grape" },
    { "id": "prod-tomate", "name": "Tomate", "externalCode": "ing_tomato" },
    { "id": "prod-alface", "name": "Alface", "externalCode": "ing_lettuce" },
    { "id": "prod-carne-ao-ponto",     "name": "Carne ao ponto",   "externalCode": "meat_rare" },
    { "id": "prod-carne-medio",        "name": "Carne média",      "externalCode": "meat_medium" },
    { "id": "prod-carne-bem-passado",  "name": "Carne bem-passada","externalCode": "meat_well_done" }
  ],
  "optionGroups": [
    { "id": "og-burger-choice", "name": "Escolha seu hambúrguer", "status": "AVAILABLE", "optionGroupType": "OFFER_UNIT", "optionIds": ["opt-salad","opt-bacon"] },
    { "id": "og-soda-choice",   "name": "Escolha seu refrigerante","status": "AVAILABLE", "optionGroupType": "OFFER_UNIT", "optionIds": ["opt-orange","opt-grape"] },
    { "id": "og-remove-ingredients", "name": "Deseja retirar ingrediente?", "status": "AVAILABLE", "optionGroupType": "INGREDIENTS",   "optionIds": ["opt-remove-tomato","opt-remove-lettuce"] },
    { "id": "og-meat-doneness",      "name": "Qual o ponto da carne?",      "status": "AVAILABLE", "optionGroupType": "SPECIFICATION", "optionIds": ["opt-rare","opt-medium","opt-well-done"] }
  ],
  "options": [
    { "id": "opt-salad",  "productId": "prod-salad-burger", "status": "AVAILABLE", "index": 0, "price": {"value": 15.0} },
    { "id": "opt-bacon",  "productId": "prod-bacon-burger", "status": "AVAILABLE", "index": 1, "price": {"value": 18.0} },
    { "id": "opt-orange", "productId": "prod-orange-soda",  "status": "AVAILABLE", "index": 0, "price": {"value": 8.0} },
    { "id": "opt-grape",  "productId": "prod-grape-soda",   "status": "AVAILABLE", "index": 1, "price": {"value": 8.0} },
    { "id": "opt-remove-tomato",  "productId": "prod-tomate", "status": "AVAILABLE", "price": {"value": 0.0} },
    { "id": "opt-remove-lettuce", "productId": "prod-alface", "status": "AVAILABLE", "price": {"value": 0.0} },
    { "id": "opt-rare",      "productId": "prod-carne-ao-ponto",    "status": "AVAILABLE", "price": {"value": 0.0} },
    { "id": "opt-medium",    "productId": "prod-carne-medio",       "status": "AVAILABLE", "price": {"value": 0.0} },
    { "id": "opt-well-done", "productId": "prod-carne-bem-passado", "status": "AVAILABLE", "price": {"value": 0.0} }
  ]
}
```

### Servir combo em vários canais
Usa `contextModifiers` (mesmo mecanismo do resto) — ver guia Multi-menu.

---

## Notas para o builder do Orzuni
- **IDs**: gerar `randomUUID()` para item/product/group/option; casar `optionIds` ↔ `options[].id` e `optionGroups[].id` ↔ referência no produto.
- **externalCode (PDV)**: item principal recebe o PDV do usuário; produtos/opções internos recebem `ORZ-*` derivados (como já é feito em `criarItem`).
- **Achatar tudo**: pizza e combo montam UM `products[]`, UM `optionGroups[]`, UM `options[]`. É a mesma plumbing do `putItem` já existente.
- **Categoria**: pizza precisa de `template: "PIZZA"` no `createCategory` (hoje fixa `DEFAULT` → parametrizar). Combo vai em categoria `DEFAULT` normal.
- **Validação**: pizza = 4 grupos presentes (senão 422); combo = exatamente 1 grupo `MAIN` + `optionGroupType` em todos.
