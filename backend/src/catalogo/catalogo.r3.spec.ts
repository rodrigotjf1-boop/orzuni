/**
 * R3 (Gestão do catálogo do Regem) na porta MCP: nome/descrição do item, troca de
 * código de PDV e nome da opção. Os métodos internos (detalhe/editar/resolver/mapaGrupos)
 * são espionados; o cliente iFood (updateProduct) é mockado. Sem rede.
 */
import { CatalogoService } from './catalogo.service';

function svc(ifood: Partial<Record<string, jest.Mock>> = {}) {
  return new CatalogoService(ifood as never);
}

describe('definirNomeDescricaoItem', () => {
  it('aplica nome e descrição e devolve os campos (antes → depois)', async () => {
    const c = svc();
    jest.spyOn(c as never as { detalhe: jest.Mock }, 'detalhe').mockResolvedValue({ nome: 'X-Burger', descricao: 'antigo' });
    const editar = jest.spyOn(c as never as { editar: jest.Mock }, 'editar').mockResolvedValue({ ok: true, erros: [] });
    const r = await c.definirNomeDescricaoItem('m', '2051', { nome: 'X-Bacon', descricao: 'novo' });
    expect(r.situacao).toBe('aplicado');
    expect((r.dados as { campos: unknown }).campos).toEqual([
      { campo: 'nome', antes: 'X-Burger', depois: 'X-Bacon' },
      { campo: 'descricao', antes: 'antigo', depois: 'novo' },
    ]);
    expect(editar).toHaveBeenCalledWith('m', '2051', { nome: 'X-Bacon', descricao: 'novo' });
  });

  it('sem mudança quando os valores são iguais (não chama o iFood)', async () => {
    const c = svc();
    jest.spyOn(c as never as { detalhe: jest.Mock }, 'detalhe').mockResolvedValue({ nome: 'X', descricao: 'd' });
    const editar = jest.spyOn(c as never as { editar: jest.Mock }, 'editar').mockResolvedValue({ ok: true, erros: [] });
    const r = await c.definirNomeDescricaoItem('m', '1', { nome: 'X', descricao: 'd' });
    expect(r.situacao).toBe('sem_mudanca');
    expect(editar).not.toHaveBeenCalled();
  });

  it('recusa nome > 100 com o limite na frase, antes de tocar no iFood', async () => {
    const c = svc();
    const detalhe = jest.spyOn(c as never as { detalhe: jest.Mock }, 'detalhe');
    const r = await c.definirNomeDescricaoItem('m', '1', { nome: 'a'.repeat(101) });
    expect(r).toMatchObject({ situacao: 'recusado', codigo: 'dados_invalidos' });
    expect(r.erro).toMatch(/100/);
    expect(detalhe).not.toHaveBeenCalled();
  });

  it('recusa descrição > 500', async () => {
    const r = await svc().definirNomeDescricaoItem('m', '1', { descricao: 'a'.repeat(501) });
    expect(r).toMatchObject({ codigo: 'dados_invalidos' });
    expect(r.erro).toMatch(/500/);
  });

  it('exige ao menos um campo', async () => {
    const r = await svc().definirNomeDescricaoItem('m', '1', {});
    expect(r).toMatchObject({ codigo: 'dados_invalidos' });
  });

  it('item inexistente → pdv_inexistente', async () => {
    const c = svc();
    jest.spyOn(c as never as { detalhe: jest.Mock }, 'detalhe').mockResolvedValue(null);
    const r = await c.definirNomeDescricaoItem('m', 'zzz', { nome: 'N' });
    expect(r).toMatchObject({ situacao: 'nao_encontrado', codigo: 'pdv_inexistente' });
  });
});

