import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Autenticação da API aberta (ERP/CRM). Bearer da chave do Orzuni.
 * Valida contra ORZUNI_API_KEYS (lista separada por vírgula no .env).
 *
 * SEGURANÇA:
 * - FAIL-CLOSED em produção: se não houver chave configurada, NEGA tudo (nunca
 *   libera a API por env faltando). Só libera sem chave em dev (NODE_ENV != production).
 * - Comparação em tempo constante (timingSafeEqual) — sem vazar o tamanho/prefixo
 *   da chave por timing.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger('auth');

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const chaves = (process.env.ORZUNI_API_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

    if (chaves.length === 0) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('ORZUNI_API_KEYS vazio em produção — negando acesso');
        throw new UnauthorizedException('API não configurada');
      }
      this.logger.warn('ORZUNI_API_KEYS vazio — API liberada (SÓ DEV)');
      return true;
    }

    const auth: string = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !chaves.some((k) => this.igual(k, token))) {
      throw new UnauthorizedException('chave de API inválida');
    }
    return true;
  }

  /** Comparação em tempo constante (evita timing attack na chave). */
  private igual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
