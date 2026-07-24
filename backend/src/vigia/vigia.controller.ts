import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ContaService } from '../conta/conta.service';
import { StoreService } from '../store/store.service';

/**
 * O vigia como serviço: o ERP/CRM consulta o que está fora do ar e há quanto tempo.
 * GET /v1/vigia/alertas?merchantId=...
 */
@Controller('vigia')
@UseGuards(ApiKeyGuard)
export class VigiaController {
  constructor(
    private readonly store: StoreService,
    private readonly contas: ContaService,
  ) {}

  @Get('alertas')
  async alertas(@Query('merchantId') merchantId?: string) {
    const agora = Date.now();
    const alvo = merchantId ? [{ merchantId, nome: '' }] : await this.contas.ativas();
    const out: any[] = [];
    for (const c of alvo) {
      for (const a of this.store.listarAlertas(c.merchantId)) {
        out.push({
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
