/**
 * A via do DMS ID, fora da porta MCP em si:
 * - `GET /.well-known/oauth-protected-resource/v1/mcp` — os metadados do recurso
 *   (RFC 9728), FORA do prefixo `/v1`. O 401 da porta aponta para cá.
 * - `POST /v1/dms-id/ligacao` — o atalho F2-3: o Regem manda o token do DMS ID e
 *   uma chave `orz_live_` da conta (`{ "chave_orzuni": "orz_live_…" }`) e recebe
 *   o segredo da ligação.
 * - `DELETE /v1/dms-id/ligacao` — a ligação desliga a SI mesma: autenticada pela
 *   própria ligação (token do DMS ID + cabeçalho `DMS-Ligacao`); para de valer na
 *   chamada seguinte.
 *
 * Desligada (`ORZUNI_MCP_ATIVO`), todas respondem 404.
 */
import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Post, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ErroProblema } from '../dms/integracao-dms';
import { anotarChamada } from '../hub/chamada-atual';
import { AutorizacaoService, type LigacaoDoClique } from './autorizacao.service';
import { DmsIdService } from './dms-id.service';
import { IntegracaoGuard, type RequestDeIntegracao } from './integracao.guard';
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
    private readonly autorizacao: AutorizacaoService,
  ) {}

  /** O token do DMS ID conferido, com o desafio `WWW-Authenticate` na recusa (como o atalho). */
  private async comToken<T>(req: Request, res: Response, ferramenta: string, fn: (doToken: Awaited<ReturnType<DmsIdService['conferir']>>) => Promise<T>): Promise<T> {
    if (!this.dmsId.ligado) throw new ErroProblema('nao-encontrado', DESLIGADA);
    anotarChamada({ ferramenta, credencial: 'dms_id' });
    const bearer = bearerDoCabecalho(req.headers.authorization);
    try {
      return await fn(await this.dmsId.conferir(bearer));
    } catch (erro) {
      const desafio = desafioDaRecusa(erro, bearer !== null, this.dmsId.enderecoDosMetadados());
      if (desafio) res.setHeader('WWW-Authenticate', desafio);
      throw erro;
    }
  }

  /**
   * O pedido empurrado da autorização por clique (RFC 9126; Padrão §3): o aplicativo registra o endereço de volta, as
   * permissões, o `state`, o desafio do PKCE e a conta que pede; recebe o número do pedido (10 minutos) e o endereço da
   * página, que ele abre no navegador com `client_id` e `request_uri`.
   */
  @Post('dms-id/autorizacao/pedido')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  pedir(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown) {
    return this.comToken(req, res, 'dms-id.autorizacao.pedido', (doToken) => this.autorizacao.pedir(doToken, corpo));
  }

  /** A troca do código pela ligação, de servidor para servidor, com o verificador do PKCE. */
  @Post('dms-id/autorizacao/token')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  trocarCodigo(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corpo: unknown): Promise<LigacaoDoClique> {
    return this.comToken(req, res, 'dms-id.autorizacao.token', (doToken) => this.autorizacao.trocar(doToken, corpo));
  }

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
    anotarChamada({ ferramenta: 'dms-id.ligacao', credencial: 'dms_id' });
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

  /**
   * A ligação desliga a SI mesma (Padrão: `revogarPeloProprio`). O `IntegracaoGuard`
   * autentica pela própria ligação (token do DMS ID + `DMS-Ligacao`) — e já devolve
   * 404 com a porta desligada e 401 se a ligação não vale. Idempotente.
   */
  @Delete('dms-id/ligacao')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(IntegracaoGuard)
  async revogar(@Req() req: RequestDeIntegracao): Promise<{ ok: true; revogada_em: string }> {
    anotarChamada({ ferramenta: 'dms-id.ligacao', credencial: 'dms_id' });
    const revogadaEm = await this.ligacoes.revogarPeloProprio(req.integracao!);
    return { ok: true, revogada_em: revogadaEm.toISOString() };
  }
}
