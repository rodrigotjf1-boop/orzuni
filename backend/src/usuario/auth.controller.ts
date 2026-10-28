import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { UsuarioService } from './usuario.service';
import { assinarSessao, verificarSessao } from './sessao';

/**
 * Contas de usuário (revenda). Público — cadastro e login não exigem sessão.
 * Base: /v1/auth. Emite um token de sessão (JWT HS256); a F3 guarda no cookie
 * httpOnly pelo app. Nesta fase, /me lê o Bearer (sem cookie-parser ainda).
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly usuarios: UsuarioService) {}

  @Post('cadastro')
  async cadastro(@Body() body: { email: string; senha: string }) {
    const r = await this.usuarios.cadastrar(body?.email, body?.senha);
    if (!r.ok) return { ok: false, erro: r.erro };
    // auto-login após o cadastro (sem verificação de e-mail nesta fase)
    const u = await this.usuarios.autenticar(body.email, body.senha);
    return u ? { ok: true, token: assinarSessao({ sub: u.id, tenant: u.tenant, email: u.email }) } : { ok: true };
  }

  @Post('login')
  async login(@Body() body: { email: string; senha: string }) {
    const u = await this.usuarios.autenticar(body?.email, body?.senha);
    if (!u) return { ok: false, erro: 'e-mail ou senha inválidos' };
    return { ok: true, token: assinarSessao({ sub: u.id, tenant: u.tenant, email: u.email }) };
  }

  @Get('me')
  async me(@Req() req: any) {
    const bearer: string = (req.headers['authorization'] ?? '').startsWith('Bearer ')
      ? req.headers['authorization'].slice(7)
      : '';
    const s = bearer ? verificarSessao(bearer) : null;
    return s ? { ok: true, email: s.email } : { ok: false };
  }
}
