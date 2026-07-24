import { Injectable, Logger } from '@nestjs/common';
import { IfoodMerchantService } from '../ifood/ifood-merchant.service';
import { StoreService } from '../store/store.service';

export interface Conta {
  id?: string;
  merchantId: string;
  nome: string;
}

const TENANT_PADRAO = '00000000-0000-0000-0000-000000000001';

/**
 * Registro de LOJAS (multi-loja). Fonte da verdade: tabela conta_ifood.
 * - `ativas()` lê todas as lojas conectadas; se o banco estiver vazio/fora,
 *   cai para o IFOOD_MERCHANT_ID do env (single-loja) ou para a descoberta
 *   pelo módulo Merchant. Assim a evolução multi-loja é aditiva e não quebra
 *   o setup atual.
 * - `adicionar/remover` gerenciam o registro (usado pelos endpoints de admin).
 */
@Injectable()
export class ContaService {
  private readonly logger = new Logger('conta');
  constructor(
    private readonly merchant: IfoodMerchantService,
    private readonly store: StoreService,
  ) {}

  async ativas(): Promise<Conta[]> {
    try {
      const rows = await this.store.query(
        `select id, merchant_id, nome from conta_ifood where status = 'connected' order by criado_em`,
      );
      if (rows.length) return rows.map((r) => ({ id: r.id, merchantId: r.merchant_id, nome: r.nome ?? 'loja' }));
    } catch (e: any) {
      this.logger.warn(`ativas() do banco falhou: ${e?.message ?? e}`);
    }
    // fallback single-loja
    const env = process.env.IFOOD_MERCHANT_ID;
    if (env) return [{ merchantId: env, nome: 'loja configurada' }];
    const ms = await this.merchant.merchants();
    if (!ms.length) this.logger.warn('nenhuma loja no registro nem autorizada e IFOOD_MERCHANT_ID vazio');
    return ms.map((m) => ({ merchantId: m.id, nome: m.name }));
  }

  /** Resolve o conta_id (uuid) de uma loja pelo merchantId. */
  async contaIdDe(merchantId: string): Promise<string | null> {
    const rows = await this.store.query(`select id from conta_ifood where merchant_id = $1 limit 1`, [merchantId]);
    return rows[0]?.id ?? null;
  }

  /** Registra/atualiza uma loja. */
  async adicionar(merchantId: string, nome: string): Promise<boolean> {
    if (!this.store.temBanco) return false;
    await this.store.query(
      `insert into conta_ifood (tenant_id, merchant_id, nome, status) values ($1,$2,$3,'connected')
       on conflict (tenant_id, merchant_id) do update set nome = excluded.nome, status = 'connected'`,
      [TENANT_PADRAO, merchantId, nome],
    );
    return true;
  }

  /** Remove uma loja do registro (status revoked — não apaga o histórico). */
  async remover(merchantId: string): Promise<boolean> {
    if (!this.store.temBanco) return false;
    await this.store.query(`update conta_ifood set status = 'revoked' where merchant_id = $1`, [merchantId]);
    return true;
  }

  /** Descobre lojas autorizadas no iFood (módulo Merchant) — para o admin escolher. */
  async descobrir(): Promise<Array<{ merchantId: string; nome: string }>> {
    const ms = await this.merchant.merchants();
    return ms.map((m) => ({ merchantId: m.id, nome: m.name }));
  }
}
