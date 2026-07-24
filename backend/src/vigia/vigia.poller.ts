import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ContaService } from '../conta/conta.service';
import { StoreService } from '../store/store.service';
import { VigiaService } from './vigia.service';

/**
 * Poller do vigia — DENTRO da API. Varre cada loja a cada 2 min (intervalo folgado
 * por causa da latência eventual do unsellableItems). Sequencial entre lojas para
 * respeitar o rate limit do app (cota é do APP, não da loja).
 */
@Injectable()
export class VigiaPoller {
  private readonly logger = new Logger('vigia/poller');
  private rodando = false;

  constructor(
    private readonly contas: ContaService,
    private readonly vigia: VigiaService,
    private readonly store: StoreService,
  ) {}

  @Cron('0 */2 * * * *') // a cada 2 minutos
  async varrer(): Promise<void> {
    if (this.rodando) return; // evita sobreposição se uma varredura demorar
    this.rodando = true;
    try {
      const contas = await this.contas.ativas();
      const agora = Date.now();
      for (const c of contas) {
        try {
          const prev = this.store.getEstado(c.merchantId);
          const { alertas, estado } = await this.vigia.varrer(c.merchantId, prev, agora);
          this.store.setEstado(c.merchantId, estado);
          this.store.reconciliarAlertas(
            c.merchantId,
            alertas.map((a) => ({
              itemId: a.itemId,
              externalCode: a.externalCode,
              nome: a.nome,
              motivo: a.motivo,
              grupoAfetado: a.grupoAfetado,
              caiuEm: a.desde,
            })),
          );
        } catch (e: any) {
          this.logger.warn(`varredura ${c.merchantId.slice(0, 8)} falhou: ${e?.message ?? e}`);
        }
      }
    } finally {
      this.rodando = false;
    }
  }
}
