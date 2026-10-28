import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Sessão da conta como JWT HS256 assinado com node:crypto (sem dependência).
 * O segredo vem de ORZUNI_JWT_SECRET. Em produção é obrigatório (fail-closed);
 * em dev, cai num segredo fixo só-dev com aviso.
 */
export interface Sessao {
  sub: string; // id do usuário
  tenant: string; // tenant da conta
  email: string;
  exp: number; // epoch (segundos)
}

function segredo(): string {
  const s = process.env.ORZUNI_JWT_SECRET ?? '';
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('ORZUNI_JWT_SECRET ausente');
  return 'dev-secret-NAO-usar-em-producao';
}

const b64url = (b: Buffer) => b.toString('base64url');

export function assinarSessao(dados: { sub: string; tenant: string; email: string }, horas = 24 * 7): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const exp = Math.floor(Date.now() / 1000) + horas * 3600;
  const body = b64url(Buffer.from(JSON.stringify({ ...dados, exp })));
  const assinatura = b64url(createHmac('sha256', segredo()).update(`${header}.${body}`).digest());
  return `${header}.${body}.${assinatura}`;
}

export function verificarSessao(token: string): Sessao | null {
  const partes = (token ?? '').split('.');
  if (partes.length !== 3) return null;
  const [h, b, s] = partes;
  const esperada = Buffer.from(b64url(createHmac('sha256', segredo()).update(`${h}.${b}`).digest()));
  const recebida = Buffer.from(s);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString()) as Sessao;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
