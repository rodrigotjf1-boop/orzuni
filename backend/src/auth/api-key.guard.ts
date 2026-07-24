import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';

/**
 * Autenticação da API aberta (ERP/CRM). Bearer da chave do Orzuni.
 * Hoje: valida contra ORZUNI_API_KEYS (lista separada por vírgula no .env).
 * Evolução: tabela api_key (hash + escopos + rate-limit por chave).
 *
 * Em DEV, se ORZUNI_API_KEYS estiver vazio, libera com aviso — para testar local
 * sem configurar chave. NUNCA subir para produção sem a env preenchida.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger('auth');

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const chaves = (process.env.ORZUNI_API_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

    if (chaves.length === 0) {
      this.logger.warn('ORZUNI_API_KEYS vazio — API liberada (só DEV)');
      return true;
    }
    const auth: string = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !chaves.includes(token)) throw new UnauthorizedException('chave de API inválida');
    return true;
  }
}
