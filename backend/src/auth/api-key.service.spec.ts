/**
 * Chave `orz_live_` ligada a uma loja só vale com a loja CONECTADA: desconectar a loja
 * (status != 'connected') para a chave na hora. A consulta carrega esse guarda; chave da
 * conta (sem loja) segue valendo. Store mockado.
 */
import { ApiKeyService } from './api-key.service';

function comStore(rows: unknown[]) {
  const query = jest.fn(async (sql: string) => (String(sql).includes('select k.id') ? rows : []));
  const svc = new ApiKeyService({ temBanco: true, query } as never);
  return { svc, query };
}

describe('ApiKeyService.validarTabela — loja desconectada para a chave', () => {
  it('a consulta exige a loja conectada (ou a chave sem loja)', async () => {
    const { svc, query } = comStore([{ id: 'k1', escopos: ['catalogo:ler'], rate_limit: 120, merchant_id: 'm1' }]);
    const r = await svc.validarTabela('orz_live_abc');
    const sel = query.mock.calls.find((c) => String(c[0]).includes('select k.id'));
    expect(sel?.[0]).toMatch(/c\.status = 'connected'/);
    expect(sel?.[0]).toMatch(/k\.conta_id is null/);
    expect(r).toMatchObject({ keyId: 'k1', merchantId: 'm1', escopos: ['catalogo:ler'], rateLimit: 120 });
  });

  it('loja revogada → o SQL não traz a linha → null', async () => {
    const { svc } = comStore([]);
    expect(await svc.validarTabela('orz_live_abc')).toBeNull();
  });

  it('sem banco → null', async () => {
    const svc = new ApiKeyService({ temBanco: false, query: jest.fn() } as never);
    expect(await svc.validarTabela('orz_live_abc')).toBeNull();
  });
});
