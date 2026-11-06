/**
 * O que o kit do hub NÃO confere na porta MCP, e o Padrão exige (teste próprio):
 * a idempotência pelo `chaveIdempotencia`, o isolamento entre lojas e o
 * `tools/list` mostrar só o que a credencial pode usar.
 */
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ErroProblema, gerarChave } from '../dms/integracao-dms';
import { CatalogoService } from '../catalogo/catalogo.service';
import { LojaService } from '../loja/loja.service';
import { StoreService } from '../store/store.service';
import { porta } from './config';
import { DmsIdController } from './dms-id.controller';
import { DmsIdService } from './dms-id.service';
import { IntegracaoGuard } from './integracao.guard';
import { LigacaoService, type IntegracaoAutenticada } from './ligacao.service';
import { LIGACAO_INVALIDA, ligacaoVale, permissoesDaLigacao, ROTAS_FORA_DO_PREFIXO } from './ligacao.regras';
import { ManifestoController } from './manifesto.controller';
import { PORTA_MCP } from './manifesto';
import { McpController } from './mcp.controller';
import { McpServidor } from './mcp.servidor';
import { ProblemaFilter } from './problema.filter';

const APP_A = 'aplicativo-regem-de-teste';

type DmsIdFalso = { servidor: Server; emissor: string; emitir(o?: { scope?: string }): string };

