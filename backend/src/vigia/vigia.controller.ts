import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ContaService } from '../conta/conta.service';
import { StoreService } from '../store/store.service';

/**
 * O vigia como serviço: o ERP/CRM consulta o que está fora do ar e há quanto tempo.
 * GET /v1/vigia/alertas — loja resolvida no servidor (não aceita merchantId do cliente).
 */
@Controller('vigia')
@UseGuards(ApiKeyGuard)
export class VigiaController {
  constructor(
    private readonly store: StoreService,
    private readonly contas: ContaService,
  ) {}

  @Get('alertas')
  async alertas() {
    const agora = Date.now();
    const out: any[] = [];
    for (const c of await this.contas.ativas()) {
      for (const a of await this.store.listarAlertas(c.merchantId)) {
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
