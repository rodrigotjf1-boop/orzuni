import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ContaService } from '../conta/conta.service';
import { CatalogoService } from './catalogo.service';

/**
 * API aberta do catálogo — modelo CANÔNICO (o ERP não conhece "iFood" nem ids).
 * Tudo casa por código de PDV. Base: /v1
 *
 * SEGURANÇA: a loja (merchant) é resolvida SEMPRE no servidor (ContaService),
 * NUNCA aceita merchantId do cliente — senão uma chave poderia agir sobre a loja
 * de outro tenant (IDOR). Quando houver multi-tenant, a conta virá do tenant da chave.
 */
@Controller()
@UseGuards(ApiKeyGuard)
export class CatalogoController {
  constructor(
    private readonly catalogo: CatalogoService,
    private readonly contas: ContaService,
  ) {}

  private async merchant(): Promise<string> {
    const [c] = await this.contas.ativas();
    return c?.merchantId ?? '';
  }

  /** GET /v1/cardapio — itens + estado + promoção. */
  @Get('cardapio')
  async cardapio() {
    return { itens: await this.catalogo.cardapio(await this.merchant()) };
  }

  /** PATCH /v1/precos — reprecifica por PDV, preservando o de/por por padrão. */
  @Patch('precos')
  async precos(@Body() body: { itens: Array<{ pdv: string; preco: number; manterPromo?: boolean }> }) {
    const r = await this.catalogo.reprecificar(await this.merchant(), body.itens ?? []);
    return { batchId: r.batchId, ignorados: r.ignorados };
  }

  /** PATCH /v1/itens/:pdv/status — pausar ("pausado") ou reativar ("no_ar"). */
  @Patch('itens/:pdv/status')
  async status(@Param('pdv') pdv: string, @Body() body: { status: 'no_ar' | 'pausado' }) {
    return this.catalogo.status(await this.merchant(), pdv, body.status);
  }

  /** GET /v1/lotes/:batchId — acompanha o resultado de um lote assíncrono. */
  @Get('lotes/:batchId')
  async lote(@Param('batchId') batchId: string) {
    return this.catalogo.batch(await this.merchant(), batchId);
  }
}
