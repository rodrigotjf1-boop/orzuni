/**
 * A ligação da porta MCP do Orzuni (via DMS ID), regras puras.
 *
 * Cada chamada traz o token do DMS ID (`Authorization: Bearer <jwt>`), que diz
 * QUAL APLICATIVO chama, e o segredo da ligação (`DMS-Ligacao:
 * dms_lg_orzuni_…`), que diz QUAL LOJA autorizou. Um só não abre nada.
 *
 * Aqui mora o catálogo de permissões do Orzuni (no estilo `recurso.acao`, com
 * ponto — o `conferirManifesto` recusa dois-pontos), o mapa dos 8 escopos REST
 * (`catalogo:ler`…) para elas, o teto por classe e as regras da ligação.
 */
import { RequestMethod } from '@nestjs/common';

import {
  CABECALHO_LIGACAO,
  cabecalhoWwwAuthenticate,
  CAMINHO_MANIFESTO,
  type Classe,
  ErroPermissaoFaltando,
  ErroProblema,
  ErroTokenDmsId,
  lerChave,
  permissoesDaChamada,
} from '../dms/integracao-dms';

/** Uma permissão do Orzuni: o id com ponto, o escopo REST que ela mapeia, a frase do dono, se grava e se é sensível. */
export interface PermDef {
  id: string;
  rest: string;
  frase: string;
  escrita: boolean;
  sensivel: boolean;
}

/** O catálogo. Leitura primeiro, escrita depois (como a tabela do hub). Permissão nova entra AQUI. */
export const PERMISSOES: readonly PermDef[] = [
  { id: 'catalogo.ler', rest: 'catalogo:ler', frase: 'Ver o cardápio da loja no iFood: itens, categorias, complementos, preços e situação.', escrita: false, sensivel: false },
  { id: 'loja.ler', rest: 'loja:ler', frase: 'Ver os dados e a situação da loja no iFood.', escrita: false, sensivel: false },
  { id: 'vigia.ler', rest: 'vigia:ler', frase: 'Ver os alertas do vigia: itens pausados e há quanto tempo.', escrita: false, sensivel: false },
  { id: 'catalogo.escrever', rest: 'catalogo:escrever', frase: 'Editar e publicar o cardápio da loja no iFood.', escrita: true, sensivel: false },
  { id: 'preco.escrever', rest: 'preco:escrever', frase: 'Mudar o preço de itens e complementos no iFood.', escrita: true, sensivel: true },
  { id: 'status.escrever', rest: 'status:escrever', frase: 'Pausar e reativar itens no iFood.', escrita: true, sensivel: false },
  { id: 'loja.escrever', rest: 'loja:escrever', frase: 'Pausar a loja e mudar os horários no iFood.', escrita: true, sensivel: false },
  { id: 'vigia.escrever', rest: 'vigia:escrever', frase: 'Forçar uma varredura do vigia.', escrita: true, sensivel: false },
];

const POR_ID = new Map(PERMISSOES.map((p) => [p.id, p]));
const POR_REST = new Map(PERMISSOES.map((p) => [p.rest, p]));

/** As classes que podem ter a permissão (o teto): escrita não vai para parceiro. */
export function classesDe(p: PermDef): Classe[] {
  return p.escrita ? ['dms', 'proprio'] : ['dms', 'parceiro', 'proprio'];
}

/** Todas as permissões, na ordem do catálogo: é o que o 401 e o 403 da porta anunciam. */
export const PERMISSOES_DO_RECURSO: readonly string[] = PERMISSOES.map((p) => p.id);

/** Chamadas por minuto, por ligação. */
export const LIMITE_POR_MINUTO = 120;

/** Converte os escopos REST de uma chave `orz_live_` (`catalogo:ler`) nas permissões do Padrão (`catalogo.ler`). */
export function mapearEscoposRest(rest: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const r of rest) {
    const p = POR_REST.get(r);
    if (p) ids.add(p.id);
  }
  return PERMISSOES.filter((p) => ids.has(p.id)).map((p) => p.id);
}

/** As permissões do token que existem no catálogo do Orzuni. */
export function permissoesDoCatalogo(doToken: readonly string[]): string[] {
  return PERMISSOES_DO_RECURSO.filter((p) => doToken.includes(p));
}

/**
 * Os escopos que valem DE VERDADE para uma ligação lida do banco: só os do
 * catálogo e os que a classe pode ter (o teto). Linha adulterada, ou permissão
 * de escrita numa ligação de parceiro, não vira permissão.
 */
export function escoposEfetivos(guardados: unknown, classe: string): string[] {
  const lista = Array.isArray(guardados) ? guardados.map(String) : [];
  return PERMISSOES.filter((p) => lista.includes(p.id) && classesDe(p).includes(classe as Classe)).map((p) => p.id);
}