describe('definirCodigoPdvItem', () => {
  it('recusa quando o novo código já existe', async () => {
    const c = svc();
    jest.spyOn(c as never as { resolver: jest.Mock }, 'resolver').mockResolvedValue({ itemId: 'i' });
    const editar = jest.spyOn(c as never as { editar: jest.Mock }, 'editar');
    const r = await c.definirCodigoPdvItem('m', '2051', '2052');
    expect(r).toMatchObject({ situacao: 'recusado', codigo: 'codigo_ja_existe' });
    expect(editar).not.toHaveBeenCalled();
  });

  it('aplica a troca (de → para)', async () => {
    const c = svc();
    const resolver = jest.spyOn(c as never as { resolver: jest.Mock }, 'resolver');
    resolver.mockResolvedValueOnce(null).mockResolvedValueOnce({ itemId: 'i' });
    jest.spyOn(c as never as { editar: jest.Mock }, 'editar').mockResolvedValue({ ok: true, erros: [], pdv: '9001' });
    const r = await c.definirCodigoPdvItem('m', '2051', '9001');
    expect(r.situacao).toBe('aplicado');
    expect(r.dados).toEqual({ de: '2051', para: '9001' });
  });

  it('sem mudança se o novo é igual ao atual', async () => {
    expect((await svc().definirCodigoPdvItem('m', '2051', '2051')).situacao).toBe('sem_mudanca');
  });
});

describe('definirFotoItem', () => {
  it('troca a foto (data-URI) e devolve dados.foto', async () => {
    const c = svc();
    jest.spyOn(c as never as { resolver: jest.Mock }, 'resolver').mockResolvedValue({ itemId: 'i' });
    const editar = jest.spyOn(c as never as { editar: jest.Mock }, 'editar').mockResolvedValue({ ok: true, erros: [] });
    const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const r = await c.definirFotoItem('m', '2051', img);
    expect(r).toMatchObject({ situacao: 'aplicado' });
    expect(r.dados).toEqual({ foto: true });
    expect(editar).toHaveBeenCalledWith('m', '2051', { imagem: img });
  });

  it('recusa imagem que não é data-URI jpg/png (sem tocar no iFood)', async () => {
    const c = svc();
    const resolver = jest.spyOn(c as never as { resolver: jest.Mock }, 'resolver');
    const r = await c.definirFotoItem('m', '1', 'https://x.com/foto.jpg');
    expect(r).toMatchObject({ situacao: 'recusado', codigo: 'dados_invalidos' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('item inexistente → pdv_inexistente', async () => {
    const c = svc();
    jest.spyOn(c as never as { resolver: jest.Mock }, 'resolver').mockResolvedValue(null);
    const r = await c.definirFotoItem('m', 'zzz', 'data:image/png;base64,AAAA');
    expect(r).toMatchObject({ situacao: 'nao_encontrado', codigo: 'pdv_inexistente' });
  });
});

describe('definirNomeComplementoPorPdv', () => {
  it('renomeia TODAS as opções com o código (updateProduct) e consolida', async () => {
    const updateProduct = jest.fn(async () => true);
    const c = svc({ updateProduct });
    jest.spyOn(c as never as { mapaGrupos: jest.Mock }, 'mapaGrupos').mockResolvedValue(
      new Map<string, unknown>([
        ['g1', { id: 'g1', nome: 'Adicionais', opcoes: [{ id: 'o1', productId: 'p1', nome: 'Bacon', pdv: '900' }] }],
        ['g2', { id: 'g2', nome: 'Extras', opcoes: [{ id: 'o2', productId: 'p2', nome: 'Bacon', pdv: '900' }] }],
      ]),
    );
    const r = await c.definirNomeComplementoPorPdv('m', '900', 'Bacon artesanal');
    expect(r.situacao).toBe('aplicado');
    expect(r.opcoes).toHaveLength(2);
    expect(updateProduct).toHaveBeenCalledWith('m', 'p1', { name: 'Bacon artesanal' });
    expect(updateProduct).toHaveBeenCalledWith('m', 'p2', { name: 'Bacon artesanal' });
  });

  it('código inexistente → pdv_inexistente', async () => {
    const c = svc({ updateProduct: jest.fn() });
    jest.spyOn(c as never as { mapaGrupos: jest.Mock }, 'mapaGrupos').mockResolvedValue(new Map());
    const r = await c.definirNomeComplementoPorPdv('m', '999', 'Novo');
    expect(r).toMatchObject({ situacao: 'nao_encontrado', codigo: 'pdv_inexistente' });
  });

  it('nome > 100 recusa', async () => {
    const r = await svc({ updateProduct: jest.fn() }).definirNomeComplementoPorPdv('m', '900', 'a'.repeat(101));
    expect(r).toMatchObject({ codigo: 'dados_invalidos' });
  });
});
