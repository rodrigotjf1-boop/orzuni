import { NextRequest } from 'next/server';

/**
 * Proxy server-side para o orzuni-api. O navegador chama /api/orzuni/v1/...
 * e este handler injeta o Bearer da chave (que fica SÓ no servidor) e encaminha.
 * Assim a ORZUNI_API_KEY nunca vai para o cliente.
 */
export const dynamic = 'force-dynamic';

const BASE = process.env.ORZUNI_API_BASE ?? 'https://api.orzuni.com';
const KEY = process.env.ORZUNI_API_KEY ?? '';

async function forward(req: NextRequest, path: string[]) {
  // valida a sessão (o valor do cookie, não só a presença) — barra cookie forjado
  const token = process.env.ORZUNI_SESSION_TOKEN ?? '';
  const sess = req.cookies.get('orz_session')?.value ?? '';
  if (!token || sess !== token) {
    return new Response(JSON.stringify({ error: 'não autenticado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const url = new URL(req.url);
  const alvo = `${BASE}/${path.join('/')}${url.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(req.headers.get('content-type') ? { 'Content-Type': req.headers.get('content-type')! } : {}),
    },
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.text();

  const res = await fetch(alvo, init);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx.params.path);
}
export async function PATCH(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx.params.path);
}
export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx.params.path);
}
