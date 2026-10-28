import { Injectable, Logger } from '@nestjs/common';
import { StoreService } from '../store/store.service';
import { hashSenha, conferirSenha } from './senha';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

@Injectable()
export class UsuarioService {
  private readonly logger = new Logger('usuario');
  constructor(private readonly store: StoreService) {}

  /** Cria uma conta (e-mail + senha). Sem confirmação por e-mail nesta fase. */
  async cadastrar(email: string, senha: string): Promise<{ ok: boolean; erro?: string; userId?: string }> {
    const e = (email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return { ok: false, erro: 'e-mail inválido' };
    if ((senha ?? '').length < 8) return { ok: false, erro: 'a senha precisa de ao menos 8 caracteres' };
    if (!this.store.temBanco) return { ok: false, erro: 'banco indisponível' };
    try {
      const rows = await this.store.query(
        `insert into usuario (email, senha_hash) values ($1, $2) returning id`,
        [e, hashSenha(senha)],
      );
      return { ok: true, userId: rows[0].id };
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (/duplicate|unique|23505/i.test(msg)) return { ok: false, erro: 'já existe uma conta com esse e-mail' };
      this.logger.warn(`cadastrar falhou: ${msg}`);
      return { ok: false, erro: 'não foi possível criar a conta' };
    }
  }

  /** Confere e-mail + senha. Retorna a conta (id, tenant, email) ou null. */
  async autenticar(email: string, senha: string): Promise<{ id: string; tenant: string; email: string } | null> {
    const e = (email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(e) || !senha || !this.store.temBanco) return null;
    try {
      const rows = await this.store.query(
        `select id, tenant_id, email, senha_hash from usuario where lower(email) = $1 limit 1`,
        [e],
      );
      if (!rows.length || !conferirSenha(senha, rows[0].senha_hash)) return null;
      this.store.query(`update usuario set ultimo_login = now() where id = $1`, [rows[0].id]).catch(() => {});
      return { id: rows[0].id, tenant: rows[0].tenant_id, email: rows[0].email };
    } catch (err: any) {
      this.logger.warn(`autenticar falhou: ${err?.message ?? err}`);
      return null;
    }
  }
}
