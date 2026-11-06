/**
 * O que é uma ferramenta do MCP do Orzuni e o que ela recebe. Cada ferramenta
 * chama o MESMO serviço que a tela/REST usa, com o merchant da ligação (a loja
 * nunca vem no argumento — à prova de IDOR). Recusa de regra vira resposta de
 * erro com a frase; erro inesperado sai como "erro interno", com log local.
 *
 * As escritas devolvem um ENVELOPE em `structuredContent` (o que a porta FEZ):
 * `situacao` (aplicado | sem_mudanca | nao_encontrado | parcial | recusado),
 * `antes`/`depois`, `opcoes` (complemento por código de PDV), `codigo` de recusa
 * distinto + `pode_repetir`, e `repetido` (se veio da mesma chaveIdempotencia).
 *
 * ⚠️ Padrão §6: o `content` de TEXTO de uma escrita é SEMPRE uma frase pt-BR
 * legível (a que a tela mostraria) — no sucesso um resumo, na recusa o motivo —,
 * NUNCA o JSON. O JSON (situacao/codigo/pode_repetir/opcoes) fica só no
 * `structuredContent`. Assim um cliente que só guarda o texto (ex.: ClienteMcp
 * 0.10.0 na recusa) não corta o envelope nem mostra JSON cru ao usuário.
 */
import { HttpException, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/server';

import { ErroProblema, impressaoPedido } from '../dms/integracao-dms';
import type { CatalogoService, ResultadoEscrita } from '../catalogo/catalogo.service';
import type { LojaService } from '../loja/loja.service';
import type { StoreService } from '../store/store.service';
import type { IntegracaoAutenticada } from './ligacao.service';

/** Os serviços das telas/REST que as ferramentas reaproveitam. */
export interface ServicosDoMcp {
  catalogo: CatalogoService;
  loja: LojaService;
  store: StoreService;
}

/** O que cada ferramenta recebe: quem chamou (com a loja) e os serviços. */
export interface ContextoDaFerramenta {
  quem: IntegracaoAutenticada;
  servicos: ServicosDoMcp;
}

export interface Ferramenta {
  nome: string;
  /** Nulo = qualquer credencial válida pode usar. */
  escopo: string | null;
  registrar(servidor: McpServer, c: ContextoDaFerramenta): void;
}

/** As marcas de uma ferramenta que só lê. */
export const LEITURA = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

/** Resposta de ferramenta com o texto (JSON) e, opcional, o conteúdo estruturado. */
export function resposta(dados: unknown, estruturado?: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(dados) }], ...(estruturado ? { structuredContent: estruturado } : {}) };
}

/** Resposta de erro: a frase vai para quem chamou, sem derrubar o protocolo. */
export function erroDaFerramenta(mensagem: string, estruturado?: Record<string, unknown>) {
  return { isError: true as const, content: [{ type: 'text' as const, text: mensagem }], ...(estruturado ? { structuredContent: estruturado } : {}) };
}

type RespostaFerramenta = ReturnType<typeof resposta> | ReturnType<typeof erroDaFerramenta>;

const log = new Logger('McpFerramenta');

/** Recusa de regra (<500) vira erro da ferramenta; o resto é "erro interno". `estruturado` acompanha quando houver. */
function traduzErro(nome: string, e: unknown, estruturado?: Record<string, unknown>): RespostaFerramenta {
  if (e instanceof ErroProblema && e.status < 500) return erroDaFerramenta(e.detalhe, estruturado);
  if (e instanceof HttpException && e.getStatus() < 500) {
    const corpo = e.getResponse();
    const m = typeof corpo === 'string' ? corpo : ((corpo as { message?: unknown }).message ?? e.message);
    return erroDaFerramenta(Array.isArray(m) ? m.join(' ') : String(m), estruturado);
  }
  log.error(`${nome} falhou: ${(e as Error)?.message ?? e}`, (e as Error)?.stack);
  return erroDaFerramenta('Erro interno. Tente de novo em instantes.', estruturado && { ...estruturado, codigo: 'erro_interno', pode_repetir: true });
}

/** Roda a ferramenta de leitura; recusa de regra vira erro da ferramenta. */
export async function naConta(nome: string, fn: () => Promise<unknown>): Promise<RespostaFerramenta> {
  try {
    return resposta(await fn());
  } catch (e) {
    return traduzErro(nome, e);
  }
}

