/**
 * A porta MCP do Orzuni (via DMS ID) numa app Nest de verdade: o portão, o
 * filtro do Padrão, os metadados do recurso e o atalho da ligação. O DMS ID é de
 * mentira, mas assina de verdade (ES384, a chave EC P-384 do Logto) e publica as
 * chaves por HTTP: o token é conferido pelo código de produção (`DmsIdService` +
 * o pacote comum). Só a ligação é dublê, com as MESMAS regras (`ligacao.regras`).
 *
 * O primeiro teste roda o kit de conformidade do hub contra a porta.
 */
import { Module, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ErroProblema, gerarChave } from '../dms/integracao-dms';
import { CatalogoService } from '../catalogo/catalogo.service';
import { LojaService } from '../loja/loja.service';
import { StoreService } from '../store/store.service';
import { porta } from './config';
import { AutorizacaoService } from './autorizacao.service';
import { DmsIdController } from './dms-id.controller';
import { DmsIdService } from './dms-id.service';
import { IntegracaoGuard } from './integracao.guard';
import { LigacaoService, type IntegracaoAutenticada } from './ligacao.service';
import { CAMINHO_DO_MANIFESTO, CAMINHO_DOS_METADADOS, CONTA_BLOQUEADA, LIGACAO_INVALIDA, LIMITE_POR_MINUTO, ligacaoVale, permissoesDaLigacao, ROTAS_FORA_DO_PREFIXO } from './ligacao.regras';
import { ManifestoController } from './manifesto.controller';
import { manifestoDaPorta, PORTA_MCP } from './manifesto';
import { McpController } from './mcp.controller';
import { McpServidor } from './mcp.servidor';
import { ProblemaFilter } from './problema.filter';
import { HubService } from '../hub/hub.service';
import { RegistroDaPorta } from '../hub/registro-da-porta.middleware';

const APP_A = 'aplicativo-regem-de-teste';
const APP_B = 'aplicativo-outro-de-teste';
const MERCHANT_A = 'merchant-a-de-teste';
const MERCHANT_B = 'merchant-b-de-teste';
const KIT = join(__dirname, '..', '..', 'scripts', 'dms', 'kit-conformidade.mts');
const COPIA_DO_PACOTE = join(__dirname, '..', 'dms', 'integracao-dms.ts');
const ARQUIVO_DO_MANIFESTO = join(__dirname, '..', '..', '..', 'docs', 'dms-manifesto.json');

