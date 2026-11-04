/**
 * O servidor MCP do Orzuni (SDK oficial v2). Sem estado: cada pedido HTTP monta
 * um servidor novo com as ferramentas de QUEM pediu (o que o escopo da ligação
 * libera). A que a credencial não pode usar nem aparece em `tools/list`; chamada
 * direta a ela responde "não encontrada".
 */
import { Injectable, Logger } from '@nestjs/common';
import { createMcpHandler, McpServer, type AuthInfo, type McpHttpHandler } from '@modelcontextprotocol/server';

import { CatalogoService } from '../catalogo/catalogo.service';
import { LojaService } from '../loja/loja.service';
import { StoreService } from '../store/store.service';
import type { IntegracaoAutenticada } from './ligacao.service';
import type { ServicosDoMcp } from './mcp.ferramenta';
import { ferramentasDe } from './mcp.ferramentas';

@Injectable()
export class McpServidor {
  private readonly log = new Logger('Mcp');
  readonly handler: McpHttpHandler;

  constructor(catalogo: CatalogoService, loja: LojaService, store: StoreService) {
    const servicos: ServicosDoMcp = { catalogo, loja, store };
    this.handler = createMcpHandler(
      ({ authInfo }) => {
        const servidor = new McpServer(
          { name: 'orzuni', version: '1.0.0' },
          {
            instructions:
              'Ferramentas do Orzuni: o cardápio da loja no iFood (itens, preços, pausas, complementos) e os alertas do vigia. Cada token vale para UMA loja. Comece por integracao_situacao. Preço em reais. As ferramentas que gravam pedem uma chaveIdempotencia.',
          },
        );
        const quem = (authInfo?.extra as { integracao?: IntegracaoAutenticada } | undefined)?.integracao;
        if (quem) for (const f of ferramentasDe(quem)) f.registrar(servidor, { quem, servicos });
        return servidor;
      },
      { onerror: (erro) => this.log.warn(`Pedido MCP recusado: ${erro.message}`) },
    );
  }

  /** O que a porta entrega ao SDK: quem é, sem o token em claro. */
  static autorizacao(quem: IntegracaoAutenticada): AuthInfo {
    return { token: 'oculto', clientId: quem.produto, scopes: quem.escopos, extra: { integracao: quem } };
  }
}
