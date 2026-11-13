/**
 * As rotas da autorização por clique do lado do DONO DA CONTA (sessão do app web, nunca chave de API):
 * - `GET  /v1/autorizacao/pedido?numero=…` — o que a página `/autorizar` mostra;
 * - `POST /v1/autorizacao/autorizar` — a senha, a loja e as opcionais; devolve a volta com o código;
 * - `POST /v1/autorizacao/recusar` — "Agora não";
 * - `GET  /v1/aplicativos-conectados` e `POST /v1/aplicativos-conectados/desligar`.
 *
 * As do APLICATIVO (o pedido empurrado e a troca do código) ficam no `DmsIdController`, com o token do DMS ID.
 */
import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';

import { SessaoGuard } from '../auth/sessao.guard';
import { AutorizacaoService, type DonoDaSessao } from './autorizacao.service';
import { ProblemaFilter } from './problema.filter';

const dono = (req: any): DonoDaSessao => req.usuario as DonoDaSessao;

@Controller()
@UseGuards(SessaoGuard)
@UseFilters(ProblemaFilter)
export class AutorizacaoController {
  constructor(private readonly autorizacao: AutorizacaoService) {}

  @Get('autorizacao/pedido')
  @Header('Cache-Control', 'no-store')
  ler(@Req() req: any, @Query('numero') numero: string) {
    return this.autorizacao.lerParaTela(dono(req), numero);
  }

  @Post('autorizacao/autorizar')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  autorizar(@Req() req: any, @Body() corpo: unknown) {
    return this.autorizacao.autorizar(dono(req), corpo);
  }

  @Post('autorizacao/recusar')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  recusar(@Req() req: any, @Body() corpo: unknown) {
    return this.autorizacao.recusar(dono(req), corpo);
  }

  @Get('aplicativos-conectados')
  @Header('Cache-Control', 'no-store')
  conectados(@Req() req: any) {
    return this.autorizacao.conectados(dono(req));
  }

  @Post('aplicativos-conectados/desligar')
  @HttpCode(HttpStatus.OK)
  desligar(@Req() req: any, @Body() corpo: unknown) {
    return this.autorizacao.desligar(dono(req), corpo);
  }
}
