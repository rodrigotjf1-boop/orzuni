/**
 * Validação de payload (critério de homologação: nenhum dado inválido à API)
 * e tradução dos erros do iFood para códigos/mensagens claras (sem falha silenciosa).
 */

export interface DadosItem {
  nome?: string;
  descricao?: string;
  preco?: number;
  categoriaId?: string;
  categoria?: string;
  pdv?: string;
  complementos?: Array<{ grupo: string; min: number; max: number; opcoes: Array<{ nome: string; preco?: number }> }>;
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
