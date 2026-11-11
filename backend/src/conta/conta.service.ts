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
        // só as lojas OPERACIONAIS: a loja de teste de integração (so_integracao) fica de
        // fora do vigia/poller e de tudo que chama o iFood (merchant inventado).
        `select id, merchant_id, nome from conta_ifood where status = 'connected' and so_integracao = false order by criado_em`,
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

  // ---- multi-tenant (Fase 0): as lojas de UM tenant (o usuário logado) ----

  /** As lojas conectadas DESTE tenant (a conta do usuário logado). Sem fallback global. */
  async ativasDoTenant(tenant: string): Promise<Conta[]> {
    if (!this.store.temBanco) return [];
    try {
      const rows = await this.store.query(
        // o lojista nunca vê a loja de teste de integração (so_integracao)
        `select id, merchant_id, nome from conta_ifood where tenant_id = $1 and status = 'connected' and so_integracao = false order by criado_em`,
        [tenant],
      );
      return rows.map((r) => ({ id: r.id, merchantId: r.merchant_id, nome: r.nome ?? 'loja' }));
    } catch (e: any) {
      this.logger.warn(`ativasDoTenant falhou: ${e?.message ?? e}`);
      return [];
    }
  }

  /**
   * Lista de ADMIN (tela "API / ERP"): as lojas conectadas, INCLUSIVE as de teste de
   * integração, cada uma com a marca `soIntegracao` — para o admin ver e apagar.
   */
  async listarAdmin(): Promise<Array<{ id?: string; merchantId: string; nome: string; soIntegracao: boolean }>> {
    if (!this.store.temBanco) return [];
    try {
      const rows = await this.store.query(
        `select id, merchant_id, nome, so_integracao from conta_ifood where status = 'connected' order by so_integracao, criado_em`,
      );
      return rows.map((r) => ({ id: r.id, merchantId: r.merchant_id, nome: r.nome ?? 'loja', soIntegracao: r.so_integracao === true }));
    } catch (e: any) {
      this.logger.warn(`listarAdmin falhou: ${e?.message ?? e}`);
      return [];
    }
  }

  /** O tenant que JÁ liga este merchant (connected), ou null. Trava anti-IDOR do conectar. */
  async tenantDoMerchant(merchantId: string): Promise<string | null> {
    const rows = await this.store.query(
      `select tenant_id from conta_ifood where merchant_id = $1 and status = 'connected' limit 1`,
      [merchantId],
    );
    return rows[0]?.tenant_id ?? null;
  }

  /**
   * Conecta uma loja AO TENANT do usuário logado (não TENANT_PADRAO). À prova de
   * IDOR: recusa reivindicar uma loja já conectada a OUTRO tenant.
   */
  async adicionarNoTenant(tenant: string, merchantId: string, nome: string): Promise<{ ok: boolean; erro?: string }> {
    if (!this.store.temBanco) return { ok: false, erro: 'banco indisponível' };
    const dono = await this.tenantDoMerchant(merchantId);
    if (dono && dono !== tenant) return { ok: false, erro: 'esta loja já está conectada a outra conta' };
    try {
      await this.store.query(
        `insert into conta_ifood (tenant_id, merchant_id, nome, status) values ($1,$2,$3,'connected')
         on conflict (tenant_id, merchant_id) do update set nome = excluded.nome, status = 'connected'`,
        [tenant, merchantId, nome],
      );
      return { ok: true };
    } catch (e: any) {
      this.logger.warn(`adicionarNoTenant falhou: ${e?.message ?? e}`);
      return { ok: false, erro: 'não foi possível conectar a loja' };
    }
  }

  /**
   * Lojas autorizadas no iFood ao app do Orzuni que ESTE tenant ainda pode conectar:
   * tira as que já são minhas e ESCONDE as já reivindicadas por outro tenant (anti-IDOR).
   * ⚠️ Uma loja autorizada ao app e ainda SEM dono aparece para quem a descobrir —
   * a verificação de posse real (o usuário autorizou ESSE merchant no iFood) é
   * material de uma fase seguinte; por ora o conectar é do piloto/dono.
   */
  async disponiveisParaTenant(tenant: string): Promise<Array<{ merchantId: string; nome: string }>> {
    const todas = await this.descobrir();
    const jaMinhas = new Set((await this.ativasDoTenant(tenant)).map((c) => c.merchantId));
    const out: Array<{ merchantId: string; nome: string }> = [];
    for (const m of todas) {
      if (jaMinhas.has(m.merchantId)) continue;
      const dono = await this.tenantDoMerchant(m.merchantId);
      if (dono && dono !== tenant) continue;
      out.push(m);
    }
    return out;
  }

  /** Registra/atualiza uma loja. `soIntegracao` marca a loja de teste do kit (admin). */
  async adicionar(merchantId: string, nome: string, soIntegracao = false): Promise<boolean> {
    if (!this.store.temBanco) return false;
    await this.store.query(
      `insert into conta_ifood (tenant_id, merchant_id, nome, status, so_integracao) values ($1,$2,$3,'connected',$4)
       on conflict (tenant_id, merchant_id) do update set nome = excluded.nome, status = 'connected', so_integracao = excluded.so_integracao`,
      [TENANT_PADRAO, merchantId, nome, soIntegracao],
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
