/**
 * Validação de payload (critério de homologação: nenhum dado inválido à API)
 * e tradução dos erros do iFood para códigos/mensagens claras (sem falha silenciosa).
 */

/** Janela de disponibilidade: horário + dias da semana (seg..dom). */
export interface Shift {
  inicio: string; // HH:mm
  fim: string; // HH:mm
  dias: string[]; // ['seg','ter',...]
}

export interface DadosItem {
  nome?: string;
  descricao?: string;
  preco?: number;
  categoriaId?: string;
  categoria?: string;
  pdv?: string;
  imagem?: string; // data-URI (jpg/png) — enviado ao upload do iFood
  complementos?: Array<{ grupo: string; min: number; max: number; opcoes: Array<{ nome: string; preco?: number; pdv?: string; imagem?: string }> }>;
  shifts?: Shift[];
}

const DIAS: Record<string, string> = {
  seg: 'monday',
  ter: 'tuesday',
  qua: 'wednesday',
  qui: 'thursday',
  sex: 'friday',
  sab: 'saturday',
  dom: 'sunday',
};

/** Nosso shift → formato do iFood (booleans por dia). Vazio = sempre disponível. */
export function toIfoodShifts(shifts?: Shift[]): any[] | undefined {
  if (!shifts?.length) return undefined;
  return shifts
    .filter((s) => s.dias?.length)
    .map((s) => {
      const base: any = { startTime: s.inicio || '00:00', endTime: s.fim || '23:59', monday: false, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: false, sunday: false };
      for (const d of s.dias) if (DIAS[d]) base[DIAS[d]] = true;
      return base;
    });
}

/** Formato do iFood → nosso shift (para o detalhe/editor). */
export function fromIfoodShifts(sh?: any[]): Shift[] {
  if (!Array.isArray(sh) || !sh.length) return [];
  const inv = Object.entries(DIAS);
  return sh.map((s) => ({
    inicio: s.startTime ?? '00:00',
    fim: s.endTime ?? '23:59',
    dias: inv.filter(([, en]) => s[en]).map(([pt]) => pt),
  }));
}

/** Valida shifts (HH:mm e ao menos um dia). */
export function validarShifts(shifts?: Shift[]): string[] {
  const e: string[] = [];
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const s of shifts ?? []) {
    if (!re.test(s.inicio) || !re.test(s.fim)) e.push('horário deve ser HH:mm');
    if (!s.dias?.length) e.push('escolha ao menos um dia da semana');
  }
  return e;
}

/** Retorna a lista de erros (vazia = ok). Limites conforme a homologação. */
export function validarItem(d: DadosItem): string[] {
  const e: string[] = [];
  if (!d.nome || !d.nome.trim()) e.push('nome é obrigatório');
  else if (d.nome.length > 100) e.push('nome deve ter até 100 caracteres');
  if (d.descricao && d.descricao.length > 500) e.push('descrição deve ter até 500 caracteres');
  if (typeof d.preco !== 'number' || isNaN(d.preco) || d.preco <= 0) e.push('preço deve ser um número positivo');
  if (!d.categoriaId && !d.categoria) e.push('categoria é obrigatória');
  for (const g of d.complementos ?? []) {
    if (!g.grupo?.trim()) e.push('grupo de complemento sem nome');
    if (g.min < 0 || g.max < g.min) e.push(`grupo "${g.grupo}": min/max inválidos (max deve ser ≥ min)`);
    if (!g.opcoes?.length) e.push(`grupo "${g.grupo}" precisa de ao menos uma opção`);
    for (const o of g.opcoes ?? []) {
      if (!o.nome?.trim()) e.push(`grupo "${g.grupo}": opção sem nome`);
      if (o.nome && o.nome.length > 100) e.push(`opção "${o.nome}" excede 100 caracteres`);
      if (o.preco != null && (isNaN(o.preco) || o.preco < 0)) e.push(`opção "${o.nome}": preço inválido`);
    }
  }
  return e;
}

// ---------------------------------------------------------------------------
// Pizza (type PIZZA) — 4 grupos obrigatórios SIZE/CRUST/EDGE/TOPPING.
// Preço-base no tamanho; fractions = quantos sabores o tamanho aceita.
// ---------------------------------------------------------------------------
export interface DadosPizza {
  nome?: string;
  categoria?: string;
  categoriaId?: string;
  pdv?: string;
  tamanhos?: Array<{ nome: string; preco: number; pedacos?: number; maxSabores?: number }>;
  massas?: Array<{ nome: string; preco?: number }>;
  bordas?: Array<{ nome: string; preco?: number }>;
  sabores?: Array<{ nome: string; preco?: number }>;
  shifts?: Shift[];
}