type DmsIdFalso = { servidor: Server; emissor: string; emitir(o: { aplicativo?: string; scope?: string; destino?: string; expiraEmSeg?: number }): string };

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
    emitir({ aplicativo = APP_A, scope = 'catalogo.ler loja.ler', destino, expiraEmSeg = 3600 }) {
      const agora = Math.floor(Date.now() / 1000);
      const cabeca = b64({ alg: 'ES384', typ: 'at+jwt', kid });
      const corpo = b64({ iss: emissor, aud: destino ?? porta.recurso, sub: aplicativo, client_id: aplicativo, scope, iat: agora, exp: agora + expiraEmSeg, jti: randomUUID() });
      const assinatura = sign('sha384', Buffer.from(`${cabeca}.${corpo}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return `${cabeca}.${corpo}.${assinatura}`;
    },
  };
}

type LigacaoGuardada = { id: string; aplicativo: string; classe: string; escopos: string[]; revogadaEm: Date | null; merchantId?: string; contaBloqueada?: boolean };

type Porta = {
  app: INestApplication;
  origem: string;
  merchants: string[];
  ligacao(l: Omit<LigacaoGuardada, 'id' | 'revogadaEm'> & Partial<Pick<LigacaoGuardada, 'id' | 'revogadaEm'>>): string;
};

async function subirPorta(): Promise<Porta> {
  const merchants: string[] = [];
  const ligacoes = new Map<string, LigacaoGuardada>();
  let n = 0;
  const quem = (l: LigacaoGuardada, permissoes: string[]): IntegracaoAutenticada => ({
    ligacaoId: l.id,
    tenantId: '00000000-0000-4000-8000-000000000001',
    contaId: '00000000-0000-4000-8000-000000000002',
    merchantId: l.merchantId ?? MERCHANT_A,
    aplicativo: l.aplicativo,
    produto: 'regem',
    classe: l.classe,
    nome: 'regem',
    prefixo: 'dms_lg_orzuni_teste',
    escopos: permissoes,
  });
  const autenticarLigacao = jest.fn(async (segredo: string | null, doToken: { aplicativo: string; permissoes: string[] }, aplicativos: Record<string, string>) => {
    const g = segredo ? ligacoes.get(segredo) : undefined;
    const l = g ? { aplicativo: g.aplicativo, classe: g.classe, escopos: g.escopos, revogadaEm: g.revogadaEm } : undefined;
    if (!ligacaoVale(l, doToken.aplicativo, aplicativos)) throw new ErroProblema('ligacao-invalida', LIGACAO_INVALIDA);
    if (g!.contaBloqueada) throw new ErroProblema('conta-bloqueada', CONTA_BLOQUEADA);
    const ligada = quem(g!, permissoesDaLigacao(l!, doToken.permissoes));
    merchants.push(ligada.merchantId);
    return ligada;
  });

  const catalogoDub = {
    cardapio: jest.fn(async () => []),
    categorias: jest.fn(async () => []),
    detalhe: jest.fn(async () => ({ nome: 'x' })),
    complementos: jest.fn(async () => []),
    precoItem: jest.fn(async () => ({ ok: true })),
    reprecificar: jest.fn(async () => ({ batchId: 'b', ignorados: [] })),
    statusItem: jest.fn(async () => ({ ok: true })),
    statusOpcao: jest.fn(async () => ({ ok: true })),
  };

  @Module({
    controllers: [McpController, DmsIdController, ManifestoController],
    providers: [
      McpServidor,
      IntegracaoGuard,
      DmsIdService,
      { provide: LigacaoService, useValue: { autenticarLigacao, trocarPorLigacao: jest.fn(), revogarPeloProprio: jest.fn() } },
      // A autorização por clique tem o teste próprio (autorizacao.pg.spec.ts); aqui só completa o controlador.
      { provide: AutorizacaoService, useValue: { pedir: jest.fn(), trocar: jest.fn() } },
      { provide: CatalogoService, useValue: catalogoDub },
      { provide: LojaService, useValue: { painel: jest.fn(async () => ({})), horarios: jest.fn(async () => ({})), criarInterrupcao: jest.fn(async () => ({ ok: true })) } },
      { provide: StoreService, useValue: { listarAlertas: jest.fn(async () => []) } },
      HubService,
      RegistroDaPorta,
    ],
  })
  class PortaDeTeste implements NestModule {
    configure(consumidor: MiddlewareConsumer): void {
      consumidor.apply(RegistroDaPorta).forRoutes(McpController, DmsIdController);
    }
  }

  const modulo = await Test.createTestingModule({ imports: [PortaDeTeste] }).compile();
  const app = modulo.createNestApplication({ logger: false });
  app.setGlobalPrefix('v1', { exclude: ROTAS_FORA_DO_PREFIXO });
  app.useGlobalFilters(new ProblemaFilter());
  await app.listen(0, '127.0.0.1');
  const origem = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  porta.recurso = `${origem}/v1/mcp`;

  return {
    app,
    origem,
    merchants,
    ligacao(l) {
      const { chave } = gerarChave('lg', 'orzuni');
      ligacoes.set(chave, { id: `00000000-0000-4000-9000-${String((n += 1)).padStart(12, '0')}`, revogadaEm: null, ...l });
      return chave;
    },
  };
}

type Resposta = { status: number; tipo: string; cabecalhos: Headers; corpo: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function chamarMcp(p: Porta, o: { token?: string; ligacao?: string; metodo?: string; nome?: string; args?: Record<string, unknown> }): Promise<Resposta> {
  const metodo = o.metodo ?? 'tools/call';
  const cabecalhos: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-method': metodo, 'mcp-protocol-version': PORTA_MCP.versao };
  if (o.nome) cabecalhos['mcp-name'] = o.nome;
  if (o.token !== undefined) cabecalhos.authorization = `Bearer ${o.token}`;
  if (o.ligacao !== undefined) cabecalhos['DMS-Ligacao'] = o.ligacao;
  const params: Record<string, unknown> = {
    _meta: { 'io.modelcontextprotocol/protocolVersion': PORTA_MCP.versao, 'io.modelcontextprotocol/clientInfo': { name: 'teste', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} },
  };
  if (o.nome) Object.assign(params, { name: o.nome, arguments: o.args ?? {} });
  const r = await fetch(`${p.origem}/v1/mcp`, { method: 'POST', headers: cabecalhos, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metodo, params }) });
  return ler(r);
}

async function ler(r: globalThis.Response): Promise<Resposta> {
  const texto = await r.text();
  const tipo = r.headers.get('content-type') ?? '';
  let json = texto;
  if (tipo.startsWith('text/event-stream')) json = texto.split(/\r?\n/).filter((l) => l.startsWith('data:')).pop()?.slice(5) ?? '';
  let corpo: unknown = null;
  try {
    corpo = json ? JSON.parse(json) : null;
  } catch {
    corpo = texto;
  }
  return { status: r.status, tipo, cabecalhos: r.headers, corpo };
}

function rodarKit(config: unknown, credenciais: Record<string, string>): Promise<{ codigo: number | null; saida: string }> {
  const pasta = mkdtempSync(join(tmpdir(), 'kit-dms-'));
  const arquivo = join(pasta, 'config.json');
  writeFileSync(arquivo, JSON.stringify(config));
  return new Promise((pronto) => {
    const filho = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', KIT, arquivo], { env: { ...process.env, ...credenciais }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let saida = '';
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    filho.on('close', (codigo) => {
      rmSync(pasta, { recursive: true, force: true });
      pronto({ codigo, saida });
    });
  });
}

describe('a porta MCP do Orzuni pela via do DMS ID', () => {
  let dmsId: DmsIdFalso;
  let p: Porta;

  beforeAll(async () => {
    dmsId = await subirDmsIdFalso();
  });
  afterAll(async () => {
    await new Promise((fim) => dmsId.servidor.close(fim));
  });
  beforeEach(async () => {
    Object.assign(porta, { ligado: true, emissor: dmsId.emissor, recurso: '', aplicativos: { regem: APP_A, outro: APP_B }, aceitaIntegracoes: true });
    p = await subirPorta();
  });
  afterEach(async () => {
    await p.app.close();
  });

  it('passa no kit de conformidade do hub, no modo do DMS ID', async () => {
    const config = {
      modo: 'dms_id',
      produto: 'orzuni',
      base: p.origem,
      porta: 'mcp',
      leitura: {
        caminho: '/v1/mcp',
        permissao: 'catalogo.ler',
        cabecalhos: { 'mcp-method': 'tools/call', 'mcp-name': 'cardapio_listar', 'mcp-protocol-version': PORTA_MCP.versao },
        corpo: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'cardapio_listar', arguments: {}, _meta: { 'io.modelcontextprotocol/protocolVersion': PORTA_MCP.versao, 'io.modelcontextprotocol/clientInfo': { name: 'kit-dms', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } },
        },
      },
      limite: { chamadas: LIMITE_POR_MINUTO + 1 },
      copiaDoPacote: COPIA_DO_PACOTE,
      credenciais: {
        token: 'KIT_TOKEN',
        ligacao: 'KIT_LIGACAO',
        tokenOutroDestino: 'KIT_TOKEN_OUTRO_DESTINO',
        tokenVencido: 'KIT_TOKEN_VENCIDO',
        tokenSemPermissao: 'KIT_TOKEN_SEM_PERMISSAO',
        tokenOutroAplicativo: 'KIT_TOKEN_OUTRO_APLICATIVO',
        ligacaoRevogada: 'KIT_LIGACAO_REVOGADA',
        ligacaoSemPermissao: 'KIT_LIGACAO_SEM_PERMISSAO',
      },
    };
    const r = await rodarKit(config, {
      KIT_TOKEN: dmsId.emitir({}),
      KIT_LIGACAO: p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['catalogo.ler', 'loja.ler'] }),
      KIT_TOKEN_OUTRO_DESTINO: dmsId.emitir({ destino: 'https://outro-produto.exemplo.test/v1/mcp' }),
      KIT_TOKEN_VENCIDO: dmsId.emitir({ expiraEmSeg: -120 }),
      KIT_TOKEN_SEM_PERMISSAO: dmsId.emitir({ scope: '' }),
      KIT_TOKEN_OUTRO_APLICATIVO: dmsId.emitir({ aplicativo: APP_B }),
      KIT_LIGACAO_REVOGADA: p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['catalogo.ler'], revogadaEm: new Date('2026-10-01T00:00:00Z') }),
      KIT_LIGACAO_SEM_PERMISSAO: p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['loja.ler'] }),
    });
    const linhas = r.saida.split(/\r?\n/).filter((l) => /^[✔✘–] /.test(l));
    expect({ codigo: r.codigo, falhas: linhas.filter((l) => l.startsWith('✘')), saida: linhas.length ? '' : r.saida }).toEqual({ codigo: 0, falhas: [], saida: '' });
    expect(linhas.filter((l) => l.startsWith('✔'))).toHaveLength(17);
  }, 60_000);

  it('o manifesto da porta (Padrão §13): sem credencial, fora do prefixo, e passa no kit do manifesto', async () => {
    const esperado = JSON.parse(JSON.stringify(manifestoDaPorta()));
    if (process.env.ATUALIZAR_MANIFESTO) writeFileSync(ARQUIVO_DO_MANIFESTO, JSON.stringify(esperado, null, 2) + '\n');

    const r = await fetch(`${p.origem}/${CAMINHO_DO_MANIFESTO}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(await r.json()).toEqual(esperado);
    expect((await fetch(`${p.origem}/v1/${CAMINHO_DO_MANIFESTO}`)).status).toBe(404);

    for (const fonte of [{ base: p.origem }, { arquivo: ARQUIVO_DO_MANIFESTO }]) {
      const k = await rodarKit({ modo: 'manifesto', produto: 'orzuni', ...fonte, copiaDoPacote: COPIA_DO_PACOTE }, {});
      const linhas = k.saida.split(/\r?\n/).filter((l) => /^[✔✘–] /.test(l));
      expect({ fonte, codigo: k.codigo, falhas: linhas.filter((l) => l.startsWith('✘')), saida: k.codigo === 0 ? '' : k.saida }).toEqual({ fonte, codigo: 0, falhas: [], saida: '' });
    }
  }, 60_000);

  it('os metadados do recurso saem na raiz, apontando o DMS ID, e não debaixo de /v1', async () => {
    const r = await ler(await fetch(`${p.origem}/${CAMINHO_DOS_METADADOS}`));
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ resource: `${p.origem}/v1/mcp`, authorization_servers: [dmsId.emissor], scopes_supported: expect.arrayContaining(['catalogo.ler', 'preco.escrever']), bearer_methods_supported: ['header'], resource_name: 'Orzuni (porta MCP)' });
    expect(r.corpo.scopes_supported).toHaveLength(8);
    expect((await fetch(`${p.origem}/v1/${CAMINHO_DOS_METADADOS}`)).status).toBe(404);
  });

  it('sem token, o desafio vai sem código de erro; com o token torto, invalid_token', async () => {
    const ligacao = p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['catalogo.ler'] });
    const semToken = await chamarMcp(p, { ligacao, nome: 'cardapio_listar' });
    expect(semToken.status).toBe(401);
    expect(semToken.cabecalhos.get('www-authenticate')).toContain('resource_metadata="');
    expect(semToken.cabecalhos.get('www-authenticate')).not.toContain('error=');
    const torto = await chamarMcp(p, { token: 'nao.e.token', ligacao, nome: 'cardapio_listar' });
    expect(torto.status).toBe(401);
    expect(torto.cabecalhos.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('desligada, a porta some: metadados e atalho em 404, e o POST também', async () => {
    porta.ligado = false;
    expect((await fetch(`${p.origem}/${CAMINHO_DOS_METADADOS}`)).status).toBe(404);
    expect((await fetch(`${p.origem}/v1/dms-id/ligacao`, { method: 'POST' })).status).toBe(404);
    const ligacao = p.ligacao({ aplicativo: APP_A, classe: 'dms', escopos: ['catalogo.ler'] });
    const r = await chamarMcp(p, { token: dmsId.emitir({}), ligacao, nome: 'cardapio_listar' });
    expect(r.status).toBe(404);
  });
});
