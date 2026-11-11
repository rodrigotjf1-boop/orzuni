/**
 * Loja de teste de integração (kit do hub): o controller admin de lojas passa a marca
 * `soIntegracao` só como booleano true, e a lista usa `listarAdmin` (que mostra as de
 * teste). Sem rede/banco — `ContaService` mockado.
 */
import { LojasController } from './lojas.controller';

function comContas(contas: Partial<Record<string, jest.Mock>>) {
  return new LojasController(contas as never);
}

describe('LojasController (admin) — loja de teste de integração', () => {
  it('listar usa listarAdmin (mostra as de teste, com a marca)', async () => {
    const listarAdmin = jest.fn(async () => [
      { id: 'c1', merchantId: 'm1', nome: 'Loja', soIntegracao: false },
      { id: 'c2', merchantId: 'kit-t2', nome: 'Kit T2', soIntegracao: true },
    ]);
    const c = comContas({ listarAdmin });
    const r = await c.listar();
    expect(listarAdmin).toHaveBeenCalled();
    expect(r.lojas.find((l) => l.merchantId === 'kit-t2')).toMatchObject({ soIntegracao: true });
  });

  it('adicionar com soIntegracao=true marca a loja de teste', async () => {
    const adicionar = jest.fn(async () => true);
    const c = comContas({ adicionar });
    await c.adicionar({ merchantId: 'kit-t2', nome: 'Kit T2', soIntegracao: true });
    expect(adicionar).toHaveBeenCalledWith('kit-t2', 'Kit T2', true);
  });

  it('adicionar sem a marca cria loja normal (false)', async () => {
    const adicionar = jest.fn(async () => true);
    const c = comContas({ adicionar });
    await c.adicionar({ merchantId: 'm2', nome: 'Real' });
    expect(adicionar).toHaveBeenCalledWith('m2', 'Real', false);
  });

  it('soIntegracao só marca com o booleano true (string "true" não marca)', async () => {
    const adicionar = jest.fn(async () => true);
    const c = comContas({ adicionar });
    await c.adicionar({ merchantId: 'm3', nome: 'X', soIntegracao: 'true' as never });
    expect(adicionar).toHaveBeenCalledWith('m3', 'X', false);
  });

  it('com e-mail → conecta à conta do cliente (não ao TENANT_PADRAO)', async () => {
    const adicionar = jest.fn(async () => ({ ok: true }));
    const conectarLojaParaEmail = jest.fn(async () => ({ ok: true }));
    const c = comContas({ adicionar, conectarLojaParaEmail });
    await c.adicionar({ merchantId: 'm4', nome: 'Loja do cliente', email: 'cliente@loja.com' });
    expect(conectarLojaParaEmail).toHaveBeenCalledWith('cliente@loja.com', 'm4', 'Loja do cliente');
    expect(adicionar).not.toHaveBeenCalled();
  });

  it('e-mail em branco cai no caminho normal (TENANT_PADRAO)', async () => {
    const adicionar = jest.fn(async () => ({ ok: true }));
    const conectarLojaParaEmail = jest.fn(async () => ({ ok: true }));
    const c = comContas({ adicionar, conectarLojaParaEmail });
    await c.adicionar({ merchantId: 'm5', nome: 'Teste', email: '  ' });
    expect(conectarLojaParaEmail).not.toHaveBeenCalled();
    expect(adicionar).toHaveBeenCalledWith('m5', 'Teste', false);
  });
});
