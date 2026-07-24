import { NextRequest, NextResponse } from 'next/server';

/**
 * Login/logout. Verifica a senha (ORZUNI_APP_PASSWORD) e emite um cookie de sessão
 * httpOnly com o token secreto (ORZUNI_SESSION_TOKEN). Rate limit agressivo por IP
 * contra brute-force. O cookie é httpOnly+secure → não acessível por JS (mitiga XSS).
 */
export const dynamic = 'force-dynamic';

// rate limit simples em memória: 5 tentativas / minuto por IP
const tentativas = new Map<string, { n: number; ate: number }>();
function bloqueado(ip: string): boolean {
  const agora = Date.now();
  const t = tentativas.get(ip);
  if (!t || agora > t.ate) {
    tentativas.set(ip, { n: 1, ate: agora + 60_000 });
    return false;
  }
  t.n++;
  return t.n > 5;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (bloqueado(ip)) return NextResponse.json({ ok: false, erro: 'muitas tentativas' }, { status: 429 });

  const senhaEnv = process.env.ORZUNI_APP_PASSWORD ?? '';
  const token = process.env.ORZUNI_SESSION_TOKEN ?? '';
  if (!senhaEnv || !token) return NextResponse.json({ ok: false, erro: 'login não configurado' }, { status: 500 });

  let senha = '';
  try {
    senha = (await req.json())?.senha ?? '';
  } catch {
    /* corpo inválido */
  }
  if (senha !== senhaEnv) return NextResponse.json({ ok: false, erro: 'senha inválida' }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set('orz_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8h
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('orz_session');
  return res;
}
