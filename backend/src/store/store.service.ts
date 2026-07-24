import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

/** Espelha item_estado. `desde` = quando entrou no estado atual (epoch ms). */
export interface EstadoItem {
  noAr: boolean;
  desde: number;
  nome: string;
  externalCode: string | null;
}

/** Espelha alerta (aberto = resolvido_em IS NULL). */
export interface AlertaAberto {
  itemId: string;
  externalCode: string | null;
  nome: string;
  motivo: string;
  grupoAfetado?: string;
  caiuEm: number;
}

// tenant único por enquanto (multi-tenant vem depois).
const TENANT_PADRAO = '00000000-0000-0000-0000-000000000001';

/**
 * Persistência do vigia. Usa Postgres (Supabase) quando DATABASE_URL existe;
 * cai para memória se não existir (dev). É DEFENSIVA: qualquer erro de banco é
 * logado e degradado — nunca derruba a API nem o poller.
 *
 * Mapeia 1:1 com database/001_init.sql (conta_ifood, item_estado, alerta).
 * O app trabalha por merchantId; aqui resolvemos o conta_id (uuid) via upsert
 * em conta_ifood e cacheamos o mapeamento.
 */
@Injectable()
export class StoreService implements OnModuleInit {
  private readonly logger = new Logger('store');
  private pool: Pool | null = null;
  private readonly contaCache = new Map<string, string>(); // merchantId → contaId

  // fallback em memória (quando não há banco)
  private readonly memEstado = new Map<string, Map<string, EstadoItem>>();
  private readonly memAlertas = new Map<string, Map<string, AlertaAberto>>();

