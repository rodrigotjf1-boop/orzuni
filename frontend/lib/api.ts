// Cliente do navegador → proxy Next (/api/orzuni) → orzuni-api. Sem chave aqui.

export interface ItemCardapio {
  pdv: string | null;
  nome: string;
  categoria: string;
  preco: number;
  promo: { de: number } | null;
  status: 'no_ar' | 'pausado';
}

export interface Shift {
  inicio: string;
  fim: string;
  dias: string[];
}

export interface ItemDetalhe {
  pdv: string;
  nome: string;
  descricao: string;
  categoria: string;
  preco: number;
  promo: { de: number } | null;
  status: 'no_ar' | 'pausado';
  complementos: Array<{ grupo: string; obrigatorio: boolean; min: number; max: number; opcoes: Array<{ nome: string; status: string; preco: number; pdv: string }> }>;
  disponibilidade: Shift[];
}

export interface Chave {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  criadoEm: string;
  ultimoUso: string | null;
  loja: { merchantId: string; nome: string } | null;
}

export interface Loja {
  merchantId: string;
  nome: string;
}

export interface Alerta {
  pdv: string | null;
  nome: string;
  motivo: 'cascade' | 'manual' | 'stock' | 'unknown';
  grupoAfetado: string | null;
  desde: string; // ISO
  foraHaMs: number;
}

/** Loja ativa (multi-loja) — escolhida no seletor do topo, guardada no navegador. */
export function lojaAtiva(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('orz_loja') || null;
}
export function setLojaAtiva(merchantId: string | null) {
  if (typeof localStorage === 'undefined') return;
  if (merchantId) localStorage.setItem('orz_loja', merchantId);
  else localStorage.removeItem('orz_loja');
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const loja = lojaAtiva();
  const url = `/api/orzuni/${path}` + (loja ? (path.includes('?') ? '&' : '?') + 'loja=' + encodeURIComponent(loja) : '');
  const res = await fetch(url, {
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
  reprecos: (itens: Array<{ pdv: string; preco: number; manterPromo?: boolean }>, contexto?: string) =>
    req<{ batchId: string | null; ignorados: string[] }>(`v1/precos${contexto ? `?contexto=${encodeURIComponent(contexto)}` : ''}`, {
      method: 'PATCH',
      body: JSON.stringify({ itens }),
    }),
  status: (pdv: string, status: 'no_ar' | 'pausado') =>
    req<{ batchId: string | null }>(`v1/itens/${encodeURIComponent(pdv)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  statusMassa: (itens: Array<{ pdv: string; status: 'no_ar' | 'pausado' }>) =>
    req<{ batchId: string | null }>('v1/status', { method: 'PATCH', body: JSON.stringify({ itens }) }),
  criarCategoria: (nome: string) => req<{ ok: boolean; categoryId?: string; erro?: string }>('v1/categorias', { method: 'POST', body: JSON.stringify({ nome }) }),
  criarItem: (dados: {
    nome: string;
    descricao?: string;
    preco: number;
    categoria: string;
    pdv?: string;
    imagem?: string;
    complementos?: Array<{ grupo: string; min: number; max: number; opcoes: Array<{ nome: string; preco?: number; pdv?: string }> }>;
    shifts?: Shift[];
  }) => req<{ ok: boolean; pdv?: string; erro?: string }>('v1/itens', { method: 'POST', body: JSON.stringify(dados) }),
  criarPizza: (dados: {
    nome: string;
    categoria: string;
    pdv?: string;
    tamanhos: Array<{ nome: string; preco: number; pedacos?: number; maxSabores?: number }>;
    massas: Array<{ nome: string; preco?: number }>;
    bordas?: Array<{ nome: string; preco?: number }>;
    sabores: Array<{ nome: string; preco?: number }>;
    shifts?: Shift[];
  }) => req<{ ok: boolean; pdv?: string; erro?: string }>('v1/pizzas', { method: 'POST', body: JSON.stringify(dados) }),
  criarCombo: (dados: {
    nome: string;
    categoria: string;
    pdv?: string;
    grupos: Array<{
      nome: string;
      principal?: boolean;
      min: number;
      max: number;
      opcoes: Array<{
        nome: string;
        preco: number;
        customizacoes?: Array<{ nome: string; tipo: 'ingredientes' | 'especificacao'; min: number; max: number; opcoes: Array<{ nome: string; preco?: number; pdv?: string }> }>;
      }>;
    }>;
    shifts?: Shift[];
  }) => req<{ ok: boolean; pdv?: string; erro?: string }>('v1/combos', { method: 'POST', body: JSON.stringify(dados) }),
  contextos: () => req<{ contextos: string[] }>('v1/contextos'),
  detalhe: (pdv: string) => req<ItemDetalhe>(`v1/itens/${encodeURIComponent(pdv)}`),
  chaves: {
    listar: () => req<{ chaves: Chave[] }>('v1/chaves'),
    criar: (nome: string, escopos: string[], loja?: string) =>
      req<{ chave: string; prefixo: string }>('v1/chaves', { method: 'POST', body: JSON.stringify({ nome, escopos, loja }) }),
    revogar: (id: string) => req<{ ok: boolean }>(`v1/chaves/${id}`, { method: 'DELETE' }),
  },
  lojas: {
    listar: () => req<{ lojas: Loja[] }>('v1/lojas'),
    disponiveis: () => req<{ lojas: Loja[] }>('v1/lojas/disponiveis'),
    adicionar: (merchantId: string, nome: string) =>
      req<{ ok: boolean }>('v1/lojas', { method: 'POST', body: JSON.stringify({ merchantId, nome }) }),
    remover: (merchantId: string) => req<{ ok: boolean }>(`v1/lojas/${encodeURIComponent(merchantId)}`, { method: 'DELETE' }),
  },
  editar: (pdv: string, campos: { nome?: string; descricao?: string; preco?: number; status?: 'no_ar' | 'pausado'; shifts?: Shift[]; imagem?: string; pdv?: string; complementos?: Array<{ grupo: string; min: number; max: number; opcoes: Array<{ nome: string; preco?: number; pdv?: string }> }> }) =>
    req<{ ok: boolean; erros: string[]; pdv?: string }>(`v1/itens/${encodeURIComponent(pdv)}`, {
      method: 'PATCH',
      body: JSON.stringify(campos),
    }),
};
