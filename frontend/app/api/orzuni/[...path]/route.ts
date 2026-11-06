import { NextRequest } from 'next/server';
import { verificarSessao, ehAdmin } from '@/lib/sessao';

/**
 * Proxy server-side para o orzuni-api. O navegador chama /api/orzuni/v1/... e este
 * handler decide a credencial que vai ao backend:
 *  - telas de dados (cardápio, loja, vigia, minhas-lojas): encaminha o JWT de SESSÃO
 *    do usuário (cookie `orz_session`) → o backend mostra só a loja do tenant dele;
 *  - telas de ADMINISTRAÇÃO (chaves de API, lojas, diagnóstico): injeta a chave de
 *    administrador (ORZUNI_API_KEY, só no servidor), e SÓ se o usuário estiver na
 *    lista de administradores (ORZUNI_ADMIN_EMAILS). Assim a chave nunca vai ao
 *    cliente e um usuário comum não alcança a administração.
 */
export const dynamic = 'force-dynamic';

const BASE = process.env.ORZUNI_API_BASE ?? 'https://api.orzuni.com';
const KEY = process.env.ORZUNI_API_KEY ?? '';

// caminhos de administração (precisam da chave admin, não da sessão do usuário)
const RECURSOS_ADMIN = new Set(['chaves', 'lojas', 'telemetria']);
function ehCaminhoAdmin(path: string[]): boolean {
  // path = ['v1', '<recurso>', ...]
  return path[0] === 'v1' && RECURSOS_ADMIN.has(path[1] ?? '');
}

function json(status: number, erro: string): Response {
  return new Response(JSON.stringify({ error: erro }), { status, headers: { 'Content-Type': 'application/json' } });
}

async function forward(req: NextRequest, path: string[]) {
  const jwt = req.cookies.get('orz_session')?.value ?? '';
  const sessao = verificarSessao(jwt);
  if (!sessao) return json(401, 'não autenticado');

  let autorizacao: string;
  if (ehCaminhoAdmin(path)) {
    if (!ehAdmin(sessao.email)) return json(403, 'sem acesso à administração');
    if (!KEY) return json(500, 'administração não configurada');
    autorizacao = `Bearer ${KEY}`; // chave de admin (só no servidor)
  } else {
    autorizacao = `Bearer ${jwt}`; // sessão do usuário → backend resolve a loja pelo tenant
  }

  const url = new URL(req.url);
  const alvo = `${BASE}/${path.join('/')}${url.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: autorizacao,
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
export async function PUT(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx.params.path);
}
export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) {
  return forward(req, ctx.params.path);
}
