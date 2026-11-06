/**
 * A chamada da porta MCP que está sendo atendida, para o registro central do hub
 * (Padrão §10). O registro junta o que partes diferentes sabem: o código do
 * pedido e a duração (o middleware), quem chamou e por qual credencial (o
 * portão), o problema da recusa (o filtro do Padrão). Cada parte anota no mesmo
 * lugar — o `AsyncLocalStorage` do pedido — e o middleware monta o registro
 * quando a resposta termina. NUNCA o conteúdo: nem argumento, nem resposta, nem
 * segredo.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

import type { ChamadaRegistrada, CredencialChamada, ResultadoChamada } from '../dms/integracao-dms';

export interface ChamadaAtual {
  /** O código do pedido (`orz_…`): volta no cabeçalho `request-id`. */
  readonly codigo: string;
  /** `Date.now()` da chegada. */
  readonly inicio: number;
  credencial?: CredencialChamada;
  ligacaoPrefixo?: string;
  aplicativo?: string;
  conta?: string;
  contaNome?: string;
  ferramenta?: string;
  resultado?: ResultadoChamada;
  problema?: string;
  /** Erro inesperado da ferramenta, que vai também à lista de erros do hub. */
  erro?: { tipo: string; mensagem: string; lugar: string };
}

const armazem = new AsyncLocalStorage<ChamadaAtual>();

/** Roda `fn` (o resto do pedido) com esta chamada como a atual. */
export function comChamada<T>(chamada: ChamadaAtual, fn: () => T): T {
  return armazem.run(chamada, fn);
}

/** A chamada da porta em atendimento, ou nada (fora da porta MCP). */
export function chamadaAtual(): ChamadaAtual | undefined {
  return armazem.getStore();
}

type Anotavel = Omit<ChamadaAtual, 'codigo' | 'inicio'>;

/** Anota na chamada atual. Fora da porta, não faz nada. Campo indefinido não apaga o que já estava. */
export function anotarChamada(campos: Anotavel): void {
  const atual = armazem.getStore();
  if (!atual) return;
  for (const [campo, valor] of Object.entries(campos) as Array<[keyof Anotavel, never]>) {
    if (valor !== undefined) atual[campo] = valor;
  }
}

/** Um código novo de pedido: `orz_` + 16 caracteres hexadecimais (cabe no código do hub: 6 a 100, letras e `_`). */
export function novoCodigo(): string {
  return `orz_${randomBytes(8).toString('hex')}`;
}

/**
 * As ferramentas de um corpo JSON-RPC: o nome da ferramenta em `tools/call`, o
 * método nos outros pedidos. O lote (cliente da geração 2025) devolve uma por
 * mensagem, para a parada valer para cada uma.
 */
export function ferramentasDoCorpo(corpo: unknown): string[] {
  const mensagens = Array.isArray(corpo) ? corpo : [corpo];
  const nomes: string[] = [];
  for (const m of mensagens) {
    if (!m || typeof m !== 'object') continue;
    const { method, params } = m as { method?: unknown; params?: { name?: unknown } | null };
    if (method === 'tools/call' && params && typeof params.name === 'string' && params.name) nomes.push(params.name);
    else if (typeof method === 'string' && method) nomes.push(method);
  }
  return nomes;
}

/** A ferramenta que vai no registro: uma só, ou "lote" para o lote da geração 2025. */
export function ferramentaDoRegistro(corpo: unknown): string {
  if (Array.isArray(corpo)) return 'lote';
  return ferramentasDoCorpo(corpo)[0] ?? '(sem método)';
}

const PREFIXO_VALIDO = /^[A-Za-z0-9_-]{4,40}$/;
const PROBLEMA_VALIDO = /^[a-z][a-z0-9-]{2,40}$/;

const texto = (v: string | undefined, maximo: number): string | undefined => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, maximo) : undefined;
};

/**
 * O registro da chamada, no contrato do hub: o que não cabe sai (campo opcional)
 * ou é cortado (texto), nunca vai torto. `terminou` = a resposta foi até o fim
 * (falso: a conexão caiu antes). 503 `integracao-parada` é recusada, não erro.
 */
export function montarChamada(c: ChamadaAtual, status: number, terminou: boolean, agora: number): ChamadaRegistrada {
  let resultado: ResultadoChamada;
  if (!terminou) resultado = 'erro';
  else if (status >= 500 && c.problema !== 'integracao-parada') resultado = 'erro';
  else if (status >= 400) resultado = 'recusada';
  else resultado = c.resultado ?? 'aceita';

  const registro: ChamadaRegistrada = {
    codigo: c.codigo,
    ocorrido_em: new Date(c.inicio).toISOString(),
    credencial: c.credencial ?? 'dms_id',
    ferramenta: texto(c.ferramenta, 120) ?? '(sem método)',
    resultado,
  };
  const aplicativo = texto(c.aplicativo, 80);
  if (aplicativo) registro.aplicativo = aplicativo;
  if (c.ligacaoPrefixo && PREFIXO_VALIDO.test(c.ligacaoPrefixo)) registro.ligacao_prefixo = c.ligacaoPrefixo;
  const conta = texto(c.conta, 80);
  if (conta) registro.conta = conta;
  const contaNome = texto(c.contaNome, 120);
  if (contaNome) registro.conta_nome = contaNome;
  if (resultado !== 'aceita' && c.problema && PROBLEMA_VALIDO.test(c.problema)) registro.problema = c.problema;
  if (Number.isInteger(status) && status >= 100 && status <= 599) registro.status_http = status;
  registro.duracao_ms = Math.min(3_600_000, Math.max(0, Math.round(agora - c.inicio)));
  return registro;
}
