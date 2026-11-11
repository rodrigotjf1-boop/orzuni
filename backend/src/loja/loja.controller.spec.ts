/**
 * Isolamento multi-tenant do GET /v1/loja/lojas (a caixa "lojas vinculadas ao app").
 * SESSÃO só pode ver as lojas do PRÓPRIO tenant — nunca `ifood.merchants()` (todas as
 * do app), senão um cadastro novo veria a loja de outra pessoa. Serviços mockados.
 */
import { LojaController } from './loja.controller';

function ctrl(loja: Record<string, jest.Mock>, contas: Record<string, jest.Mock>) {
  return new LojaController(loja as never, contas as never);
}

describe('LojaController.lojas — isolamento por tenant', () => {
  it('sessão: só as lojas do próprio tenant, sem tocar nas do app', async () => {
    const lojaLojas = jest.fn(async () => [{ id: 'outra', nome: 'Loja de Outro', razaoSocial: 'Outro LTDA' }]);
    const ativasDoTenant = jest.fn(async () => [{ id: 'cA', merchantId: 'mA', nome: 'Minha Loja' }]);
    const c = ctrl({ lojas: lojaLojas }, { ativasDoTenant });
    const r = await c.lojas({ acesso: 'sessao', usuario: { tenant: 'tenant-A' } });
    expect(ativasDoTenant).toHaveBeenCalledWith('tenant-A');
    expect(lojaLojas).not.toHaveBeenCalled(); // NÃO vaza as lojas do app
    expect(r.lojas).toEqual([{ id: 'mA', nome: 'Minha Loja', razaoSocial: 'Minha Loja' }]);
  });

  it('sessão sem loja conectada: lista vazia (não vê a loja de ninguém)', async () => {
    const lojaLojas = jest.fn(async () => [{ id: 'da-loja', nome: 'Teste', razaoSocial: 'Teste LTDA' }]);
    const ativasDoTenant = jest.fn(async () => []);
    const c = ctrl({ lojas: lojaLojas }, { ativasDoTenant });
    const r = await c.lojas({ acesso: 'sessao', usuario: { tenant: 'cadastro-novo' } });
    expect(r.lojas).toEqual([]);
    expect(lojaLojas).not.toHaveBeenCalled();
  });

  it('chave ligada a uma loja: só a dela', async () => {
    const lojaLojas = jest.fn(async () => [
      { id: 'mA', nome: 'A', razaoSocial: 'A' },
      { id: 'mB', nome: 'B', razaoSocial: 'B' },
    ]);
    const c = ctrl({ lojas: lojaLojas }, { ativasDoTenant: jest.fn() });
    const r = await c.lojas({ acesso: 'chave', contaMerchant: 'mB' });
    expect(r.lojas).toEqual([{ id: 'mB', nome: 'B', razaoSocial: 'B' }]);
  });

  it('admin (chave sem loja): as lojas do app (contexto de integração)', async () => {
    const lojaLojas = jest.fn(async () => [{ id: 'mA', nome: 'A', razaoSocial: 'A' }]);
    const c = ctrl({ lojas: lojaLojas }, { ativasDoTenant: jest.fn() });
    const r = await c.lojas({ acesso: 'chave' });
    expect(lojaLojas).toHaveBeenCalled();
    expect(r.lojas).toHaveLength(1);
  });
});
