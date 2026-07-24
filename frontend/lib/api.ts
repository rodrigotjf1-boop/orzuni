// Cliente do navegador → proxy Next (/api/orzuni) → orzuni-api. Sem chave aqui.

export interface ItemCardapio {
  pdv: string | null;
  nome: string;
  categoria: string;
  preco: number;
  promo: { de: number } | null;
  status: 'no_ar' | 'pausado';
}

export interface ItemDetalhe {
  pdv: string;
  nome: string;
  descricao: string;
  categoria: string;
  preco: number;
  promo: { de: number } | null;
  status: 'no_ar' | 'pausado';
  complementos: Array<{ grupo: string; obrigatorio: boolean; opcoes: Array<{ nome: string; status: string }> }>;
}

export interface Chave {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  criadoEm: string;
  ultimoUso: string | null;
}

export interface Alerta {
  pdv: string | null;
  nome: string;
  motivo: 'cascade' | 'manual' | 'stock' | 'unknown';
  grupoAfetado: string | null;
  desde: string; // ISO
  foraHaMs: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/orzuni/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${txt.slice(0, 160)}`);
  }
  return res.json();
}

export const api = {
  cardapio: () => req<{ itens: ItemCardapio[] }>('v1/cardapio'),
  alertas: () => req<{ alertas: Alerta[] }>('v1/vigia/alertas'),
  reprecos: (itens: Array<{ pdv: string; preco: number; manterPromo?: boolean }>) =>
    req<{ batchId: string | null; ignorados: string[] }>('v1/precos', {
      method: 'PATCH',
      body: JSON.stringify({ itens }),
    }),
  status: (pdv: string, status: 'no_ar' | 'pausado') =>
    req<{ batchId: string | null }>(`v1/itens/${encodeURIComponent(pdv)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  detalhe: (pdv: string) => req<ItemDetalhe>(`v1/itens/${encodeURIComponent(pdv)}`),
  chaves: {
    listar: () => req<{ chaves: Chave[] }>('v1/chaves'),
    criar: (nome: string, escopos: string[]) =>
      req<{ chave: string; prefixo: string }>('v1/chaves', { method: 'POST', body: JSON.stringify({ nome, escopos }) }),
    revogar: (id: string) => req<{ ok: boolean }>(`v1/chaves/${id}`, { method: 'DELETE' }),
  },
  editar: (pdv: string, campos: { nome?: string; descricao?: string; preco?: number; status?: 'no_ar' | 'pausado' }) =>
    req<{ ok: boolean; erros: string[] }>(`v1/itens/${encodeURIComponent(pdv)}`, {
      method: 'PATCH',
      body: JSON.stringify(campos),
    }),
};