/** O cabeçalho da ligação como o Node entrega (nome em minúsculas). */
export const CABECALHO_LIGACAO_NO_NODE = CABECALHO_LIGACAO.toLowerCase();

/** Metadados do recurso protegido (RFC 9728), FORA do prefixo `/v1`. */
export const CAMINHO_DOS_METADADOS = '.well-known/oauth-protected-resource/v1/mcp';

/** O manifesto da porta (Padrão §13), FORA do prefixo `/v1`: `.well-known/dms-manifesto`. */
export const CAMINHO_DO_MANIFESTO = CAMINHO_MANIFESTO.replace(/^\//, '');

/** As rotas fora do prefixo global `/v1` (o `main.ts` e os testes usam a mesma lista). */
export const ROTAS_FORA_DO_PREFIXO = [
  { path: CAMINHO_DOS_METADADOS, method: RequestMethod.GET },
  { path: CAMINHO_DO_MANIFESTO, method: RequestMethod.GET },
];

/** A frase de toda ligação que não vale — a mesma para todo motivo (Padrão §7). */
export const LIGACAO_INVALIDA =
  'Ligação ausente, inválida ou revogada. Mande o segredo da ligação no cabeçalho DMS-Ligacao, junto do token do DMS ID do aplicativo dono dela.';

/** A frase da troca recusada. */
export const TROCA_RECUSADA =
  'A chave da conta informada não vale: inexistente, revogada ou de outra loja. Confira a chave orz_live_ da conta.';

export const CONTA_BLOQUEADA = 'A loja desta ligação está revogada no Orzuni.';

/** O texto de um `Authorization: Bearer …`, ou nulo. Quem confere a forma é o DMS ID. */
export function bearerDoCabecalho(authorization: unknown): string | null {
  if (typeof authorization !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return m?.[1] ?? null;
}

/** O segredo da ligação do cabeçalho, ou nulo. Só aceita o que tem a forma de uma ligação do Orzuni. */
export function ligacaoDoCabecalho(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const lida = lerChave(valor.trim());
  return lida && lida.tipo === 'lg' && lida.produto === 'orzuni' ? valor.trim() : null;
}

/** Uma ligação como o banco devolve, só o que decide se ela vale. */
export interface LigacaoGuardada {
  aplicativo: string;
  classe: string;
  escopos: unknown;
  revogadaEm: Date | null;
}

/**
 * A ligação vale para este token? Existe, não foi revogada, pertence ao
 * aplicativo do token, e esse aplicativo segue na lista da distribuição
 * (`DMS_ID_APLICATIVOS`): tirar um aplicativo da lista corta as ligações dele na
 * chamada seguinte, sem tocar no banco.
 */
export function ligacaoVale(l: LigacaoGuardada | undefined, aplicativoDoToken: string, aplicativos: Readonly<Record<string, string>>): l is LigacaoGuardada {
  return !!l && !l.revogadaEm && l.aplicativo === aplicativoDoToken && Object.values(aplicativos).includes(aplicativoDoToken);
}

/** As permissões que valem na chamada: as da ligação (dentro do teto da classe) que o token também tem. */
export function permissoesDaLigacao(l: Pick<LigacaoGuardada, 'escopos' | 'classe'>, doToken: readonly string[]): string[] {
  return permissoesDaChamada(escoposEfetivos(l.escopos, l.classe), doToken);
}

/**
 * O `WWW-Authenticate` de uma recusa, ou nulo. Todo 401 leva os metadados e as
 * permissões do recurso; sem credencial, sem código de erro (RFC 6750). O 403 de
 * permissão leva TODAS as que faltam (MCP 2026-07-28).
 */
export function desafioDaRecusa(erro: unknown, veioToken: boolean, metadadosRecurso: string): string | null {
  if (erro instanceof ErroPermissaoFaltando) {
    return cabecalhoWwwAuthenticate({ metadadosRecurso, erro: 'insufficient_scope', escopos: erro.faltando });
  }
  if (erro instanceof ErroProblema && erro.status === 401) {
    const invalido = erro instanceof ErroTokenDmsId && veioToken;
    return cabecalhoWwwAuthenticate({ metadadosRecurso, escopos: PERMISSOES_DO_RECURSO, ...(invalido ? { erro: 'invalid_token' as const } : {}) });
  }
  return null;
}

/** O endereço dos metadados do recurso (RFC 9728 §3.1): o `.well-known` entre a origem e o caminho da porta. */
export function enderecoDosMetadados(recurso: string): string {
  const u = new URL(recurso);
  return `${u.origin}/.well-known/oauth-protected-resource${u.pathname.replace(/\/+$/, '')}`;
}
