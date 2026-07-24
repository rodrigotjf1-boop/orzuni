import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ContaService } from '../conta/conta.service';
import { CatalogoService } from './catalogo.service';

/**
 * API aberta do catálogo — modelo CANÔNICO (o ERP não conhece "iFood" nem ids).
 * Tudo casa por código de PDV. Base: /v1
 */
@Controller()
@UseGuards(ApiKeyGuard)
export class CatalogoController {
  constructor(
    private readonly catalogo: CatalogoService,
    private readonly contas: ContaService,
  ) {}

  private async merchant(m?: string): Promise<string> {
    if (m) return m;
    const [c] = await this.contas.ativas();
    return c?.merchantId ?? '';
  }

  /** GET /v1/cardapio — itens + estado + promoção. */
  @Get('cardapio')
  async cardapio(@Query('merchantId') m?: string) {
    return { itens: await this.catalogo.cardapio(await this.merchant(m)) };
  }

  /** PATCH /v1/precos — reprecifica por PDV, preservando o de/por por padrão. */
  @Patch('precos')
  async precos(
    @Body() body: { itens: Array<{ pdv: string; preco: number; manterPromo?: boolean }>; merchantId?: string },
  ) {
    const r = await this.catalogo.reprecificar(await this.merchant(body.merchantId), body.itens ?? []);
    return { batchId: r.batchId, ignorados: r.ignorados };
  }

  /** PATCH /v1/itens/:pdv/status — pausar ("pausado") ou reativar ("no_ar"). */
  @Patch('itens/:pdv/status')
  async status(
    @Param('pdv') pdv: string,
    @Body() body: { status: 'no_ar' | 'pausado'; merchantId?: string },
  ) {
    return this.catalogo.status(await this.merchant(body.merchantId), pdv, body.status);
  }

  /** GET /v1/lotes/:batchId — acompanha o resultado de um lote assíncrono. */
  @Get('lotes/:batchId')
  async lote(@Param('batchId') batchId: string, @Query('merchantId') m?: string) {
    return this.catalogo.batch(await this.merchant(m), batchId);
  }
}
