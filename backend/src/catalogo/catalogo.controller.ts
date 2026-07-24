import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ContaService } from '../conta/conta.service';
import { CatalogoService } from './catalogo.service';

/**
 * API aberta do catálogo — modelo CANÔNICO (o ERP não conhece "iFood" nem ids).
 * Tudo casa por código de PDV. Base: /v1
 *
 * MULTI-LOJA: a loja é resolvida por requisição:
 *  1) chave de API ligada a uma loja → usa a dela (sem param, IDOR-proof);
 *  2) admin com ?loja=<merchantId> → aquela loja;
 *  3) senão → a única/primeira loja ativa.
 * NUNCA aceita merchantId arbitrário fora dessas regras.
 */
@Controller()
@UseGuards(ApiKeyGuard)
export class CatalogoController {
  constructor(
    private readonly catalogo: CatalogoService,
    private readonly contas: ContaService,
  ) {}

  private async merchant(req: any, loja?: string): Promise<string> {
    if (req?.contaMerchant) return req.contaMerchant; // chave ligada a uma loja
    const lojas = await this.contas.ativas();
    if (loja) {
      const l = lojas.find((x) => x.merchantId === loja);
      if (l) return l.merchantId;
    }
    return lojas[0]?.merchantId ?? '';
  }

  @Get('cardapio')
  async cardapio(@Req() req: any, @Query('loja') loja?: string) {
    return { itens: await this.catalogo.cardapio(await this.merchant(req, loja)) };
  }

  @Patch('precos')
  async precos(
    @Req() req: any,
    @Query('loja') loja: string | undefined,
    @Body() body: { itens: Array<{ pdv: string; preco: number; manterPromo?: boolean }> },
  ) {
    const r = await this.catalogo.reprecificar(await this.merchant(req, loja), body.itens ?? []);
    return { batchId: r.batchId, ignorados: r.ignorados };
  }

  @Patch('itens/:pdv/status')
  async status(@Req() req: any, @Param('pdv') pdv: string, @Query('loja') loja: string | undefined, @Body() body: { status: 'no_ar' | 'pausado' }) {
    return this.catalogo.status(await this.merchant(req, loja), pdv, body.status);
  }

  @Get('itens/:pdv')
  async detalhe(@Req() req: any, @Param('pdv') pdv: string, @Query('loja') loja?: string) {
    const d = await this.catalogo.detalhe(await this.merchant(req, loja), pdv);
    if (!d) return { erro: 'item não encontrado' };
    return d;
  }

  @Patch('itens/:pdv')
  async editar(
    @Req() req: any,
    @Param('pdv') pdv: string,
    @Query('loja') loja: string | undefined,
    @Body() body: { nome?: string; descricao?: string; preco?: number; status?: 'no_ar' | 'pausado' },
  ) {
    return this.catalogo.editar(await this.merchant(req, loja), pdv, body);
  }

  @Get('lotes/:batchId')
  async lote(@Req() req: any, @Param('batchId') batchId: string, @Query('loja') loja?: string) {
    return this.catalogo.batch(await this.merchant(req, loja), batchId);
  }
}
