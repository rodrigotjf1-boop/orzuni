/**
 * O portão da porta MCP: só passa quem traz o token do DMS ID + o segredo da
 * ligação. Desligada (`ORZUNI_MCP_ATIVO=false`) → 404 (a porta não existe).
 * `ACEITAR_INTEGRACOES=false` → 503 (pausa de emergência). As recusas saem no
 * formato do Padrão, com o `WWW-Authenticate` que aponta os metadados (RFC 9728).
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ErroProblema, JanelaFixa } from '../dms/integracao-dms';
import { porta } from './config';
import { DmsIdService } from './dms-id.service';
import { LigacaoService, type IntegracaoAutenticada } from './ligacao.service';
import { bearerDoCabecalho, CABECALHO_LIGACAO_NO_NODE, desafioDaRecusa, LIMITE_POR_MINUTO, ligacaoDoCabecalho } from './ligacao.regras';

export interface RequestDeIntegracao extends Request {
  integracao?: IntegracaoAutenticada;
}

@Injectable()
export class IntegracaoGuard implements CanActivate {
  private readonly limite = new JanelaFixa(LIMITE_POR_MINUTO, 60_000);

  constructor(
    private readonly ligacoes: LigacaoService,
    private readonly dmsId: DmsIdService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const http = contexto.switchToHttp();
    const req = http.getRequest<RequestDeIntegracao>();
    const res = http.getResponse<Response>();

    if (!this.dmsId.ligado) throw new ErroProblema('nao-encontrado', 'A porta de integração não está ligada neste ambiente.');
    if (!porta.aceitaIntegracoes) throw new ErroProblema('integracao-parada', 'A porta de integração está pausada.', { retryAfterSeg: 60 });

    const bearer = bearerDoCabecalho(req.headers.authorization);
    try {
      const doToken = await this.dmsId.conferir(bearer);
      const quem = await this.ligacoes.autenticarLigacao(ligacaoDoCabecalho(req.headers[CABECALHO_LIGACAO_NO_NODE]), doToken, this.dmsId.aplicativos);
      const uso = this.limite.contar(quem.ligacaoId);
      if (!uso.ok) {
        throw new ErroProblema('limite-de-chamadas', `Limite de ${LIMITE_POR_MINUTO} chamadas por minuto atingido para esta ligação.`, { retryAfterSeg: uso.retryAfterSeg });
      }
      req.integracao = quem;
      return true;
    } catch (erro) {
      const desafio = desafioDaRecusa(erro, bearer !== null, this.dmsId.enderecoDosMetadados());
      if (desafio) res.setHeader('WWW-Authenticate', desafio);
      throw erro;
    }
  }
}
