/**
 * O DMS ID do lado do Orzuni: confere o token que chega na porta MCP e diz onde
 * estão os metadados do recurso (RFC 9728). Tudo nasce desligado (`ORZUNI_MCP_ATIVO`).
 * As chaves públicas do DMS ID ficam guardadas (`ChavesDmsId`): buscadas de novo
 * a cada 10 min ou quando chega um `kid` novo.
 */
import { Injectable } from '@nestjs/common';

import { ChavesDmsId, conferirTokenDmsId, ErroPermissaoFaltando, type TokenDmsId } from '../dms/integracao-dms';
import { porta } from './config';
import { enderecoDosMetadados, PERMISSOES_DO_RECURSO, permissoesDoCatalogo } from './ligacao.regras';

@Injectable()
export class DmsIdService {
  private guardadas: { emissor: string; chaves: ChavesDmsId } | null = null;

  get ligado(): boolean {
    return porta.ligado === true;
  }

  /** Produto → client_id dos aplicativos que a distribuição cadastrou no DMS ID. */
  get aplicativos(): Readonly<Record<string, string>> {
    return porta.aplicativos;
  }

  enderecoDosMetadados(): string {
    return enderecoDosMetadados(porta.recurso);
  }

  /** Os metadados do recurso protegido (RFC 9728): é por eles que o cliente MCP acha o DMS ID. */
  metadados() {
    return {
      resource: porta.recurso,
      authorization_servers: [porta.emissor],
      scopes_supported: [...PERMISSOES_DO_RECURSO],
      bearer_methods_supported: ['header'],
      resource_name: 'Orzuni (porta MCP)',
    };
  }

  /**
   * Confere o token: forma, assinatura, emissor, destino (esta porta) e validade.
   * Token sem NENHUMA permissão do Orzuni → 403 com todas (o DMS ID emite token
   * para qualquer destino, até sem permissão).
   */
  async conferir(token: string | null): Promise<TokenDmsId> {
    const lido = await conferirTokenDmsId(token ?? '', { chaves: this.chaves(porta.emissor), emissor: porta.emissor, destino: porta.recurso });
    const permissoes = permissoesDoCatalogo(lido.permissoes);
    if (!permissoes.length) throw new ErroPermissaoFaltando(PERMISSOES_DO_RECURSO);
    return { ...lido, permissoes };
  }

  private chaves(emissor: string): ChavesDmsId {
    if (this.guardadas?.emissor !== emissor) this.guardadas = { emissor, chaves: new ChavesDmsId({ jwks: `${emissor}/jwks` }) };
    return this.guardadas.chaves;
  }
}
