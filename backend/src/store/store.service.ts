import { Injectable, Logger } from '@nestjs/common';

/** Espelha item_estado. `desde` = quando entrou no estado atual. */
export interface EstadoItem {
  noAr: boolean;
  desde: number;
  nome: string;
  externalCode: string | null;
}

/** Espelha alerta (append-only; resolvidoEm preenche ao voltar). */
export interface AlertaAberto {
  itemId: string;
  externalCode: string | null;
  nome: string;
  motivo: string;
  grupoAfetado?: string;
  caiuEm: number;
}

/**
 * Persistência EM MEMÓRIA. Estruturada 1:1 com as tabelas para o swap p/ Postgres
 * ser mecânico. ⚠️ Não sobrevive a restart — ok para dev/poller contínuo; a versão
 * de produção lê/grava no `item_estado` e `alerta`.
 */
@Injectable()
export class StoreService {
  private readonly logger = new Logger('store');
  private readonly estado = new Map<string, Map<string, EstadoItem>>(); // merchantId → itemId → estado
  private readonly alertas = new Map<string, Map<string, AlertaAberto>>(); // merchantId → itemId → alerta aberto

  getEstado(merchantId: string): Map<string, EstadoItem> {
    return this.estado.get(merchantId) ?? new Map();
  }

  setEstado(merchantId: string, estado: Map<string, EstadoItem>): void {
    this.estado.set(merchantId, estado);
  }

  /** Reconcilia os alertas abertos com a lista atual de itens fora do ar. */
  reconciliarAlertas(merchantId: string, abertos: AlertaAberto[]): void {
    const atual = new Map(abertos.map((a) => [a.itemId, a]));
    const antigos = this.alertas.get(merchantId) ?? new Map();
    // novos → registra; some da lista → resolve (log)
    for (const [id, a] of atual) if (!antigos.has(id)) this.logger.log(`ALERTA ${a.nome} caiu (${a.motivo})`);
    for (const [id, a] of antigos) if (!atual.has(id)) this.logger.log(`RESOLVIDO ${a.nome}`);
    this.alertas.set(merchantId, atual);
  }

  listarAlertas(merchantId: string): AlertaAberto[] {
    return [...(this.alertas.get(merchantId) ?? new Map()).values()].sort((a, b) => a.caiuEm - b.caiuEm);
  }
}