// Idempotência em memória (por processo; basta para o piloto de uma instância).
const guardadas = new Map<string, { impressao: string; resultado: ResultadoEscrita }>();

/** As situações que a porta trata como recusa (saem com `isError`). */
const EH_RECUSA = new Set<ResultadoEscrita['situacao']>(['nao_encontrado', 'recusado']);

/** Monta o `structuredContent` do envelope a partir do resultado do serviço. */
function envelope(r: ResultadoEscrita, repetido: boolean): Record<string, unknown> {
  const s: Record<string, unknown> = { situacao: r.situacao, repetido };
  if (r.antes !== undefined) s.antes = r.antes;
  if (r.depois !== undefined) s.depois = r.depois;
  if (r.opcoes) s.opcoes = r.opcoes;
  if (r.dados) Object.assign(s, r.dados);
  if (r.codigo) s.codigo = r.codigo;
  if (r.pode_repetir !== undefined) s.pode_repetir = r.pode_repetir;
  return s;
}

const emReais = (n?: number) => (n === undefined ? '' : `R$ ${n.toFixed(2).replace('.', ',')}`);

/**
 * A frase pt-BR legível da escrita (vai no `content` texto — Padrão §6). Na recusa,
 * o motivo (`erro`). No sucesso, um resumo do que mudou. Nunca o JSON.
 */
function fraseEscrita(r: ResultadoEscrita): string {
  if (EH_RECUSA.has(r.situacao)) return r.erro ?? 'Não foi possível concluir a ação.';
  if (r.opcoes) {
    const conta = (s: string) => r.opcoes!.filter((o) => o.situacao === s).length;
    const partes = [`${conta('aplicado')} alterada(s)`, conta('sem_mudanca') ? `${conta('sem_mudanca')} sem mudança` : '', conta('recusado') ? `${conta('recusado')} não aplicada(s)` : ''].filter(Boolean);
    return `Complemento: ${partes.join(', ')}.`;
  }
  if (r.situacao === 'sem_mudanca') return r.antes !== undefined ? `Nada mudou: o preço já era ${emReais(r.antes)}.` : 'Nada mudou: já estava assim.';
  if (r.antes !== undefined && r.depois !== undefined) return `Preço alterado de ${emReais(r.antes)} para ${emReais(r.depois)}.`;
  if (r.dados && 'batchId' in r.dados && r.dados.batchId) return 'Reprecificação em lote enviada ao iFood.';
  return 'Feito.';
}

/** Resposta de sucesso de escrita: frase legível no texto + envelope no `structuredContent`. */
function respostaEscrita(frase: string, estruturado: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: frase }], structuredContent: estruturado };
}

/** Resposta da escrita: texto = frase pt-BR SEMPRE; `structuredContent` = envelope; recusa → `isError`. */
function montarEscrita(r: ResultadoEscrita, repetido: boolean): RespostaFerramenta {
  const s = envelope(r, repetido);
  const frase = fraseEscrita(r);
  return EH_RECUSA.has(r.situacao) ? erroDaFerramenta(frase, s) : respostaEscrita(frase, s);
}

/**
 * Ferramenta que grava: a mesma `chaveIdempotencia` com o MESMO pedido devolve o
 * resultado guardado (com `repetido: true`); com outro pedido, recusa (Padrão §6).
 * Guardado por ligação. A `fn` devolve o resultado detalhado da escrita.
 */
export async function escrita(
  quem: IntegracaoAutenticada,
  nome: string,
  chaveIdempotencia: string,
  argumentos: unknown,
  fn: () => Promise<ResultadoEscrita>,
): Promise<RespostaFerramenta> {
  const impressao = impressaoPedido('TOOL', nome, argumentos);
  const k = `${quem.ligacaoId}:${chaveIdempotencia}`;
  const g = guardadas.get(k);
  if (g) {
    if (g.impressao !== impressao) return erroDaFerramenta('Esta chaveIdempotencia já foi usada com outro pedido. Gere outra.', { situacao: 'recusado', codigo: 'chave_reutilizada', repetido: false });
    return montarEscrita(g.resultado, true);
  }
  let r: ResultadoEscrita;
  try {
    r = await fn();
  } catch (e) {
    // falha inesperada não é guardada: pode ser transitória e dar certo na próxima.
    return traduzErro(nome, e, { situacao: 'recusado', repetido: false });
  }
  if (guardadas.size > 5000) guardadas.clear();
  guardadas.set(k, { impressao, resultado: r });
  return montarEscrita(r, false);
}
