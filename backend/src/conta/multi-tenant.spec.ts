/**
 * Fase 0 — isolamento por tenant. Prova que um usuário logado (sessão) só
 * alcança as lojas do PRÓPRIO tenant: com `?loja=` de outro tenant NÃO recebe a
 * de lá (anti-IDOR); conectar carimba o tenant da sessão; e o caminho de CHAVE
 * (ERP/admin) segue resolvendo como antes. Serviços mockados (como a mcp.porta.spec).
 */
import { Module, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { ApiKeyService } from '../auth/api-key.service';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { ApiKeyRateLimit } from '../auth/api-key.rate-limit';
import { AcessoGuard, SessaoGuard } from '../auth/sessao.guard';
import { CatalogoController } from '../catalogo/catalogo.controller';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ContaService } from './conta.service';
import { MinhasLojasController } from './minhas-lojas.controller';
import { assinarSessao } from '../usuario/sessao';

const ADMIN = 'chave-admin-de-teste';

async function subir() {
  const cardapio = jest.fn(async (merchant: string) => [{ merchant }]);
  const ativasDoTenant = jest.fn(async (tenant: string) =>
    tenant === 'tenant-A'
      ? [{ id: 'cA', merchantId: 'mA', nome: 'Loja A' }]
      : tenant === 'tenant-B'
        ? [{ id: 'cB', merchantId: 'mB', nome: 'Loja B' }]
        : [],
  );
  const ativas = jest.fn(async () => [{ id: 'cADM', merchantId: 'mADMIN', nome: 'adm' }]);
  const adicionarNoTenant = jest.fn(async () => ({ ok: true as const }));
  const disponiveisParaTenant = jest.fn(async () => [{ merchantId: 'mX', nome: 'X' }]);

  @Module({
    controllers: [CatalogoController, MinhasLojasController],
    providers: [
      AcessoGuard,
      SessaoGuard,
      ApiKeyGuard,
      Reflector,
      { provide: ApiKeyService, useValue: { validarTabela: jest.fn(async () => null) } },
      { provide: ApiKeyRateLimit, useValue: { checar: () => ({ ok: true }) } },
      { provide: CatalogoService, useValue: { cardapio } },
      { provide: ContaService, useValue: { ativasDoTenant, ativas, adicionarNoTenant, disponiveisParaTenant } },
    ],
  })
  class ModuloDeTeste {}

  const modulo = await Test.createTestingModule({ imports: [ModuloDeTeste] }).compile();
  const app: INestApplication = modulo.createNestApplication({ logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  const origem = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app, origem, cardapio, ativasDoTenant, ativas, adicionarNoTenant };
}

function sessao(tenant: string): string {
  return assinarSessao({ sub: `u-${tenant}`, tenant, email: `${tenant}@x.com` });
}

async function get(origem: string, caminho: string, token?: string) {
  const r = await fetch(`${origem}${caminho}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

describe('Fase 0 — isolamento por tenant (sessão) e caminho de chave', () => {
  let p: Awaited<ReturnType<typeof subir>>;

  beforeAll(() => {
    process.env.ORZUNI_JWT_SECRET = 'segredo-de-teste';
    process.env.ORZUNI_API_KEYS = ADMIN;
  });
  beforeEach(async () => {
    p = await subir();
  });
  afterEach(async () => {
    await p.app.close();
  });

  it('a sessão do tenant A resolve a loja de A', async () => {
    const r = await get(p.origem, '/v1/cardapio', sessao('tenant-A'));
    expect(r.status).toBe(200);
    expect(p.cardapio).toHaveBeenCalledWith('mA');
  });

  it('a sessão do tenant B resolve a loja de B', async () => {
    const r = await get(p.origem, '/v1/cardapio', sessao('tenant-B'));
    expect(r.status).toBe(200);
    expect(p.cardapio).toHaveBeenCalledWith('mB');
  });

  it('A pedindo ?loja=<loja de B> NÃO recebe a de B (anti-IDOR): resolve vazio, nunca mB', async () => {
    await get(p.origem, '/v1/cardapio?loja=mB', sessao('tenant-A'));
    expect(p.ativasDoTenant).toHaveBeenCalledWith('tenant-A');
    expect(p.cardapio).toHaveBeenCalledWith(''); // não achou no tenant A → vazio
    expect(p.cardapio).not.toHaveBeenCalledWith('mB');
  });

  it('o caminho de CHAVE (admin) resolve pela lista global, como antes', async () => {
    const r = await get(p.origem, '/v1/cardapio', ADMIN);
    expect(r.status).toBe(200);
    expect(p.ativas).toHaveBeenCalled();
    expect(p.cardapio).toHaveBeenCalledWith('mADMIN');
  });

  it('conectar uma loja carimba o tenant da sessão', async () => {
    const r = await fetch(`${p.origem}/v1/minhas-lojas`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sessao('tenant-A')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ merchantId: 'mX', nome: 'Minha loja' }),
    });
    expect(r.status).toBe(201);
    expect(p.adicionarNoTenant).toHaveBeenCalledWith('tenant-A', 'mX', 'Minha loja');
  });

  it('sem sessão, /v1/minhas-lojas recusa (401)', async () => {
    const r = await get(p.origem, '/v1/minhas-lojas');
    expect(r.status).toBe(401);
  });
});
