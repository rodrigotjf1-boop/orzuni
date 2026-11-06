import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { verificarSessao } from '../usuario/sessao';
import { ApiKeyGuard } from './api-key.guard';

function bearer(req: any): string {
  const auth: string = req.headers['authorization'] ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

/** O que os guards põem na requisição para a resolução de loja por tenant. */
export interface RequestComAcesso {
  /** 'sessao' = usuário logado (dono do tenant); 'chave' = API key (ERP/admin). */
  acesso?: 'sessao' | 'chave';
  usuario?: { id: string; tenant: string; email: string };
}

/**
 * Sessão de usuário (JWT HS256 do `sessao.ts`) OBRIGATÓRIA. Põe `req.usuario`
 * (id/tenant/email) e `req.acesso='sessao'`. Para as rotas do app web que são só
 * do dono da conta (ex.: conectar a própria loja). 401 sem sessão válida.
 */
@Injectable()
export class SessaoGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const s = verificarSessao(bearer(req));
    if (!s) throw new UnauthorizedException('sessão inválida ou expirada');
    req.usuario = { id: s.sub, tenant: s.tenant, email: s.email };
    req.acesso = 'sessao';
    return true;
  }
}

/**
 * Acesso à API do catálogo/loja/vigia: aceita SESSÃO de usuário OU chave de API.
 * - Bearer que é um JWT de sessão válido → dono do próprio tenant: `req.acesso=
 *   'sessao'`, acesso total aos PRÓPRIOS dados (pula o `@Requer`; a loja é
 *   resolvida pelo tenant no controller, à prova de IDOR).
 * - Senão → cai no fluxo de chave (`ApiKeyGuard`): admin do env ou chave da
 *   tabela com `@Requer` + teto. Segue IGUAL ao de antes (ERP e console).
 * Uma chave `orz_live_` nunca é um JWT (não tem 3 partes) → nunca colide.
 */
@Injectable()
export class AcessoGuard implements CanActivate {
  constructor(private readonly chave: ApiKeyGuard) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const s = verificarSessao(bearer(req));
    if (s) {
      req.usuario = { id: s.sub, tenant: s.tenant, email: s.email };
      req.acesso = 'sessao';
      return true;
    }
    return this.chave.canActivate(ctx);
  }
}
