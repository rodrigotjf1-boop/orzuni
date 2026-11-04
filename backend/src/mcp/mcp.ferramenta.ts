/**
 * O que é uma ferramenta do MCP do Orzuni e o que ela recebe. Cada ferramenta
 * chama o MESMO serviço que a tela/REST usa, com o merchant da ligação (a loja
 * nunca vem no argumento — à prova de IDOR). Recusa de regra vira resposta de
 * erro com a frase; erro inesperado sai como "erro interno", com log local.
 */
import { HttpException, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/server';

import { ErroProblema, impressaoPedido } from '../dms/integracao-dms';
import type { CatalogoService } from '../catalogo/catalogo.service';
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

/** Resposta de ferramenta com o texto (JSON). */
export function resposta(dados: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(dados) }] };
}

/** Resposta de erro: a frase vai para quem chamou, sem derrubar o protocolo. */
export function erroDaFerramenta(mensagem: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text: mensagem }] };
}

type RespostaFerramenta = ReturnType<typeof resposta> | ReturnType<typeof erroDaFerramenta>;

const log = new Logger('McpFerramenta');

/** Roda a ferramenta; recusa de regra (<500) vira erro da ferramenta, o resto é "erro interno". */
export async function naConta(nome: string, fn: () => Promise<unknown>): Promise<RespostaFerramenta> {
  try {
    return resposta(await fn());
  } catch (e) {
    if (e instanceof ErroProblema && e.status < 500) return erroDaFerramenta(e.detalhe);
    if (e instanceof HttpException && e.getStatus() < 500) {
      const corpo = e.getResponse();
      const m = typeof corpo === 'string' ? corpo : ((corpo as { message?: unknown }).message ?? e.message);
      return erroDaFerramenta(Array.isArray(m) ? m.join(' ') : String(m));
    }
    log.error(`${nome} falhou: ${(e as Error)?.message ?? e}`, (e as Error)?.stack);
    return erroDaFerramenta('Erro interno. Tente de novo em instantes.');
  }
}

// Idempotência em memória (por processo; basta para o piloto de uma instância).
const guardadas = new Map<string, { impressao: string; resposta: RespostaFerramenta }>();

/**
 * Ferramenta que grava: a mesma `chaveIdempotencia` com o MESMO pedido devolve a
 * resposta guardada; com outro pedido, recusa (Padrão §6). Guardado por ligação.
 */
export async function escrita(
  quem: IntegracaoAutenticada,
  nome: string,
  chaveIdempotencia: string,
  argumentos: unknown,
  fn: () => Promise<unknown>,
): Promise<RespostaFerramenta> {
  const impressao = impressaoPedido('TOOL', nome, argumentos);
  const k = `${quem.ligacaoId}:${chaveIdempotencia}`;
  const g = guardadas.get(k);
  if (g) return g.impressao === impressao ? g.resposta : erroDaFerramenta('Esta chaveIdempotencia já foi usada com outro pedido. Gere outra.');
  const r = await naConta(nome, fn);
  if (guardadas.size > 5000) guardadas.clear();
  guardadas.set(k, { impressao, resposta: r });
  return r;
}
