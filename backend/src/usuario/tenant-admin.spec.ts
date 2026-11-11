/**
 * O admin da distribuição opera a empresa padrão (onde estão a loja do piloto e as
 * chaves orz_live_); o usuário comum usa o próprio tenant. Sem isso, a sessão do
 * dono (tenant aleatório da mig 004) não enxergaria a loja. Função pura.
 */
import { ehAdminEmail, tenantDaSessao, TENANT_PADRAO } from './tenant-admin';

describe('tenantDaSessao — admin usa a empresa padrão', () => {
  const ANTES = process.env.ORZUNI_ADMIN_EMAILS;
  afterEach(() => {
    if (ANTES === undefined) delete process.env.ORZUNI_ADMIN_EMAILS;
    else process.env.ORZUNI_ADMIN_EMAILS = ANTES;
  });

  it('e-mail admin → TENANT_PADRAO; usuário comum → o próprio tenant', () => {
    process.env.ORZUNI_ADMIN_EMAILS = 'dono@loja.com, outro@loja.com';
    expect(tenantDaSessao('dono@loja.com', 'tenant-aleatorio')).toBe(TENANT_PADRAO);
    expect(tenantDaSessao('cliente@loja.com', 'tenant-cliente')).toBe('tenant-cliente');
  });

  it('a comparação ignora caixa e espaços', () => {
    process.env.ORZUNI_ADMIN_EMAILS = 'Dono@Loja.com';
    expect(ehAdminEmail('  DONO@loja.COM ')).toBe(true);
    expect(tenantDaSessao('dono@loja.com', 't')).toBe(TENANT_PADRAO);
  });

  it('sem ORZUNI_ADMIN_EMAILS, ninguém é admin (cada um no seu tenant)', () => {
    delete process.env.ORZUNI_ADMIN_EMAILS;
    expect(ehAdminEmail('dono@loja.com')).toBe(false);
    expect(tenantDaSessao('dono@loja.com', 'tenant-x')).toBe('tenant-x');
  });

  it('e-mail vazio nunca é admin', () => {
    process.env.ORZUNI_ADMIN_EMAILS = 'dono@loja.com';
    expect(ehAdminEmail('')).toBe(false);
    expect(ehAdminEmail(undefined)).toBe(false);
  });
});
