/**
 * O MANIFESTO da porta (Padrão DMS §13): a documentação pública da porta MCP,
 * montada do próprio código. As permissões saem do catálogo `PERMISSOES`; as
 * ferramentas, do catálogo `FERRAMENTAS`, registradas num servidor de mentira
 * que anota nome, descrição e esquema de entrada (zod → JSON Schema). Servido
 * sem credencial em `/.well-known/dms-manifesto` e guardado em
 * `docs/dms-manifesto.json` (o teste confere; `ATUALIZAR_MANIFESTO=1` regrava).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { montarManifesto, type FerramentaNoManifesto, type ManifestoDms, type PermissaoNoManifesto } from '../dms/integracao-dms';
import { classesDe, LIMITE_POR_MINUTO, PERMISSOES } from './ligacao.regras';
import type { ContextoDaFerramenta, Ferramenta } from './mcp.ferramenta';
import { FERRAMENTAS } from './mcp.ferramentas';

/** O endereço público da API: o manifesto é o mesmo em todo ambiente (o arquivo do repositório confere com ele). */
export const BASE_DO_MANIFESTO = 'https://api.orzuni.com';

/** A porta MCP: o endereço e a versão da especificação. */
export const PORTA_MCP = { endereco: `${BASE_DO_MANIFESTO}/v1/mcp`, versao: '2026-07-28' } as const;

/** A versão do contrato da porta (Padrão §12). 1.2.0: aditivo — item_editar, complemento_nome_definir e item_codigo_pdv_definir (R3), + ordem/descricao nas leituras. */
export const VERSAO_DO_CONTRATO = '1.3.0';

function permissoes(): Record<string, PermissaoNoManifesto> {
  return Object.fromEntries(PERMISSOES.map((p) => [p.id, { frase: p.frase, classes: classesDe(p), sensivel: p.sensivel }]));
}

/** O que o servidor de mentira anota de cada `registerTool`. */
interface Registro {
  nome: string;
  description?: string;
  inputSchema?: z.ZodType;
  annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean };
}

/** Cada ferramenta do catálogo, como ela se registra. Quem grava diz como é idempotente (o argumento `chaveIdempotencia`). */
export function ferramentasDoCatalogo(catalogo: readonly Ferramenta[] = FERRAMENTAS): FerramentaNoManifesto[] {
  return catalogo.map((f) => {
    const anotadas: Registro[] = [];
    const deMentira = {
      registerTool: (nome: string, config: Omit<Registro, 'nome'>) => {
        anotadas.push({ nome, ...config });
      },
    } as unknown as McpServer;
    f.registrar(deMentira, {} as ContextoDaFerramenta);
    const r = anotadas[0];
    if (anotadas.length !== 1 || !r || r.nome !== f.nome) throw new Error(`a ferramenta ${f.nome} não se registrou uma vez, com o próprio nome`);
    if (!r.inputSchema || !r.description) throw new Error(`a ferramenta ${f.nome} não tem descrição ou esquema de entrada`);
    const esquemaEntrada = z.toJSONSchema(r.inputSchema) as Record<string, unknown>;
    const propriedades = (esquemaEntrada.properties ?? {}) as Record<string, unknown>;
    const ferramenta: FerramentaNoManifesto = { nome: f.nome, descricao: r.description, permissao: f.escopo, esquemaEntrada };
    if (r.annotations?.readOnlyHint !== true) {
      if ('chaveIdempotencia' in propriedades) ferramenta.escrita = 'chave';
      else if (r.annotations?.idempotentHint === true) ferramenta.escrita = 'substituicao';
      else throw new Error(`a ferramenta ${f.nome} grava sem chaveIdempotencia e sem ser idempotente (Padrão §6)`);
    }
    return ferramenta;
  });
}

let guardado: ManifestoDms | null = null;

/** O manifesto da porta (montado uma vez: é o mesmo enquanto o processo vive). */
export function manifestoDaPorta(): ManifestoDms {
  guardado ??= montarManifesto({
    produto: 'orzuni',
    versao: VERSAO_DO_CONTRATO,
    titulo: 'Porta de integração do Orzuni',
    descricao:
      'A porta MCP que os produtos da DMS ligados à loja usam para ver e mexer no cardápio da loja no iFood: itens, preços, ' +
      'pausas, complementos e os alertas do vigia. Credencial: o token do DMS ID com o segredo da ligação (DMS-Ligacao).',
    base: BASE_DO_MANIFESTO,
    permissoes: permissoes(),
    limite: { porMinuto: LIMITE_POR_MINUTO, por: 'ligacao' },
    rotas: [],
    ferramentas: ferramentasDoCatalogo(),
    avisos: [],
    credenciais: ['dms_id'],
    mcp: PORTA_MCP,
  });
  return guardado;
}
