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

  /**
   * Uma transação, tudo ou nada, numa conexão só do pool (a troca do código do clique gasta o código e cria a ligação
   * juntos). Sem banco, lança: quem chama confere `temBanco` antes.
   */
  async transacao<T>(fn: (q: (sql: string, params?: any[]) => Promise<any[]>) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('sem banco: a transação precisa do Postgres');
    const cliente = await this.pool.connect();
    try {
      await cliente.query('begin');
      const r = await fn(async (sql, params = []) => (await cliente.query(sql, params)).rows);
      await cliente.query('commit');
      return r;
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  }

  /**
   * A linha de `conta_ifood` onde fica o ESTADO do vigia desta loja do iFood (item_estado e alerta).
   *
   * O vigia só LÊ o registro de lojas: nunca liga uma loja a uma conta nem troca o nome dela. Antes, aqui havia um
   * upsert de uma linha "loja" na conta da distribuição para TODA loja varrida — com o `status` padrão 'connected'.
   * A loja ligada à conta de um cliente ganhava uma cópia conectada na conta da distribuição: aparecia duas vezes na
   * lista do admin, o vigia a varria duas vezes por rodada e a busca por merchant (`limit 1`) ficava ambígua.
   *
   * Qual linha: a que já guarda estado (o "desde quando" de cada item continua); senão, a mais antiga da loja.
   * Sem linha nenhuma (modo de uma loja só, pelo env ou pela descoberta): cria a âncora na conta da distribuição com
   * status 'revoked' — ela guarda o estado, mas não vira loja conectada. Quem conecta loja é o admin.
   */
  private async contaId(merchantId: string): Promise<string | null> {
    if (!this.pool) return null;
    const cache = this.contaCache.get(merchantId);
    if (cache) return cache;
    const achar = async () =>
      (
        await this.pool!.query(
          `select c.id from conta_ifood c
            where c.merchant_id = $1
            order by exists (select 1 from item_estado e where e.conta_id = c.id) desc, c.criado_em, c.id
            limit 1`,
          [merchantId],
        )
      ).rows[0]?.id as string | undefined;
    let id = await achar();
    if (!id) {
      await this.pool.query(
        `insert into conta_ifood (tenant_id, merchant_id, nome, status) values ($1, $2, 'loja', 'revoked')
         on conflict (tenant_id, merchant_id) do nothing`,
        [TENANT_PADRAO, merchantId],
      );
      id = await achar();
    }
    if (id) this.contaCache.set(merchantId, id);
    return id ?? null;
  }

  // ---- estado ----
  async getEstado(merchantId: string): Promise<Map<string, EstadoItem>> {
    if (!this.pool) return this.memEstado.get(merchantId) ?? new Map();
    try {
      const conta = await this.contaId(merchantId);
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
      const conta = await this.contaId(merchantId);
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
      const conta = await this.contaId(merchantId);
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
      const conta = await this.contaId(merchantId);
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
