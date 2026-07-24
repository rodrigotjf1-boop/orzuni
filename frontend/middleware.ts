import { NextRequest, NextResponse } from 'next/server';

/**
 * Portão de autenticação. Sem sessão:
 *  - páginas → redireciona para /login
 *  - /api/orzuni/* → 401 (não vaza dados nem deixa agir sobre a loja)
 *
 * Aqui só checamos a PRESENÇA do cookie (roda no Edge, sem env). A validação do
 * VALOR do cookie (o token secreto) é feita no proxy, no runtime Node — defesa em
 * profundidade: um cookie forjado passa aqui mas é barrado no proxy.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.has('orz_session')) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/orzuni')) {
    return NextResponse.json({ error: 'não autenticado' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  // roda em tudo, menos login, a rota de auth e os estáticos
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
