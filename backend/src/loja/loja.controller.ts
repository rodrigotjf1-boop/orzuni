import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ContaService } from '../conta/conta.service';
import { LojaService } from './loja.service';

/**
 * API do módulo LOJA (Merchant) — base /v1. Status, interrupções (pausa) e horário de
 * funcionamento da loja. Multi-loja resolvido por requisição (igual ao Catalog).
 */
@Controller('loja')
@UseGuards(ApiKeyGuard)
export class LojaController {
  constructor(
    private readonly loja: LojaService,
    private readonly contas: ContaService,
  ) {}

  private async merchant(req: any, loja?: string): Promise<string> {
    if (req?.contaMerchant) return req.contaMerchant;
    const lojas = await this.contas.ativas();
    if (loja) {
      const l = lojas.find((x) => x.merchantId === loja);
      if (l) return l.merchantId;
    }
    return lojas[0]?.merchantId ?? '';
  }

  /** GET /v1/loja — detalhe + status da loja. */
  @Get()
  async painel(@Req() req: any, @Query('loja') loja?: string) {
    return this.loja.painel(await this.merchant(req, loja));
  }

  /** GET /v1/loja/lojas — lojas autorizadas ao app (paginação opcional page/size). */
  @Get('lojas')
  async lojas(@Query('page') page?: string, @Query('size') size?: string) {
    return { lojas: await this.loja.lojas(page ? +page : undefined, size ? +size : undefined) };
  }

  /** GET /v1/loja/interrupcoes — pausas atuais. */
  @Get('interrupcoes')
  async interrupcoes(@Req() req: any, @Query('loja') loja?: string) {
    return { interrupcoes: await this.loja.interrupcoes(await this.merchant(req, loja)) };
  }

  /** POST /v1/loja/interrupcoes — cria uma pausa (início/fim ISO). */
  @Post('interrupcoes')
  async criarInterrupcao(
    @Req() req: any,
    @Query('loja') loja: string | undefined,
    @Body() body: { descricao: string; inicio: string; fim: string },
  ) {
    return this.loja.criarInterrupcao(await this.merchant(req, loja), body);
  }

  /** DELETE /v1/loja/interrupcoes/:id — cancela uma pausa. */
  @Delete('interrupcoes/:id')
  async cancelarInterrupcao(@Req() req: any, @Param('id') id: string, @Query('loja') loja?: string) {
    return this.loja.cancelarInterrupcao(await this.merchant(req, loja), id);
  }

  /** GET /v1/loja/horarios — horário de funcionamento. */
  @Get('horarios')
  async horarios(@Req() req: any, @Query('loja') loja?: string) {
    return this.loja.horarios(await this.merchant(req, loja));
  }

  /** PUT /v1/loja/horarios — salva o horário (substitui todos os turnos). */
  @Put('horarios')
  async salvarHorarios(
    @Req() req: any,
    @Query('loja') loja: string | undefined,
    @Body() body: { shifts: Array<{ dia: string; inicio: string; duracao: number }> },
  ) {
    return this.loja.salvarHorarios(await this.merchant(req, loja), body.shifts ?? []);
  }
}
