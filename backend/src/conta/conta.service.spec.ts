/**
 * Admin de lojas (conta_ifood): `adicionar()` recusa um merchant já conectado em outro
 * tenant (foi o que criou a duplicata do piloto), e `remover()` revoga pelo ID da linha,
 * nunca por merchant_id (que derrubaria a loja do piloto e a ligação do Regem). Store
 * mockado — sem banco de verdade.
 */
import { ContaService } from './conta.service';

const TENANT_PADRAO = '00000000-0000-0000-0000-000000000001';

function comStore(donoDoMerchant: string | null) {
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (String(sql).includes('select tenant_id from conta_ifood where merchant_id')) {
      return donoDoMerchant ? [{ tenant_id: donoDoMerchant }] : [];
    }
    return [];
  });
  const svc = new ContaService({} as never, { temBanco: true, query } as never);
  return { svc, query };
}

function comStoreEmail(opts: { usuarioTenant: string | null; donoDoMerchant: string | null }) {
  const query = jest.fn(async (sql: string) => {
    if (String(sql).includes('from usuario where lower(email)')) return opts.usuarioTenant ? [{ tenant_id: opts.usuarioTenant }] : [];
    if (String(sql).includes('select tenant_id from conta_ifood where merchant_id')) return opts.donoDoMerchant ? [{ tenant_id: opts.donoDoMerchant }] : [];
    return [];
  });
  const svc = new ContaService({} as never, { temBanco: true, query } as never);
  return { svc, query };
}

const insertFeito = (query: jest.Mock) => query.mock.calls.some((c) => String(c[0]).includes('insert into conta_ifood'));
const insertTenant = (query: jest.Mock) => query.mock.calls.find((c) => String(c[0]).includes('insert into conta_ifood'))?.[1]?.[0];

describe('ContaService.adicionar (admin) — recusa duplicata em outro tenant', () => {
  it('recusa um merchant já conectado em OUTRO tenant, sem inserir', async () => {
    const { svc, query } = comStore('tenant-do-piloto');
    const r = await svc.adicionar('m1', 'Loja', false);
    expect(r).toMatchObject({ ok: false });
    expect(r.erro).toMatch(/outra conta/);
    expect(insertFeito(query)).toBe(false);
  });

  it('insere quando o merchant está livre (sem dono)', async () => {
    const { svc, query } = comStore(null);
    expect(await svc.adicionar('m2', 'Nova', false)).toEqual({ ok: true });
    const insert = query.mock.calls.find((c) => String(c[0]).includes('insert into conta_ifood'));
    expect(insert?.[1]).toEqual([TENANT_PADRAO, 'm2', 'Nova', false]);
  });

  it('permite re-adicionar um merchant que já é do TENANT_PADRAO (ex.: loja de teste)', async () => {
    const { svc, query } = comStore(TENANT_PADRAO);
    expect(await svc.adicionar('m3', 'Kit T2', true)).toEqual({ ok: true });
    expect(insertFeito(query)).toBe(true);
  });
});

describe('ContaService — prova de posse (self-service fechado)', () => {
  it('disponiveisParaTenant devolve vazio (não expõe loja de ninguém)', async () => {
    const { svc } = comStore(null);
    expect(await svc.disponiveisParaTenant('tenant-A')).toEqual([]);
  });

  it('adicionarNoTenant recusa reivindicar loja SEM dono (sem inserir)', async () => {
    const { svc, query } = comStore(null);
    const r = await svc.adicionarNoTenant('tenant-A', 'm1', 'Loja');
    expect(r).toMatchObject({ ok: false });
    expect(r.erro).toMatch(/equipe do Orzuni|suporte/);
    expect(insertFeito(query)).toBe(false);
  });

  it('adicionarNoTenant recusa loja de OUTRO tenant', async () => {
    const { svc, query } = comStore('tenant-B');
    expect((await svc.adicionarNoTenant('tenant-A', 'm1', 'Loja')).ok).toBe(false);
    expect(insertFeito(query)).toBe(false);
  });

  it('adicionarNoTenant permite reconectar a PRÓPRIA loja (dono === tenant)', async () => {
    const { svc, query } = comStore('tenant-A');
    expect(await svc.adicionarNoTenant('tenant-A', 'm1', 'Loja')).toEqual({ ok: true });
    expect(insertFeito(query)).toBe(true);
  });
});

describe('ContaService.conectarLojaParaEmail (admin) — ativar um cliente', () => {
  it('conecta a loja ao tenant do e-mail do cliente', async () => {
    const { svc, query } = comStoreEmail({ usuarioTenant: 'tenant-cliente', donoDoMerchant: null });
    expect(await svc.conectarLojaParaEmail('Cliente@Loja.com', 'm1', 'Burger do Zé')).toEqual({ ok: true });
    expect(insertTenant(query)).toBe('tenant-cliente'); // NÃO o TENANT_PADRAO
  });

  it('e-mail sem conta → recusa, sem inserir', async () => {
    const { svc, query } = comStoreEmail({ usuarioTenant: null, donoDoMerchant: null });
    const r = await svc.conectarLojaParaEmail('ninguem@x.com', 'm1', 'Loja');
    expect(r).toMatchObject({ ok: false });
    expect(r.erro).toMatch(/e-mail/);
    expect(insertFeito(query)).toBe(false);
  });

  it('loja já conectada a OUTRO tenant → recusa', async () => {
    const { svc, query } = comStoreEmail({ usuarioTenant: 'tenant-cliente', donoDoMerchant: 'tenant-outro' });
    expect((await svc.conectarLojaParaEmail('cliente@loja.com', 'm1', 'Loja')).ok).toBe(false);
    expect(insertFeito(query)).toBe(false);
  });

  it('e-mail vazio → recusa', async () => {
    const { svc } = comStoreEmail({ usuarioTenant: 'x', donoDoMerchant: null });
    expect((await svc.conectarLojaParaEmail('  ', 'm1', 'Loja')).ok).toBe(false);
  });
});

describe('ContaService.remover (admin) — pelo id da linha', () => {
  it('revoga pela coluna id, nunca por merchant_id', async () => {
    const { svc, query } = comStore(null);
    expect(await svc.remover('conta-uuid-1')).toBe(true);
    const upd = query.mock.calls.find((c) => String(c[0]).includes("update conta_ifood set status = 'revoked'"));
    expect(upd?.[0]).toMatch(/where id = \$1/);
    expect(upd?.[0]).not.toMatch(/merchant_id/);
    expect(upd?.[1]).toEqual(['conta-uuid-1']);
  });
});
