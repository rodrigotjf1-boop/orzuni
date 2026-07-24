import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { ApiKeyService } from './api-key.service';

function bearer(req: any): string {
  const auth: string = req.headers['authorization'] ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}
function envKeys(): string[] {
  return (process.env.ORZUNI_API_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
function igual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Autenticação da API aberta. Aceita:
 *  - chave de ADMIN (env ORZUNI_API_KEYS) — usada pelo painel/proxy;
 *  - chave de API (tabela api_key) — usada pelos ERP/CRM.
 * FAIL-CLOSED em produção (sem chave configurada nega tudo). Timing-safe no env.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger('auth');
  constructor(private readonly chaves: ApiKeyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const keys = envKeys();

    if (keys.length === 0) {
      if (process.env.NODE_ENV === 'production') throw new UnauthorizedException('API não configurada');
      this.logger.warn('ORZUNI_API_KEYS vazio — API liberada (SÓ DEV)');
      return true;
    }
    const token = bearer(req);
    if (!token) throw new UnauthorizedException('chave de API inválida');

    if (keys.some((k) => igual(k, token))) {
      req.keyType = 'admin';
      return true;
    }
    const r = await this.chaves.validarTabela(token);
    if (r) {
      req.keyType = 'api';
      req.keyId = r.keyId;
      req.contaMerchant = r.merchantId; // loja ligada à chave (multi-loja)
      return true;
    }
    throw new UnauthorizedException('chave de API inválida');
  }
}

/** Só chave de ADMIN (env). Para gerir chaves — um ERP não cria/revoga chaves. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const keys = envKeys();
    if (keys.length === 0) {
      if (process.env.NODE_ENV === 'production') throw new UnauthorizedException('API não configurada');
      return true;
    }
    const token = bearer(req);
    if (token && keys.some((k) => igual(k, token))) return true;
    throw new UnauthorizedException('requer chave de administrador');
  }
}