export function validarPizza(d: DadosPizza): string[] {
  const e: string[] = [];
  if (!d.nome || !d.nome.trim()) e.push('nome é obrigatório');
  else if (d.nome.length > 100) e.push('nome deve ter até 100 caracteres');
  if (!d.categoriaId && !d.categoria) e.push('categoria é obrigatória');

  if (!d.tamanhos?.length) e.push('a pizza precisa de ao menos um tamanho (SIZE)');
  for (const t of d.tamanhos ?? []) {
    if (!t.nome?.trim()) e.push('tamanho sem nome');
    if (typeof t.preco !== 'number' || isNaN(t.preco) || t.preco <= 0) e.push(`tamanho "${t.nome}": preço deve ser positivo`);
    if (t.maxSabores != null && (!Number.isInteger(t.maxSabores) || t.maxSabores < 1)) e.push(`tamanho "${t.nome}": máx. de sabores inválido`);
  }
  if (!d.massas?.length) e.push('a pizza precisa de ao menos uma massa (CRUST)');
  for (const m of d.massas ?? []) if (!m.nome?.trim()) e.push('massa sem nome');
  if (!d.sabores?.length) e.push('a pizza precisa de ao menos um sabor (TOPPING)');
  for (const s of d.sabores ?? []) if (!s.nome?.trim()) e.push('sabor sem nome');
  // bordas é grupo obrigatório na estrutura, mas o builder cria um padrão se vier vazio
  for (const b of d.bordas ?? []) if (!b.nome?.trim()) e.push('borda sem nome');
  return e;
}

// ---------------------------------------------------------------------------
// Combo (type COMBO_V2) — exatamente 1 grupo principal (MAIN); grupos de nível 2
// são OFFER_UNIT; customizações de 3º nível são INGREDIENTS/SPECIFICATION.
// ---------------------------------------------------------------------------
export interface CustomizacaoCombo {
  nome: string;
  tipo: 'ingredientes' | 'especificacao';
  min: number;
  max: number;
  opcoes: Array<{ nome: string; preco?: number }>;
}
export interface GrupoCombo {
  nome: string;
  principal?: boolean;
  min: number;
  max: number;
  opcoes: Array<{ nome: string; preco: number; customizacoes?: CustomizacaoCombo[] }>;
}
export interface DadosCombo {
  nome?: string;
  categoria?: string;
  categoriaId?: string;
  pdv?: string;
  grupos?: GrupoCombo[];
  shifts?: Shift[];
}

export function validarCombo(d: DadosCombo): string[] {
  const e: string[] = [];
  if (!d.nome || !d.nome.trim()) e.push('nome é obrigatório');
  else if (d.nome.length > 100) e.push('nome deve ter até 100 caracteres');
  if (!d.categoriaId && !d.categoria) e.push('categoria é obrigatória');

  if (!d.grupos?.length) e.push('o combo precisa de ao menos um grupo');
  const principais = (d.grupos ?? []).filter((g) => g.principal).length;
  if ((d.grupos?.length ?? 0) > 0 && principais !== 1) e.push('o combo precisa de exatamente um grupo principal');

  for (const g of d.grupos ?? []) {
    if (!g.nome?.trim()) e.push('grupo sem nome');
    if (g.min < 0 || g.max < g.min || g.max < 1) e.push(`grupo "${g.nome}": min/max inválidos`);
    if (!g.opcoes?.length) e.push(`grupo "${g.nome}" precisa de ao menos uma opção`);
    for (const o of g.opcoes ?? []) {
      if (!o.nome?.trim()) e.push(`grupo "${g.nome}": opção sem nome`);
      if (typeof o.preco !== 'number' || isNaN(o.preco) || o.preco < 0) e.push(`opção "${o.nome}": preço inválido`);
      for (const c of o.customizacoes ?? []) {
        if (!c.nome?.trim()) e.push(`opção "${o.nome}": customização sem nome`);
        if (c.tipo !== 'ingredientes' && c.tipo !== 'especificacao') e.push(`customização "${c.nome}": tipo inválido`);
        if (c.min < 0 || c.max < c.min || c.max < 1) e.push(`customização "${c.nome}": min/max inválidos`);
        if (!c.opcoes?.length) e.push(`customização "${c.nome}" precisa de ao menos uma opção`);
        for (const co of c.opcoes ?? []) if (!co.nome?.trim()) e.push(`customização "${c.nome}": opção sem nome`);
      }
    }
  }
  return e;
}

export function validarCategoria(nome: string): string[] {
  const e: string[] = [];
  if (!nome || !nome.trim()) e.push('nome da categoria é obrigatório');
  else if (nome.length > 100) e.push('nome da categoria deve ter até 100 caracteres');
  return e;
}

export interface ErroIfood {
  codigo: 'CONFLICT' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'SERVER_ERROR' | 'UNKNOWN';
  mensagem: string;
}

/** Traduz {status, body} do iFood para código + mensagem pt-BR compreensível. */
export function mapErroIfood(status: number, data: any): ErroIfood {
  const detalhe =
    data?.error?.details?.[0]?.message ?? data?.error?.message ?? (typeof data === 'string' ? data : '');
  if (status === 409)
    return { codigo: 'CONFLICT', mensagem: 'Conflito: já existe um item/categoria com esse código ou id.' };
  if (status === 404) return { codigo: 'NOT_FOUND', mensagem: 'Não encontrado: item ou categoria não existe.' };
  if (status === 400 || status === 422)
    return { codigo: 'VALIDATION_ERROR', mensagem: `Dados inválidos${detalhe ? ': ' + detalhe : ''}.` };
  if (status >= 500) return { codigo: 'SERVER_ERROR', mensagem: 'iFood indisponível no momento — tente novamente.' };
  return { codigo: 'UNKNOWN', mensagem: detalhe || `Erro ${status} do iFood.` };
}
