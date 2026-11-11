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

const insertFeito = (query: jest.Mock) => query.mock.calls.some((c) => String(c[0]).includes('insert into conta_ifood'));

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
