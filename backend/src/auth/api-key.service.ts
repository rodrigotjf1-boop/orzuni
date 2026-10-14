import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { StoreService } from '../store/store.service';
import { escoposValidos } from './escopos';

const TENANT_PADRAO = '00000000-0000-0000-0000-000000000001';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ChaveInfo {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  criadoEm: string;
  ultimoUso: string | null;
  loja: { merchantId: string; nome: string } | null;
}

/**
 * Chaves de API para o ERP/CRM (tabela api_key). Guarda só o HASH do segredo;
 * o valor em claro aparece uma única vez, na criação. Formato: orz_live_<hex>.
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger('api-key');
  constructor(private readonly store: StoreService) {}

  /** Valida uma chave de tabela (hash). Retorna id + loja + escopos + teto. */
  async validarTabela(
    token: string,
  ): Promise<{ keyId: string; merchantId: string | null; escopos: string[]; rateLimit: number } | null> {
    if (!this.store.temBanco) return null;
    try {
      const rows = await this.store.query(
        `select k.id, k.escopos, k.rate_limit, c.merchant_id from api_key k
         left join conta_ifood c on c.id = k.conta_id
         where k.hash = $1 and k.revogada_em is null limit 1`,
        [sha256(token)],
      );
      if (!rows.length) return null;
      this.store.query(`update api_key set ultimo_uso = now() where id = $1`, [rows[0].id]).catch(() => {});
      return {
        keyId: rows[0].id,
        merchantId: rows[0].merchant_id ?? null,
        escopos: Array.isArray(rows[0].escopos) ? rows[0].escopos : [],
        rateLimit: Number(rows[0].rate_limit) > 0 ? Number(rows[0].rate_limit) : 120,
      };
    } catch (e: any) {
      this.logger.warn(`validarTabela falhou: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Atualiza os escopos de uma chave (tela "API & ERP"). Só escopos conhecidos. */
  async atualizarEscopos(id: string, escopos: string[]): Promise<boolean> {
    if (!this.store.temBanco) return false;
    const limpos = escoposValidos(escopos);
    try {
      const rows = await this.store.query(
        `update api_key set escopos = $2
          where id = $1 and tenant_id = $3 and revogada_em is null returning id`,
        [id, limpos.length ? limpos : ['catalogo:ler'], TENANT_PADRAO],
      );
      return rows.length > 0;
    } catch (e: any) {
      this.logger.warn(`atualizarEscopos falhou: ${e?.message ?? e}`);
      return false;
    }
  }

  /** Cria uma chave, opcionalmente LIGADA a uma loja (merchantId). Segredo 1x. */
  async criar(
    nome: string,
    escopos: string[],
    merchantId?: string,
  ): Promise<{ chave: string; prefixo: string } | null> {
    if (!this.store.temBanco) return null;
    let contaId: string | null = null;
    if (merchantId) {
      const rows = await this.store.query(`select id from conta_ifood where merchant_id = $1 limit 1`, [merchantId]);
      contaId = rows[0]?.id ?? null;
    }
    const chave = 'orz_live_' + randomBytes(24).toString('hex');
    const prefixo = chave.slice(0, 16);
    try {
      await this.store.query(
        `insert into api_key (tenant_id, nome, prefixo, hash, escopos, conta_id) values ($1,$2,$3,$4,$5,$6)`,
        [TENANT_PADRAO, nome, prefixo, sha256(chave), escoposValidos(escopos).length ? escoposValidos(escopos) : ['catalogo:ler'], contaId],
      );
    } catch (e: any) {
      this.logger.warn(`criar falhou (migration 002 aplicada?): ${e?.message ?? e}`);
      return null;
    }
    return { chave, prefixo };
  }

  async listar(): Promise<ChaveInfo[]> {
    if (!this.store.temBanco) return [];
    let rows: any[] = [];
    try {
      rows = await this.store.query(
        `select k.id, k.nome, k.prefixo, k.escopos, k.criado_em, k.ultimo_uso,
                c.merchant_id as loja_merchant, c.nome as loja_nome
         from api_key k left join conta_ifood c on c.id = k.conta_id
         where k.tenant_id = $1 and k.revogada_em is null order by k.criado_em desc`,
        [TENANT_PADRAO],
      );
    } catch (e: any) {
      this.logger.warn(`listar falhou (migration 002 aplicada?): ${e?.message ?? e}`);
      return [];
    }
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      prefixo: r.prefixo,
      escopos: r.escopos ?? [],
      criadoEm: r.criado_em,
      ultimoUso: r.ultimo_uso,
      loja: r.loja_merchant ? { merchantId: r.loja_merchant, nome: r.loja_nome ?? 'loja' } : null,
    }));
  }

  async revogar(id: string): Promise<boolean> {
    if (!this.store.temBanco) return false;
    await this.store.query(`update api_key set revogada_em = now() where id = $1`, [id]);
    return true;
  }
}