  onModuleInit() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      this.logger.warn('DATABASE_URL ausente — persistência EM MEMÓRIA (não sobrevive a restart)');
      return;
    }
    const ssl = /supabase|amazonaws|render|neon/.test(url) ? { rejectUnauthorized: false } : undefined;
    this.pool = new Pool({ connectionString: url, ssl, max: 4 });
    this.logger.log('persistência: Postgres');
  }

  /** Está com Postgres conectado? (false = modo memória). */
  get temBanco(): boolean {
    return !!this.pool;
  }

  /** Query genérica no pool (para o ApiKeyService). Sem pool → []. */
  async query(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.pool) return [];
    const { rows } = await this.pool.query(sql, params);
    return rows;
  }

  private async contaId(merchantId: string, nome: string): Promise<string | null> {
    if (!this.pool) return null;
    const cache = this.contaCache.get(merchantId);
    if (cache) return cache;
    const { rows } = await this.pool.query(
      `insert into conta_ifood (tenant_id, merchant_id, nome) values ($1,$2,$3)
       on conflict (tenant_id, merchant_id) do update set nome = excluded.nome
       returning id`,
      [TENANT_PADRAO, merchantId, nome],
    );
    const id = rows[0]?.id as string;
    if (id) this.contaCache.set(merchantId, id);
    return id;
  }

  // ---- estado ----
  async getEstado(merchantId: string): Promise<Map<string, EstadoItem>> {
    if (!this.pool) return this.memEstado.get(merchantId) ?? new Map();
    try {
      const conta = await this.contaId(merchantId, 'loja');
      const { rows } = await this.pool.query(
        `select item_id, external_code, nome, no_ar,
                (extract(epoch from desde)*1000)::bigint as desde
         from item_estado where conta_id = $1`,
        [conta],
      );
      const m = new Map<string, EstadoItem>();
      for (const r of rows)
        m.set(r.item_id, { noAr: r.no_ar, desde: Number(r.desde), nome: r.nome, externalCode: r.external_code });
      return m;
    } catch (e: any) {
      this.logger.warn(`getEstado falhou: ${e?.message ?? e}`);
      return new Map();
    }
  }

  async setEstado(merchantId: string, estado: Map<string, EstadoItem>): Promise<void> {
    if (!this.pool) {
      this.memEstado.set(merchantId, estado);
      return;
    }
    if (estado.size === 0) return;
    try {
      const conta = await this.contaId(merchantId, 'loja');
      // upsert em lote via um INSERT com múltiplos VALUES
      const vals: any[] = [];
      const linhas: string[] = [];
      let i = 1;
      for (const [itemId, e] of estado) {
        linhas.push(`($${i++},$${i++},$${i++},$${i++},$${i++},to_timestamp($${i++}/1000.0),now())`);
        vals.push(conta, itemId, e.externalCode, e.nome, e.noAr, e.desde);
      }
      await this.pool.query(
        `insert into item_estado (conta_id,item_id,external_code,nome,no_ar,desde,atualizado_em)
         values ${linhas.join(',')}
         on conflict (conta_id,item_id) do update set
           external_code=excluded.external_code, nome=excluded.nome,
           no_ar=excluded.no_ar, desde=excluded.desde, atualizado_em=now()`,
        vals,
      );
    } catch (e: any) {
      this.logger.warn(`setEstado falhou: ${e?.message ?? e}`);
    }
  }

  // ---- alertas ----
  async reconciliarAlertas(merchantId: string, abertos: AlertaAberto[]): Promise<void> {
    if (!this.pool) {
      const atual = new Map(abertos.map((a) => [a.itemId, a]));
      const antigos = this.memAlertas.get(merchantId) ?? new Map();
      for (const [id, a] of atual) if (!antigos.has(id)) this.logger.log(`ALERTA ${a.nome} caiu (${a.motivo})`);
      for (const [id, a] of antigos) if (!atual.has(id)) this.logger.log(`RESOLVIDO ${a.nome}`);
      this.memAlertas.set(merchantId, atual);
      return;
    }
    try {
      const conta = await this.contaId(merchantId, 'loja');
      const { rows } = await this.pool.query(
        `select item_id from alerta where conta_id = $1 and resolvido_em is null`,
        [conta],
      );
      const abertosDb = new Set<string>(rows.map((r) => r.item_id));
      const atual = new Map(abertos.map((a) => [a.itemId, a]));
      // novos → INSERT
      for (const [itemId, a] of atual) {
        if (abertosDb.has(itemId)) continue;
        await this.pool.query(
          `insert into alerta (conta_id,item_id,external_code,nome,motivo,grupo_afetado,caiu_em)
           values ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0))`,
          [conta, itemId, a.externalCode, a.nome, a.motivo, a.grupoAfetado ?? null, a.caiuEm],
        );
        this.logger.log(`ALERTA ${a.nome} caiu (${a.motivo})`);
      }
      // sumiram → resolve
      for (const itemId of abertosDb) {
        if (atual.has(itemId)) continue;
        await this.pool.query(
          `update alerta set resolvido_em = now() where conta_id=$1 and item_id=$2 and resolvido_em is null`,
          [conta, itemId],
        );
        this.logger.log(`RESOLVIDO ${itemId}`);
      }
    } catch (e: any) {
      this.logger.warn(`reconciliarAlertas falhou: ${e?.message ?? e}`);
    }
  }

  async listarAlertas(merchantId: string): Promise<AlertaAberto[]> {
    if (!this.pool)
      return [...(this.memAlertas.get(merchantId) ?? new Map()).values()].sort((a, b) => a.caiuEm - b.caiuEm);
    try {
      const conta = await this.contaId(merchantId, 'loja');
      const { rows } = await this.pool.query(
        `select item_id, external_code, nome, motivo, grupo_afetado,
                (extract(epoch from caiu_em)*1000)::bigint as caiu_em
         from alerta where conta_id=$1 and resolvido_em is null order by caiu_em`,
        [conta],
      );
      return rows.map((r) => ({
        itemId: r.item_id,
        externalCode: r.external_code,
        nome: r.nome,
        motivo: r.motivo,
        grupoAfetado: r.grupo_afetado ?? undefined,
        caiuEm: Number(r.caiu_em),
      }));
    } catch (e: any) {
      this.logger.warn(`listarAlertas falhou: ${e?.message ?? e}`);
      return [];
    }
  }
}
