import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verificação do JWT de sessão do usuário (HS256), no lado servidor do app web
 * (o proxy). Espelha `backend/src/usuario/sessao.ts`: o segredo é o MESMO
 * (`ORZUNI_JWT_SECRET`). Serve para o proxy confiar na sessão antes de encaminhar
 * e para ler o e-mail (decidir o acesso às telas de administração).
 */
export interface Sessao {
  sub: string;
  tenant: string;
  email: string;
  exp: number;
}

function segredo(): string {
  return process.env.ORZUNI_JWT_SECRET ?? '';
}

/** Confere a assinatura e a validade; devolve a sessão ou null. */
export function verificarSessao(token: string): Sessao | null {
  const s = segredo();
  if (!s) return null;
  const partes = (token ?? '').split('.');
  if (partes.length !== 3) return null;
  const [h, b, assinatura] = partes;
  const esperada = Buffer.from(createHmac('sha256', s).update(`${h}.${b}`).digest('base64url'));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString()) as Sessao;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Os e-mails com acesso às telas de administração (ORZUNI_ADMIN_EMAILS, separados por vírgula). */
export function ehAdmin(email: string | undefined): boolean {
  const lista = (process.env.ORZUNI_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!lista.length || !email) return false; // fail-closed: sem a lista, nenhuma tela de admin
  return lista.includes(email.trim().toLowerCase());
}
