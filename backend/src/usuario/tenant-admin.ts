/**
 * Qual tenant a sessão usa (piloto).
 *
 * A conta de usuário nasce com um `tenant_id` aleatório (004_usuario.sql), mas a
 * loja do piloto e as chaves `orz_live_` vivem na EMPRESA PADRÃO (`TENANT_PADRAO`).
 * No piloto, o ADMIN da distribuição opera essa empresa padrão — senão
 * `ativasDoTenant(tenant aleatório)` volta vazio e o "/importar" e o "Conectar
 * iFood" não acham a loja. Usuário comum segue com o próprio tenant.
 *
 * É um atalho do piloto (um dono). O multi-tenant de verdade (prova de posse da
 * loja do iFood) é a fase seguinte; até lá o admin adota a empresa padrão.
 */
export const TENANT_PADRAO = '00000000-0000-0000-0000-000000000001';

/** Os e-mails de admin da distribuição (`ORZUNI_ADMIN_EMAILS`, por vírgula/espaço), minúsculos. */
export function adminEmails(): string[] {
  return (process.env.ORZUNI_ADMIN_EMAILS ?? '')
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** O e-mail é de um admin da distribuição? */
export function ehAdminEmail(email: string | undefined | null): boolean {
  const e = (email ?? '').trim().toLowerCase();
  return !!e && adminEmails().includes(e);
}

/** O tenant da sessão: a empresa padrão para o admin, o próprio tenant para o usuário comum. */
export function tenantDaSessao(email: string | undefined | null, tenantDoUsuario: string): string {
  return ehAdminEmail(email) ? TENANT_PADRAO : tenantDoUsuario;
}
