/**
 * Fase 1 — importação do cardápio do Regem. Dois pontos que o Padrão/segurança
 * exigem e o CI (build) não cobre: o diff por código PDV (a regra do dono) e o
 * guard anti-SSRF do endereço informado pelo usuário. Funções puras — sem rede.
 */
import { classificarImportacao } from './importacao-regem.service';
import { urlSyncCatalogoSegura } from '../common/url-publica-segura';
import { cifrar, decifrar } from '../common/cifra';

describe('classificarImportacao — cria só os que faltam, pela regra do dono', () => {
  const existentes = new Set(['A1', 'B2']);

  it('ignora sem preço iFood ou marcado "não está no iFood"; cria só os novos com código', () => {
    const r = classificarImportacao(
      [
        { codigo: 'A1', precoIfood: 10 }, // já existe no iFood → não toca
        { codigo: 'C3', precoIfood: 20 }, // novo → criar
        { codigo: 'D4', precoIfood: null }, // sem preço iFood → ignora
        { codigo: 'E5', precoIfood: 9, noIfood: true }, // não está no iFood → ignora
        { codigo: '', precoIfood: 7 }, // sem código → não dá para ligar
      ],
      existentes,
    );
    expect(r.aCriar.map((p) => p.codigo)).toEqual(['C3']);
    expect(r.jaExistiam).toBe(1);
    expect(r.semPreco).toBe(2); // D4 (null) + E5 (noIfood)
    expect(r.semCodigo).toBe(1);
  });

  it('lista vazia não quebra', () => {
    expect(classificarImportacao(undefined, existentes)).toEqual({ aCriar: [], jaExistiam: 0, semCodigo: 0, semPreco: 0 });
  });
});

describe('urlSyncCatalogoSegura — anti-SSRF', () => {
  it('recusa http, usuário/senha, localhost e IP interno/loopback', async () => {
    await expect(urlSyncCatalogoSegura('http://regem.exemplo.com/')).rejects.toThrow(/https/);
    await expect(urlSyncCatalogoSegura('https://user:pass@regem.exemplo.com/')).rejects.toThrow(/usuário/);
    await expect(urlSyncCatalogoSegura('https://localhost/')).rejects.toThrow(/não permitido/);
    await expect(urlSyncCatalogoSegura('https://127.0.0.1/')).rejects.toThrow(/rede interna/);
    await expect(urlSyncCatalogoSegura('https://10.0.0.5/')).rejects.toThrow(/rede interna/);
    await expect(urlSyncCatalogoSegura('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/rede interna/);
    await expect(urlSyncCatalogoSegura('')).rejects.toThrow(/informe/);
  });

  it('aceita IP público e devolve a URL de /sync/catalogo na mesma origem', async () => {
    await expect(urlSyncCatalogoSegura('https://8.8.8.8/qualquer/coisa?x=1')).resolves.toBe('https://8.8.8.8/sync/catalogo');
  });
});

describe('cifra — ida e volta, formato versionado', () => {
  const ANTES = process.env.ORZUNI_CIFRA_SEGREDO;
  beforeAll(() => {
    process.env.ORZUNI_CIFRA_SEGREDO = 'segredo-de-teste-para-cifra-123456';
  });
  afterAll(() => {
    if (ANTES === undefined) delete process.env.ORZUNI_CIFRA_SEGREDO;
    else process.env.ORZUNI_CIFRA_SEGREDO = ANTES;
  });

  it('cifra e decifra o mesmo texto; o guardado não contém o segredo em claro', () => {
    const token = 'orz_sync_token_secreto_abc';
    const guardado = cifrar(token);
    expect(guardado.startsWith('v1:')).toBe(true);
    expect(guardado).not.toContain(token);
    expect(decifrar(guardado)).toBe(token);
  });
});
