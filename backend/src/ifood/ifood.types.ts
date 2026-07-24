/**
 * Tipos da Catalog API v2 do iFood — só o que o Orzuni consome hoje.
 * Preços em REAIS decimais. Campos marcados opcionais aparecem conforme o item.
 */

export interface IfoodCatalog {
  catalogId: string;
  context: string[]; // ex.: ["DEFAULT"] (entrega)
  status: string; // AVAILABLE
  modifiedAt: string; // ISO — guarda de concorrência antes de publicar
  groupId: string; // usado em /catalogs/{groupId}/sellableItems
}

export interface IfoodPrice {
  value: number;
  originalValue?: number;
}

export interface IfoodOptionGroup {
  id: string;
  name: string;
  status: string;
  externalCode?: string;
  optionGroupType?: string; // INGREDIENTS, OFFER_UNIT, SIZE...
  min: number;
  max: number;
  optionIds?: string[];
}

export interface IfoodItem {
  id: string;
  type: string; // DEFAULT | PIZZA | COMBO_V2
  categoryId: string;
  status: string; // AVAILABLE | UNAVAILABLE
  productId: string;
  price?: IfoodPrice;
  externalCode?: string;
  index?: number;
  contextModifiers?: Array<{
    catalogContext: string;
    externalCode?: string;
    price?: IfoodPrice;
    status?: string;
    itemContextId?: string;
  }>;
}

export interface IfoodCategory {
  id: string;
  name: string;
  status: string;
  template: string; // DEFAULT | PIZZA
  index?: number;
  items?: Array<
    IfoodItem & {
      name: string;
      description?: string;
      optionGroups?: IfoodOptionGroup[];
    }
  >;
}

export interface IfoodItemFlat {
  item: IfoodItem;
  products: Array<{ id: string; name: string; externalCode?: string; imagePath?: string }>;
  optionGroups: IfoodOptionGroup[];
  options: Array<{ id: string; status: string; productId: string; price?: IfoodPrice; externalCode?: string }>;
}

/** Restrição observada em teste quando um grupo obrigatório fica sem opção. */
export type IfoodRestriction = 'OPTION_GROUP_WITHOUT_AVAILABLE_OPTIONS' | string;

export interface IfoodUnsellable {
  categories: Array<{
    id: string;
    status?: string;
    unsellableItems?: Array<{ id: string; productId: string; restrictions: IfoodRestriction[] }>;
  }>;
}

/** Aceite de um lote assíncrono (preço/status). */
export interface IfoodBatchAck {
  batchId: string;
  url?: string;
}

export interface IfoodBatchResult {
  batchStatus?: string; // COMPLETED...
  results: Array<{ resourceId: string; result: string; failureReason?: string }>;
}
