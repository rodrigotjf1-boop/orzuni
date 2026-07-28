import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard, ApiKeyGuard } from '../auth/api-key.guard';
import { TelemetriaService } from './telemetria.service';

/** Telemetria: leitura dos erros recentes + registro de erros do frontend. Base: /v1 */
@Controller('telemetria')
@UseGuards(ApiKeyGuard)
export class TelemetriaController {
  constructor(private readonly tel: TelemetriaService) {}

  /** GET /v1/telemetria — últimos eventos (padrão 100). */
  @Get()
  listar(@Query('limite') limite?: string) {
    return { resumo: this.tel.resumo(), eventos: this.tel.listar(limite ? Number(limite) : 100) };
  }

  /** POST /v1/telemetria — o frontend reporta um erro do cliente. */
  @Post()
  registrar(@Body() body: { acao?: string; mensagem?: string; status?: number }) {
    this.tel.registrar({
      nivel: 'error',
      origem: 'frontend',
      acao: body.acao ?? 'app',
      mensagem: body.mensagem ?? 'erro no cliente',
      status: body.status,
    });
    return { ok: true };
  }

  /** DELETE /v1/telemetria — limpa o log (só admin). */
  @Delete()
  @UseGuards(AdminGuard)
  limpar() {
    return { ok: true, apagados: this.tel.limpar() };
  }
}
