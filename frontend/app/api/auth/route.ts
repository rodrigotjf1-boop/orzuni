import { NextRequest, NextResponse } from 'next/server';

/**
 * Entrar e criar conta. Fala com o orzuni-api (`/v1/auth/login` e `/v1/auth/cadastro`),
 * recebe o token da sessão do usuário (JWT) e o guarda num cookie httpOnly `orz_session`.
 * O cookie é httpOnly+secure → fora do alcance de JS (mitiga XSS). Rate limit por IP
 * contra tentativa em massa. Sair (DELETE) apaga o cookie.
 */
export const dynamic = 'force-dynamic';

const BASE = process.env.ORZUNI_API_BASE ?? 'https://api.orzuni.com';
const DIAS = 7; // a sessão do backend dura 7 dias

// rate limit simples em memória: 8 tentativas / minuto por IP
const tentativas = new Map<string, { n: number; ate: number }>();
function bloqueado(ip: string): boolean {
  const agora = Date.now();
  const t = tentativas.get(ip);
  if (!t || agora > t.ate) {
    tentativas.set(ip, { n: 1, ate: agora + 60_000 });
    return false;
  }
  t.n++;
  return t.n > 8;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (bloqueado(ip)) return NextResponse.json({ ok: false, erro: 'Muitas tentativas. Aguarde um minuto.' }, { status: 429 });

  let modo = 'login';
  let email = '';
  let senha = '';
  try {
    const corpo = await req.json();
    modo = corpo?.modo === 'cadastro' ? 'cadastro' : 'login';
    email = (corpo?.email ?? '').trim();
    senha = corpo?.senha ?? '';
  } catch {
    return NextResponse.json({ ok: false, erro: 'dados inválidos' }, { status: 400 });
  }
  if (!email || !senha) return NextResponse.json({ ok: false, erro: 'informe e-mail e senha' }, { status: 400 });

  let dados: { ok?: boolean; token?: string; erro?: string };
  try {
    const r = await fetch(`${BASE}/v1/auth/${modo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    dados = await r.json().catch(() => ({}));
  } catch {
    return NextResponse.json({ ok: false, erro: 'servidor indisponível no momento' }, { status: 502 });
  }

  if (!dados?.ok || !dados.token) {
    return NextResponse.json({ ok: false, erro: dados?.erro || (modo === 'cadastro' ? 'não foi possível criar a conta' : 'e-mail ou senha inválidos') }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('orz_session', dados.token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * DIAS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('orz_session');
  return res;
}
