/**
 * Para onde ir depois de entrar: o `?proximo=` que o portão (middleware) pôs, só se for um endereço INTERNO do app
 * (começa com uma barra só, sem esquema nem host). Qualquer outra coisa cai no padrão — nunca um redirecionamento
 * aberto para fora do Orzuni.
 */
export function proximoInterno(valor: string | null | undefined, padrao = '/vigia'): string {
  const v = String(valor ?? '').trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return padrao;
  if (/[\u0000-\u001f]/.test(v)) return padrao;
  try {
    const u = new URL(v, 'https://app.orzuni.local');
    if (u.origin !== 'https://app.orzuni.local') return padrao;
    if (u.pathname === '/login' || u.pathname === '/cadastro') return padrao;
    return `${u.pathname}${u.search}`;
  } catch {
    return padrao;
  }
}
