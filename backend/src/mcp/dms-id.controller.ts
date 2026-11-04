/**
 * A via do DMS ID, fora da porta MCP em si:
 * - `GET /.well-known/oauth-protected-resource/v1/mcp` — os metadados do recurso
 *   (RFC 9728), FORA do prefixo `/v1`. O 401 da porta aponta para cá.
 * - `POST /v1/dms-id/ligacao` — o atalho F2-3: o Regem manda o token do DMS ID e
 *   uma chave `orz_live_` da conta (`{ "chave_orzuni": "orz_live_…" }`) e recebe
 *   o segredo da ligação.
 *
 * Desligada (`ORZUNI_MCP_ATIVO`), as duas respondem 404.
 */
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req, Res, UseFilters } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ErroProblema } from '../dms/integracao-dms';
import { DmsIdService } from './dms-id.service';
import { LigacaoService, type LigacaoEntregue } from './ligacao.service';
import { bearerDoCabecalho, CAMINHO_DOS_METADADOS, desafioDaRecusa } from './ligacao.regras';
import { ProblemaFilter } from './problema.filter';

const DESLIGADA = 'A porta de integração não está ligada neste ambiente.';

@Controller()
@SkipThrottle()
@UseFilters(ProblemaFilter)
export class DmsIdController {
  constructor(
    private readonly dmsId: DmsIdService,
    private readonly ligacoes: LigacaoService,
  ) {}

  @Get(CAMINHO_DOS_METADADOS)
  @Header('Cache-Control', 'public, max-age=300')
  metadados() {
    if (!this.dmsId.ligado) throw new ErroProblema('nao-encontrado', DESLIGADA);
    return this.dmsId.metadados();
  }

  @Post('dms-id/ligacao')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async trocar(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown): Promise<LigacaoEntregue> {
    if (!this.dmsId.ligado) throw new ErroProblema('nao-encontrado', DESLIGADA);
    const bearer = bearerDoCabecalho(req.headers.authorization);
    try {
      const doToken = await this.dmsId.conferir(bearer);
      const chaveOrzuni = corpo !== null && typeof corpo === 'object' ? (corpo as { chave_orzuni?: unknown }).chave_orzuni : undefined;
      return await this.ligacoes.trocarPorLigacao(chaveOrzuni, doToken.aplicativo, this.dmsId.aplicativos);
    } catch (erro) {
      const desafio = desafioDaRecusa(erro, bearer !== null, this.dmsId.enderecoDosMetadados());
      if (desafio) res.setHeader('WWW-Authenticate', desafio);
      throw erro;
    }
  }
}
