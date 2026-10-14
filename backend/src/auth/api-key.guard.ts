import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import { ApiKeyService } from './api-key.service';
import { ApiKeyRateLimit } from './api-key.rate-limit';
import { ESCOPO_KEY } from './requer.decorator';

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
  constructor(
    private readonly chaves: ApiKeyService,
    private readonly reflector: Reflector,
    private readonly limite: ApiKeyRateLimit,
  ) {}

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

    // chave de ADMIN (env): acesso total — ignora escopo e teto por chave (é o painel/proxy).
    if (keys.some((k) => igual(k, token))) {
      req.keyType = 'admin';
      return true;
    }

    const r = await this.chaves.validarTabela(token);
    if (!r) throw new UnauthorizedException('chave de API inválida');
    req.keyType = 'api';
    req.keyId = r.keyId;
    req.contaMerchant = r.merchantId; // loja ligada à chave (multi-loja)
    req.keyScopes = r.escopos;

    // permissão: a rota declara o que exige (@Requer). A chave precisa ter TODOS.
    const exigidos = this.reflector.getAllAndOverride<string[]>(ESCOPO_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const faltando = exigidos.filter((e) => !r.escopos.includes(e));
    if (faltando.length) {
      throw new ForbiddenException(`a chave não tem permissão para esta ação (falta: ${faltando.join(', ')})`);
    }

    // teto por chave (429 + Retry-After).
    const lim = this.limite.checar(r.keyId, r.rateLimit);
    if (!lim.ok) {
      const res = ctx.switchToHttp().getResponse();
      res.setHeader?.('Retry-After', String(lim.retryAfter));
      throw new HttpException('limite de requisições da chave excedido', 429);
    }
    return true;
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
