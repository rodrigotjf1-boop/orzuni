import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ContaService } from '../conta/conta.service';
import { StoreService } from '../store/store.service';
import { VigiaPoller } from './vigia.poller';

/**
 * O vigia como serviço: o que está fora do ar e há quanto tempo.
 * MULTI-LOJA: chave ligada → só a loja dela; admin → ?loja=<merchantId> ou TODAS.
 */
@Controller('vigia')
@UseGuards(ApiKeyGuard)
export class VigiaController {
  constructor(
    private readonly store: StoreService,
    private readonly contas: ContaService,
    private readonly poller: VigiaPoller,
  ) {}

  // resolve as lojas-alvo da requisição (chave ligada / admin com ?loja / todas)
  private async alvos(req: any, loja?: string): Promise<Array<{ merchantId: string; nome: string }>> {
    if (req?.contaMerchant) return [{ merchantId: req.contaMerchant, nome: '' }];
    const lojas = await this.contas.ativas();
    return loja ? lojas.filter((l) => l.merchantId === loja) : lojas;
  }

  private async montarAlertas(alvo: Array<{ merchantId: string; nome: string }>) {
    const agora = Date.now();
    const out: any[] = [];
    for (const c of alvo) {
      for (const a of await this.store.listarAlertas(c.merchantId)) {
        out.push({
          loja: c.merchantId,
          pdv: a.externalCode,
          nome: a.nome,
          motivo: a.motivo,
          grupoAfetado: a.grupoAfetado ?? null,
          desde: new Date(a.caiuEm).toISOString(),
          foraHaMs: agora - a.caiuEm,
        });
      }
    }
    return { alertas: out };
  }

  @Get('alertas')
  async alertas(@Req() req: any, @Query('loja') loja?: string) {
    return this.montarAlertas(await this.alvos(req, loja));
  }

  /**
   * POST /vigia/varrer — força uma varredura AGORA (não espera o poll de 2 min) e
   * devolve os alertas já reconciliados. Usado pelo botão "Atualizar" da tela.
   */
  @Post('varrer')
  async varrer(@Req() req: any, @Query('loja') loja?: string) {
    const alvo = await this.alvos(req, loja);
    for (const c of alvo) await this.poller.varrerLoja(c.merchantId).catch(() => {});
    return this.montarAlertas(alvo);
  }
}
