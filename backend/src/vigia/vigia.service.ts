import { Injectable, Logger } from '@nestjs/common';
import { IfoodCatalogService } from '../ifood/ifood-catalog.service';
import type { IfoodCategory, IfoodItem } from '../ifood/ifood.types';

/**
 * VIGIA — o coração do Orzuni.
 *
 * O iFood diz o status ATUAL de um item, mas NUNCA "desde quando". Como não existe
 * evento/webhook de catálogo, o Orzuni varre o cardápio periodicamente e guarda um
 * snapshot. Comparando o snapshot de agora com o `estadoAnterior`, ele sabe o
 * INSTANTE em que cada item caiu — e é isso que ninguém mais tem: "fora do ar há 2 dias".
 *
 * Também classifica POR QUE caiu:
 *  - `cascade` — grupo de complemento obrigatório sem nenhuma opção disponível
 *    (restrição OPTION_GROUP_WITHOUT_AVAILABLE_OPTIONS). O mais perigoso: o lojista
 *    nunca pausou o item, ele caiu sozinho. Grupos são compartilhados → derruba vários.
 *  - `manual` — item com status UNAVAILABLE direto (alguém pausou e esqueceu).
 *  - `stock` — pausado por estoque (heurística; refinar com o módulo de inventário).
 *
 * ⚠️ `unsellableItems` é EVENTUAL (~10s de latência). O poller deve varrer em
 * intervalo folgado (ex.: 2 min) e nunca confiar na 1ª leitura logo após uma escrita.
 */

export type MotivoQueda = 'cascade' | 'manual' | 'stock' | 'unknown';

export interface Alerta {
  itemId: string;
  externalCode: string | null;
  nome: string;
  motivo: MotivoQueda;
  desde: number; // epoch ms em que caiu (do snapshot)
  grupoAfetado?: string; // nome do grupo que derrubou (cascata)
}

/** Estado por item guardado entre varreduras (na prática: tabela item_estado). */
interface EstadoItem {
  noAr: boolean;
  desde: number; // quando entrou no estado atual
  nome: string;
  externalCode: string | null;
}

@Injectable()
export class VigiaService {
  private readonly logger = new Logger('vigia');

  constructor(private readonly catalog: IfoodCatalogService) {}

  /**
   * Varre uma loja e devolve os alertas, atualizando o mapa de estado.
   * `estadoAnterior` vem do banco (item_estado); persista o retornado em `estado`.
   */
  async varrer(
    merchantId: string,
    estadoAnterior: Map<string, EstadoItem>,
    agora: number,
  ): Promise<{ alertas: Alerta[]; estado: Map<string, EstadoItem> }> {
    const [catalogo] = await this.catalog.catalogs(merchantId);
    if (!catalogo) return { alertas: [], estado: estadoAnterior };

    const categorias = await this.catalog.categories(merchantId, catalogo.catalogId);
    const unsell = await this.catalog.unsellable(merchantId, catalogo.catalogId);

    // itens invendáveis por cascata (grupo obrigatório sem opção) → itemId(s)
    const cascata = new Set<string>();
    for (const c of unsell.categories ?? []) {
      for (const u of c.unsellableItems ?? []) {
        if (u.restrictions?.includes('OPTION_GROUP_WITHOUT_AVAILABLE_OPTIONS')) cascata.add(u.id);
      }
    }

    const estado = new Map<string, EstadoItem>();
    const alertas: Alerta[] = [];

    for (const item of this.itens(categorias)) {
      const noArAgora = this.itemNoAr(item, cascata);
      const ext = this.externalCode(item);
      const prev = estadoAnterior.get(item.id);

      // "desde" = quando ENTROU no estado atual. Se o estado não mudou, mantém o
      // desde anterior; se mudou (ou é a 1ª vez que vemos o item), carimba agora.
      const mudou = !prev || prev.noAr !== noArAgora;
      const desde = mudou ? agora : prev!.desde;

      estado.set(item.id, { noAr: noArAgora, desde, nome: item.name ?? item.id, externalCode: ext });

      if (!noArAgora) {
        alertas.push({
          itemId: item.id,
          externalCode: ext,
          nome: item.name ?? item.id,
          motivo: this.motivo(item, cascata),
          desde,
          grupoAfetado: cascata.has(item.id) ? this.grupoSemOpcao(item) : undefined,
        });
      }
    }

    // ordena: mais tempo parado primeiro
    alertas.sort((a, b) => a.desde - b.desde);
    this.logger.log(`${merchantId.slice(0, 8)} · ${alertas.length} fora do ar (${cascata.size} em cascata)`);
    return { alertas, estado };
  }

  // ---- helpers ----
  private *itens(categorias: IfoodCategory[]): Generator<IfoodCategory['items'][number]> {
    for (const c of categorias) for (const it of c.items ?? []) yield it;
  }

  private itemNoAr(item: IfoodItem, cascata: Set<string>): boolean {
    if (cascata.has(item.id)) return false; // caiu por complemento
    // status efetivo: raiz ou contexto DEFAULT
    const ctx = item.contextModifiers?.find((m) => m.catalogContext === 'DEFAULT');
    const status = ctx?.status ?? item.status;
    return status === 'AVAILABLE';
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

  private grupoSemOpcao(item: IfoodItem & { optionGroups?: { name: string; status: string }[] }): string | undefined {
    // nome do 1º grupo do item (refino: cruzar com options paused via itemFlat)
    return item.optionGroups?.[0]?.name;
  }
}
