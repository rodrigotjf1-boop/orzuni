// A autorização por clique e os aplicativos conectados (navegador → proxy Next → orzuni-api, com a sessão).
// Fetch próprio: a recusa vem em problem+json, e a frase para o dono está no `detail`.

export interface PermissaoDaTela {
  id: string;
  frase: string;
  motivo: string | null;
  necessaria: boolean;
  sensivel: boolean;
}

export interface LojaDaTela {
  id: string;
  nome: string;
  situacao: 'livre' | 'esta' | 'chave' | 'outra';
  outraLoja: string | null;
}

export interface TelaDoPedido {
  aplicativo: { nome: string; empresa: string; verificado: boolean };
  contaPede: { nome: string; cnpj: string | null; email: string; marca: string | null; loja: string | null };
  outraEmpresa: true;
  lojas: LojaDaTela[];
  permissoes: PermissaoDaTela[];
  naoPode: string[];
  venceEm: string;
  travadaAte: string | null;
}

export interface PedidoMorto {
  erro: string;
  voltar: string | null;
}

export interface AplicativoConectado {
  id: string;
  aplicativo: string;
  produto: string;
  loja: string;
  prefixo: string;
  via: 'clique' | 'chave';
  quemPediu: { nome: string | null; loja: string | null };
  permissoes: Array<{ id: string; frase: string }>;
  desde: string;
  ultimoUso: string | null;
  texto: string | null;
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/orzuni/v1/${caminho}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
  } catch {
    throw new Error('Sem conexão com o Orzuni agora. Confira a internet e tente de novo.');
  }
  const corpo = await res.json().catch(() => null);
  if (!res.ok) {
    const frase = corpo && typeof corpo === 'object' ? corpo.detail || corpo.message || corpo.error : null;
    throw new Error(typeof frase === 'string' && frase ? frase : res.status >= 500 ? 'O Orzuni não respondeu agora. Tente de novo em instantes.' : 'Não deu certo. Tente de novo.');
  }
  return corpo as T;
}

export const autorizacao = {
  ler: (numero: string) => chamar<TelaDoPedido | PedidoMorto>(`autorizacao/pedido?numero=${encodeURIComponent(numero)}`),
  autorizar: (corpo: { pedido: string; loja: string; opcionais: string[]; senha: string; confirmo_outra_empresa: boolean }) =>
    chamar<{ redirect: string }>('autorizacao/autorizar', { method: 'POST', body: JSON.stringify(corpo) }),
  recusar: (pedido: string) => chamar<{ redirect: string | null }>('autorizacao/recusar', { method: 'POST', body: JSON.stringify({ pedido }) }),
  conectados: () => chamar<AplicativoConectado[]>('aplicativos-conectados'),
  desligar: (id: string) => chamar<{ ok: true }>('aplicativos-conectados/desligar', { method: 'POST', body: JSON.stringify({ id }) }),
};

export const ehPedidoMorto = (v: TelaDoPedido | PedidoMorto): v is PedidoMorto => 'erro' in v;
