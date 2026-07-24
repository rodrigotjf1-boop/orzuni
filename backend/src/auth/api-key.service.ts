import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { StoreService } from '../store/store.service';

const TENANT_PADRAO = '00000000-0000-0000-0000-000000000001';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ChaveInfo {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  criadoEm: string;
  ultimoUso: string | null;
}

/**
 * Chaves de API para o ERP/CRM (tabela api_key). Guarda só o HASH do segredo;
 * o valor em claro aparece uma única vez, na criação. Formato: orz_live_<hex>.
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger('api-key');
  constructor(private readonly store: StoreService) {}

  /** Valida uma chave de tabela (hash). Retorna o id da chave ou null. */
  async validarTabela(token: string): Promise<string | null> {
    if (!this.store.temBanco) return null;
    try {
      const rows = await this.store.query(
        `select id from api_key where hash = $1 and revogada_em is null limit 1`,
        [sha256(token)],
      );
      const id = rows[0]?.id ?? null;
      if (id) this.store.query(`update api_key set ultimo_uso = now() where id = $1`, [id]).catch(() => {});
      return id;
    } catch (e: any) {
      this.logger.warn(`validarTabela falhou: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Cria uma chave. Retorna o segredo COMPLETO (mostrar uma vez) + o prefixo. */
  async criar(nome: string, escopos: string[]): Promise<{ chave: string; prefixo: string } | null> {
    if (!this.store.temBanco) return null;
    const chave = 'orz_live_' + randomBytes(24).toString('hex');
    const prefixo = chave.slice(0, 16);
    await this.store.query(
      `insert into api_key (tenant_id, nome, prefixo, hash, escopos) values ($1,$2,$3,$4,$5)`,
      [TENANT_PADRAO, nome, prefixo, sha256(chave), escopos.length ? escopos : ['catalogo:ler']],
    );
    return { chave, prefixo };
  }

  async listar(): Promise<ChaveInfo[]> {
    if (!this.store.temBanco) return [];
    const rows = await this.store.query(
      `select id, nome, prefixo, escopos, criado_em, ultimo_uso
       from api_key where tenant_id = $1 and revogada_em is null order by criado_em desc`,
      [TENANT_PADRAO],
    );
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      prefixo: r.prefixo,
      escopos: r.escopos ?? [],
      criadoEm: r.criado_em,
      ultimoUso: r.ultimo_uso,
    }));
  }

  async revogar(id: string): Promise<boolean> {
    if (!this.store.temBanco) return false;
    await this.store.query(`update api_key set revogada_em = now() where id = $1`, [id]);
    return true;
  }
}
