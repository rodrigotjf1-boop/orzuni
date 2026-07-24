import { Injectable, Logger } from '@nestjs/common';
import { IfoodCatalogService } from '../ifood/ifood-catalog.service';
import type { IfoodCategory, IfoodItem } from '../ifood/ifood.types';
import type { EstadoItem } from '../store/store.service';

/**
 * VIGIA — o coração do Orzuni.
 *
 * O iFood diz o status ATUAL de um item, mas NUNCA "desde quando". Como não existe
 * evento/webhook de catálogo, o Orzuni varre o cardápio periodicamente e guarda um
 * snapshot. Comparando o snapshot de agora com o anterior, ele sabe o INSTANTE em
 * que cada item caiu — e é isso que ninguém mais tem: "fora do ar há 2 dias".
 *
 * Classifica POR QUE caiu:
 *  - `cascade` — grupo obrigatório sem nenhuma opção (OPTION_GROUP_WITHOUT_AVAILABLE_OPTIONS).
 *    O mais perigoso: o lojista nunca pausou o item. Grupos são compartilhados → derruba vários.
 *  - `manual` — item com status UNAVAILABLE direto (alguém pausou e esqueceu).
 *  - `unknown` — invendável por outro motivo (refinar com unsellableItems).
 *
 * ⚠️ `unsellableItems` é EVENTUAL (~10s). Varrer em intervalo folgado (2 min) e nunca
 * confiar na 1ª leitura logo após uma escrita.
 */
export type MotivoQueda = 'cascade' | 'manual' | 'stock' | 'unknown';

export interface Alerta {
  itemId: string;
  externalCode: string | null;
  nome: string;
  motivo: MotivoQueda;
  desde: number;
  grupoAfetado?: string;
}

type ItemComGrupos = IfoodItem & { name?: string; optionGroups?: { name: string; status: string }[] };

@Injectable()
export class VigiaService {
  private readonly logger = new Logger('vigia');
  constructor(private readonly catalog: IfoodCatalogService) {}

  async varrer(
    merchantId: string,
    estadoAnterior: Map<string, EstadoItem>,
    agora: number,
  ): Promise<{ alertas: Alerta[]; estado: Map<string, EstadoItem> }> {
    const [catalogo] = await this.catalog.catalogs(merchantId);
    if (!catalogo) return { alertas: [], estado: estadoAnterior };

    const categorias = await this.catalog.categories(merchantId, catalogo.catalogId);
    const unsell = await this.catalog.unsellable(merchantId, catalogo.catalogId);

    const cascata = new Set<string>();
    for (const c of unsell.categories ?? [])
      for (const u of c.unsellableItems ?? [])
        if (u.restrictions?.includes('OPTION_GROUP_WITHOUT_AVAILABLE_OPTIONS')) cascata.add(u.id);

    const estado = new Map<string, EstadoItem>();
    const alertas: Alerta[] = [];

    for (const item of this.itens(categorias)) {
      const noAr = this.itemNoAr(item, cascata);
      const ext = this.externalCode(item);
      const prev = estadoAnterior.get(item.id);
      const mudou = !prev || prev.noAr !== noAr;
      const desde = mudou ? agora : prev!.desde;

      estado.set(item.id, { noAr, desde, nome: item.name ?? item.id, externalCode: ext });

      if (!noAr) {
        alertas.push({
          itemId: item.id,
          externalCode: ext,
          nome: item.name ?? item.id,
          motivo: this.motivo(item, cascata),
          desde,
          grupoAfetado: cascata.has(item.id) ? item.optionGroups?.[0]?.name : undefined,
        });
      }
    }

    alertas.sort((a, b) => a.desde - b.desde);
    this.logger.log(`${merchantId.slice(0, 8)} · ${alertas.length} fora do ar (${cascata.size} em cascata)`);
    return { alertas, estado };
  }

  private *itens(categorias: IfoodCategory[]): Generator<ItemComGrupos> {
    for (const c of categorias) for (const it of c.items ?? []) yield it as ItemComGrupos;
  }

  private itemNoAr(item: IfoodItem, cascata: Set<string>): boolean {
    if (cascata.has(item.id)) return false;
    const ctx = item.contextModifiers?.find((m) => m.catalogContext === 'DEFAULT');
    return (ctx?.status ?? item.status) === 'AVAILABLE';
  }

  private motivo(item: IfoodItem, cascata: Set<string>): MotivoQueda {
    if (cascata.has(item.id)) return 'cascade';
    if (item.status === 'UNAVAILABLE') return 'manual';
    return 'unknown';
  }

  private externalCode(item: IfoodItem): string | null {
    const ctx = item.contextModifiers?.find((m) => m.externalCode);
    return item.externalCode ?? ctx?.externalCode ?? null;
  }
}
