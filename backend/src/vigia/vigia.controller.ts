import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ContaService } from '../conta/conta.service';
import { StoreService } from '../store/store.service';

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
  ) {}

  @Get('alertas')
  async alertas(@Req() req: any, @Query('loja') loja?: string) {
    const agora = Date.now();
    let alvo: Array<{ merchantId: string; nome: string }>;
    if (req?.contaMerchant) {
      alvo = [{ merchantId: req.contaMerchant, nome: '' }]; // chave ligada a uma loja
    } else {
      const lojas = await this.contas.ativas();
      alvo = loja ? lojas.filter((l) => l.merchantId === loja) : lojas; // admin: uma ou todas
    }

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
}