async function subirDmsIdFalso(): Promise<DmsIdFalso> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const kid = 'chave-de-teste';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'ES384' };
  const servidor = createServer((req, res) => {
    if (req.url !== '/oidc/jwks') {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const emissor = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/oidc`;
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return {
    servidor,
    emissor,
    emitir(o = {}) {
      const agora = Math.floor(Date.now() / 1000);
      const cabeca = b64({ alg: 'ES384', typ: 'at+jwt', kid });
      const corpo = b64({ iss: emissor, aud: porta.recurso, sub: APP_A, client_id: APP_A, scope: o.scope ?? 'catalogo.ler loja.ler preco.escrever', iat: agora, exp: agora + 3600, jti: randomUUID() });
      return `${cabeca}.${corpo}.${sign('sha384', Buffer.from(`${cabeca}.${corpo}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    },
  };
}

type LigacaoGuardada = { id: string; aplicativo: string; classe: string; escopos: string[]; revogadaEm: Date | null; merchantId: string };

async function subirPorta() {
  const ligacoes = new Map<string, LigacaoGuardada>();
  let n = 0;
  const definirPrecoItem = jest.fn(async () => ({ situacao: 'aplicado' as const, antes: 19.9, depois: 29.9 }));
  const definirPrecoComplementoPorPdv = jest.fn(async () => ({
    situacao: 'aplicado' as const,
    opcoes: [
      { grupo: 'Adicionais', optionId: 'o1', antes: 2, depois: 3, situacao: 'aplicado' as const },
      { grupo: 'Extras', optionId: 'o2', antes: 3, depois: 3, situacao: 'sem_mudanca' as const },
    ],
  }));
  const cardapio = jest.fn(async (merchant: string) => [{ merchant }]);
  const autenticarLigacao = jest.fn(async (segredo: string | null, doToken: { aplicativo: string; permissoes: string[] }, aplicativos: Record<string, string>): Promise<IntegracaoAutenticada> => {
    const g = segredo ? ligacoes.get(segredo) : undefined;
    const l = g ? { aplicativo: g.aplicativo, classe: g.classe, escopos: g.escopos, revogadaEm: g.revogadaEm } : undefined;
    if (!ligacaoVale(l, doToken.aplicativo, aplicativos)) throw new ErroProblema('ligacao-invalida', LIGACAO_INVALIDA);
    return {
      ligacaoId: g!.id,
      tenantId: 't',
      contaId: 'c',
      merchantId: g!.merchantId,
      aplicativo: g!.aplicativo,
      produto: 'regem',
      classe: g!.classe,
      nome: 'regem',
      escopos: permissoesDaLigacao(l!, doToken.permissoes),
    };
  });

  @Module({
    controllers: [McpController, DmsIdController, ManifestoController],
    providers: [
      McpServidor,
      IntegracaoGuard,
      DmsIdService,
      { provide: LigacaoService, useValue: { autenticarLigacao, trocarPorLigacao: jest.fn(), revogarPeloProprio: jest.fn() } },
      {
        provide: CatalogoService,
        useValue: {
          cardapio,
          categorias: jest.fn(async () => []),
          detalhe: jest.fn(async () => ({})),
          complementos: jest.fn(async () => []),
          definirPrecoItem,
          definirStatusItem: jest.fn(async () => ({ situacao: 'aplicado' })),
          definirStatusOpcao: jest.fn(async () => ({ situacao: 'aplicado' })),
          definirPrecoComplementoPorPdv,
          definirStatusComplementoPorPdv: jest.fn(async () => ({ situacao: 'aplicado', opcoes: [] })),
          reprecificar: jest.fn(async () => ({ batchId: 'b', ignorados: [] })),
        },
      },
      { provide: LojaService, useValue: { painel: jest.fn(async () => ({})), horarios: jest.fn(async () => ({})), criarInterrupcao: jest.fn(async () => ({})) } },
      { provide: StoreService, useValue: { listarAlertas: jest.fn(async () => []) } },
    ],
  })
  class PortaDeTeste {}

  const modulo = await Test.createTestingModule({ imports: [PortaDeTeste] }).compile();
  const app: INestApplication = modulo.createNestApplication({ logger: false });
  app.setGlobalPrefix('v1', { exclude: ROTAS_FORA_DO_PREFIXO });
  app.useGlobalFilters(new ProblemaFilter());
  await app.listen(0, '127.0.0.1');
  const origem = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  porta.recurso = `${origem}/v1/mcp`;

  return {
    app,
    origem,
    definirPrecoItem,
    definirPrecoComplementoPorPdv,
    cardapio,
    ligacao(escopos: string[], merchantId: string) {
      const { chave } = gerarChave('lg', 'orzuni');
      ligacoes.set(chave, { id: `lig-${(n += 1)}`, aplicativo: APP_A, classe: 'dms', escopos, revogadaEm: null, merchantId });
      return chave;
    },
  };
}

async function chamar(origem: string, token: string, ligacao: string, metodo: string, nome?: string, args?: Record<string, unknown>) {
  const params: Record<string, unknown> = {
    _meta: { 'io.modelcontextprotocol/protocolVersion': PORTA_MCP.versao, 'io.modelcontextprotocol/clientInfo': { name: 'teste', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} },
  };
  if (nome) Object.assign(params, { name: nome, arguments: args ?? {} });
  const cabecalhos: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-method': metodo, 'mcp-protocol-version': PORTA_MCP.versao, authorization: `Bearer ${token}`, 'DMS-Ligacao': ligacao };
  if (nome) cabecalhos['mcp-name'] = nome;
  const r = await fetch(`${origem}/v1/mcp`, { method: 'POST', headers: cabecalhos, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metodo, params }) });
  const texto = await r.text();
  const tipo = r.headers.get('content-type') ?? '';
  const json = tipo.startsWith('text/event-stream') ? (texto.split(/\r?\n/).filter((l) => l.startsWith('data:')).pop()?.slice(5) ?? '') : texto;
  return { status: r.status, corpo: json ? JSON.parse(json) : null };
}

describe('a porta MCP do Orzuni — idempotência, isolamento e tools/list', () => {
  let dmsId: DmsIdFalso;
  let p: Awaited<ReturnType<typeof subirPorta>>;

  beforeAll(async () => {
    dmsId = await subirDmsIdFalso();
  });
  afterAll(async () => {
    await new Promise((fim) => dmsId.servidor.close(fim));
  });
  beforeEach(async () => {
    Object.assign(porta, { ligado: true, emissor: dmsId.emissor, recurso: '', aplicativos: { regem: APP_A }, aceitaIntegracoes: true });
    p = await subirPorta();
  });
  afterEach(async () => {
    await p.app.close();
  });

  it('tools/list só mostra o que a credencial pode usar', async () => {
    const ligacao = p.ligacao(['catalogo.ler'], 'm1');
    const r = await chamar(p.origem, dmsId.emitir(), ligacao, 'tools/list');
    expect(r.status).toBe(200);
    const nomes = (r.corpo.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(nomes).toEqual(['cardapio_listar', 'categorias_listar', 'complementos_listar', 'integracao_situacao', 'item_ler']);
  });

  it('a mesma chaveIdempotencia com o mesmo pedido grava uma vez; com outro pedido, recusa', async () => {
    const ligacao = p.ligacao(['preco.escrever'], 'm1');
    const token = dmsId.emitir();
    const um = await chamar(p.origem, token, ligacao, 'tools/call', 'preco_definir', { codigo_pdv: 'X1', valor: 29.9, chaveIdempotencia: 'chave-aaa-1' });
    expect(um.corpo.result.isError).toBeUndefined();
    expect(um.corpo.result.structuredContent).toMatchObject({ situacao: 'aplicado', antes: 19.9, depois: 29.9, repetido: false });
    // Padrão §6: o texto é a frase pt-BR (resumo), nunca o JSON do envelope.
    expect(um.corpo.result.content[0].text).toMatch(/Preço alterado de R\$ 19,90 para R\$ 29,90\./);
    expect(() => JSON.parse(um.corpo.result.content[0].text)).toThrow();
    const dois = await chamar(p.origem, token, ligacao, 'tools/call', 'preco_definir', { codigo_pdv: 'X1', valor: 29.9, chaveIdempotencia: 'chave-aaa-1' });
    expect(dois.corpo.result.isError).toBeUndefined();
    expect(dois.corpo.result.structuredContent.repetido).toBe(true);
    expect(p.definirPrecoItem).toHaveBeenCalledTimes(1);
    const outro = await chamar(p.origem, token, ligacao, 'tools/call', 'preco_definir', { codigo_pdv: 'X1', valor: 39.9, chaveIdempotencia: 'chave-aaa-1' });
    expect(outro.corpo.result.isError).toBe(true);
    expect(outro.corpo.result.structuredContent).toMatchObject({ codigo: 'chave_reutilizada' });
    // Padrão §6: na recusa o texto é a frase pt-BR, não o JSON (o código fica no structuredContent).
    expect(outro.corpo.result.content[0].text).toMatch(/chaveIdempotencia/);
    expect(() => JSON.parse(outro.corpo.result.content[0].text)).toThrow();
    expect(p.definirPrecoItem).toHaveBeenCalledTimes(1);
  });

  it('complemento_preco_definir atinge as opções pelo código de PDV e devolve cada uma no envelope', async () => {
    const ligacao = p.ligacao(['preco.escrever'], 'm1');
    const r = await chamar(p.origem, dmsId.emitir(), ligacao, 'tools/call', 'complemento_preco_definir', { codigo_pdv: 'ADD-BACON', valor: 3, chaveIdempotencia: 'chave-compl-1' });
    expect(r.corpo.result.isError).toBeUndefined();
    expect(p.definirPrecoComplementoPorPdv).toHaveBeenCalledWith('m1', 'ADD-BACON', 3);
    expect(r.corpo.result.structuredContent).toMatchObject({ situacao: 'aplicado', repetido: false });
    expect(r.corpo.result.structuredContent.opcoes).toHaveLength(2);
  });

  it('cada ligação chama o serviço com a SUA loja (isolamento)', async () => {
    const token = dmsId.emitir();
    await chamar(p.origem, token, p.ligacao(['catalogo.ler'], 'loja-aaa'), 'tools/call', 'cardapio_listar');
    await chamar(p.origem, token, p.ligacao(['catalogo.ler'], 'loja-bbb'), 'tools/call', 'cardapio_listar');
    expect(p.cardapio.mock.calls.map((c) => c[0])).toEqual(['loja-aaa', 'loja-bbb']);
  });
});
