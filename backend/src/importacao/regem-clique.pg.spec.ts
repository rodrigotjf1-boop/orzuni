/**
 * "Conectar pelo Regem" com o banco de verdade (Postgres) e a rede de mentira (o DMS ID e o Regem respondem pelo
 * teste): o pedido empurrado, a volta presa a quem começou, o código que vale uma vez, a ligação guardada cifrada, a
 * loja em uso (e a troca de loja), o presidente que cancela, e a importação lendo pela ligação com o token do DMS ID.
 *
 * Roda só com ORZUNI_TEST_PG_URL apontando um banco DESCARTÁVEL: o teste aplica as migrations de `database/` nele.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

import { decifrar } from '../common/cifra';
import { StoreService } from '../store/store.service';
import { UsuarioService } from '../usuario/usuario.service';
import { ImportacaoRegemService } from './importacao-regem.service';
import { type DonoDaSessao, RegemCliqueService } from './regem-clique.service';

const URL_PG = process.env.ORZUNI_TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;

const REGEM = 'https://api.dmsregem.com';
const PORTA = `${REGEM}/api/v1/integracao`;
const DMS_ID = 'https://id.exemplo/oidc';
const APP = 'app-orzuni-de-teste';
const VOLTA = 'https://app.orzuni.com/importar/volta';
const SENHA = 'senha-do-dono-123';

type Chamada = { url: string; metodo: string; cabecalhos: Record<string, string>; corpo: any };
type Resposta = { status: number; corpo?: unknown; cabecalhos?: Record<string, string> };

descrever('conectar pelo Regem (Postgres)', () => {
  let pool: Pool;
  let store: StoreService;
  let usuarios: UsuarioService;
  let clique: RegemCliqueService;
  let importacao: ImportacaoRegemService;
  const ENV = ['ORZUNI_REGEM_CLIQUE', 'DMS_ID_EMISSOR', 'HUB_APLICATIVO', 'HUB_SEGREDO', 'ORZUNI_CIFRA_SEGREDO', 'ORZUNI_REGEM_BASE', 'ORZUNI_REGEM_APP_URL', 'ORZUNI_APP_URL', 'DATABASE_URL'] as const;
  const antes: Record<string, string | undefined> = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

  // ── a rede de mentira ──
  let aoRegem: Chamada[] = [];
  let aoDmsId: Chamada[] = [];
  let regem: (c: Chamada) => Resposta = () => ({ status: 500 });
  let tokens = 0;
  const criados: string[] = []; // o que o iFood "criou"

  const sufixo = () => randomBytes(4).toString('hex');
  const ligacaoNova = () => `dms_lg_regem_${randomBytes(32).toString('base64url')}_${randomBytes(4).toString('base64url').slice(0, 6)}`;
  const numeroNovo = () => `urn:ietf:params:oauth:request_uri:rgm_${randomBytes(32).toString('base64url')}`;
  const codigoNovo = () => `rgm_ac_${randomBytes(32).toString('base64url')}`;

  async function novoDono(lojaDoIfood: string | null = 'Lanchonete da Olga'): Promise<DonoDaSessao> {
    const email = `dono-${sufixo()}@exemplo.com.br`;
    const r = await usuarios.cadastrar(email, SENHA);
    const { rows } = await pool.query(`select id, tenant_id from usuario where id = $1`, [r.userId]);
    if (lojaDoIfood) await pool.query(`insert into conta_ifood (tenant_id, merchant_id, nome) values ($1, $2, $3)`, [rows[0].tenant_id, `m-${sufixo()}`, lojaDoIfood]);
    return { id: rows[0].id, tenant: rows[0].tenant_id, email };
  }

  /** O Regem aceita o pedido empurrado e devolve o número. */
  const regemAceitaOPedido = (numero = numeroNovo()) => {
    regem = (c) => (c.url === `${PORTA}/autorizacao/pedido` ? { status: 201, corpo: { request_uri: numero, expires_in: 600 } } : { status: 404 });
    return numero;
  };

  /** Começa a conexão e devolve o `state` e o desafio que foram ao Regem. */
  async function iniciar(dono: DonoDaSessao) {
    const numero = regemAceitaOPedido();
    const { url } = await clique.iniciar(dono);
    const pedido = aoRegem[aoRegem.length - 1] as Chamada;
    return { url, numero, estado: pedido.corpo.state as string, desafio: pedido.corpo.code_challenge as string, pedido };
  }

  /** O Regem troca o código pelas lojas dadas (e confere o PKCE como o de verdade). */
  function regemTroca(desafio: string, lojas: Array<{ id: string; nome: string; ligacao: string }>) {
    regem = (c) => {
      if (c.url !== `${PORTA}/autorizacao/token`) return { status: 404 };
      const confere = createHash('sha256').update(String(c.corpo.code_verifier), 'ascii').digest('base64url') === desafio;
      if (!confere || c.corpo.redirect_uri !== VOLTA || c.corpo.grant_type !== 'authorization_code') return { status: 400, corpo: { detail: 'troca recusada' } };
      return {
        status: 200,
        corpo: {
          lojas: lojas.map((l) => ({
            loja_id: l.id,
            loja_nome: l.nome,
            empresa_nome: 'Brasa Burger',
            ligacao: l.ligacao,
            prefixo: l.ligacao.slice(0, 21),
            permissoes: ['catalogo.ler', 'catalogo.ifood.ler'],
            segredo_em: new Date().toISOString(),
          })),
        },
      };
    };
  }

  /** O caminho inteiro: começa, o presidente autoriza as lojas dadas, volta e conclui. */
  async function conectar(dono: DonoDaSessao, lojas: Array<{ id: string; nome: string; ligacao: string }>) {
    const p = await iniciar(dono);
    regemTroca(p.desafio, lojas);
    return clique.concluir(dono, { code: codigoNovo(), state: p.estado, iss: REGEM });
  }

  const conexao = async (tenant: string) => (await pool.query(`select * from conexao_regem where tenant_id = $1`, [tenant])).rows[0];
  const pedidosDe = async (tenant: string) => (await pool.query(`select * from conexao_regem_pedido where tenant_id = $1 order by criado_em`, [tenant])).rows;
  const erroDe = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('esperava a recusa, e deu certo');
  };

  beforeAll(async () => {
    process.env.ORZUNI_REGEM_CLIQUE = 'true';
    process.env.DMS_ID_EMISSOR = DMS_ID;
    process.env.HUB_APLICATIVO = APP;
    process.env.HUB_SEGREDO = 'segredo-do-aplicativo-de-teste';
    process.env.ORZUNI_CIFRA_SEGREDO = 'segredo-de-teste-para-cifra-123456';
    delete process.env.ORZUNI_REGEM_BASE;
    delete process.env.ORZUNI_REGEM_APP_URL;
    delete process.env.ORZUNI_APP_URL;

    pool = new Pool({ connectionString: URL_PG });
    const pasta = join(__dirname, '..', '..', 'database');
    for (const f of readdirSync(pasta).filter((n) => /^\d{3}_.*\.sql$/.test(n)).sort()) await pool.query(readFileSync(join(pasta, f), 'utf8'));
    // a 011 de novo: tem de ser idempotente, e a conferência dela vem toda `ok`
    const de011 = (await pool.query(readFileSync(join(pasta, '011_conexao_regem_clique.sql'), 'utf8'))) as unknown as Array<{ rows: Array<{ objeto: string; ok: boolean }> }>;
    const conferencia = de011[de011.length - 1]?.rows ?? [];
    expect(conferencia).toHaveLength(3);
    expect(conferencia.every((l) => l.ok === true)).toBe(true);

    process.env.DATABASE_URL = URL_PG;
    store = new StoreService();
    store.onModuleInit();
    usuarios = new UsuarioService(store);
    const contas = {
      ativasDoTenant: async (tenant: string) =>
        (await pool.query(`select id, merchant_id, nome from conta_ifood where tenant_id = $1 order by criado_em`, [tenant])).rows.map((r) => ({ id: r.id, merchantId: r.merchant_id, nome: r.nome ?? 'loja' })),
    };
    const catalogo = {
      cardapio: async () => [],
      criarItem: async (_m: string, item: { pdv: string }) => {
        criados.push(item.pdv);
        return { ok: true };
      },
    };
    clique = new RegemCliqueService(store, contas as never);
    importacao = new ImportacaoRegemService(store, contas as never, catalogo as never, clique);
    clique.buscar = (async (url: unknown, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => {
      const cabecalhos = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
      const bruto = typeof init.body === 'string' ? init.body : '';
      const c: Chamada = {
        url: String(url),
        metodo: init.method ?? 'GET',
        cabecalhos,
        corpo: cabecalhos['content-type'] === 'application/json' ? JSON.parse(bruto || 'null') : Object.fromEntries(new URLSearchParams(bruto)),
      };
      if (c.url === `${DMS_ID}/token`) {
        aoDmsId.push(c);
        return new Response(JSON.stringify({ access_token: `token-do-dms-id-${++tokens}`, expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      aoRegem.push(c);
      const r = regem(c);
      return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json', ...(r.cabecalhos ?? {}) } });
    }) as typeof fetch;
  });

  beforeEach(() => {
    aoRegem = [];
    aoDmsId = [];
    criados.length = 0;
    regem = () => ({ status: 500 });
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await (store as unknown as { pool?: Pool }).pool?.end();
    await pool.end();
  });

  it('começar: o pedido vai ao Regem com o token do DMS ID, as duas leituras, o PKCE e a conta; só o resumo do state fica no banco', async () => {
    const dono = await novoDono();
    const p = await iniciar(dono);

    // o token foi pedido ao DMS ID para o recurso do Regem, com as duas leituras
    expect(aoDmsId[0]?.corpo).toMatchObject({ grant_type: 'client_credentials', resource: PORTA, scope: 'catalogo.ler catalogo.ifood.ler' });
    expect(p.pedido.url).toBe(`${PORTA}/autorizacao/pedido`);
    expect(p.pedido.cabecalhos.authorization).toMatch(/^Bearer token-do-dms-id-\d+$/);
    expect(p.pedido.corpo).toMatchObject({
      response_type: 'code',
      redirect_uri: VOLTA,
      scope: 'catalogo.ler catalogo.ifood.ler',
      code_challenge_method: 'S256',
      conta_nome: 'Lanchonete da Olga',
      conta_email: dono.email,
    });
    expect(p.pedido.corpo.conta_cnpj).toBeUndefined();

    // a página do Regem, com o client_id do Orzuni e o número
    const u = new URL(p.url);
    expect(`${u.origin}${u.pathname}`).toBe('https://app.dmsregem.com/integracoes/autorizar');
    expect(u.searchParams.get('client_id')).toBe(APP);
    expect(u.searchParams.get('request_uri')).toBe(p.numero);

    // no banco: o pedido de quem começou, sem o state nem o verificador em claro
    const [linha] = await pedidosDe(dono.tenant);
    expect(linha).toMatchObject({ usuario_id: dono.id, usado_em: null });
    expect(linha.estado_hash).toBe(createHash('sha256').update(p.estado, 'utf8').digest('hex'));
    expect(JSON.stringify(linha)).not.toContain(p.estado);
    expect(createHash('sha256').update(decifrar(linha.verificador_cifrado), 'ascii').digest('base64url')).toBe(p.desafio);
    // nada foi ligado ainda
    expect(await conexao(dono.tenant)).toBeUndefined();
  });

  it('o Regem recusa o pedido (aplicativo fora da lista, pausado): a conta lê uma frase, nada é guardado', async () => {
    const dono = await novoDono();
    regem = () => ({ status: 401, corpo: { detail: 'Este aplicativo não usa a autorização por clique do Regem.' } });
    expect(await erroDe(clique.iniciar(dono))).toBe('O Regem não aceitou abrir a conexão agora. Avise o suporte.');
    regem = () => ({ status: 503, corpo: { detail: 'integrações pausadas' } });
    expect(await erroDe(clique.iniciar(dono))).toBe('O Regem está com as integrações pausadas agora. Tente de novo mais tarde.');
    expect(await pedidosDe(dono.tenant)).toHaveLength(0);
  });

  it('o caminho inteiro: volta com o iss do Regem, troca com o verificador certo, a ligação fica cifrada e a loja entra em uso', async () => {
    const dono = await novoDono();
    const ligacao = ligacaoNova();
    const r = await conectar(dono, [{ id: 'loja-centro', nome: 'Brasa Centro', ligacao }]);
    expect(r).toEqual({ situacao: 'conectado', lojas: [{ id: 'loja-centro', nome: 'Brasa Centro' }], emUso: { id: 'loja-centro', nome: 'Brasa Centro' } });

    const c = await conexao(dono.tenant);
    expect(c).toMatchObject({ origem: 'clique', loja_regem_id: 'loja-centro', loja_regem_nome: 'Brasa Centro', base_url: REGEM });
    expect(decifrar(c.token_cifrado)).toBe(ligacao);
    const guardadas = (await pool.query(`select * from conexao_regem_ligacao where tenant_id = $1`, [dono.tenant])).rows;
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]).toMatchObject({ loja_regem_id: 'loja-centro', permissoes: ['catalogo.ler', 'catalogo.ifood.ler'] });
    expect(decifrar(guardadas[0].ligacao_cifrada)).toBe(ligacao);
    // o segredo nunca em claro no banco
    expect(JSON.stringify([c, guardadas])).not.toContain(ligacao);

    expect(await importacao.status(dono.tenant)).toMatchObject({ conectado: true, clique: true, origem: 'clique', loja: { id: 'loja-centro', nome: 'Brasa Centro' }, lojas: [{ id: 'loja-centro', nome: 'Brasa Centro' }] });
  });

  it('a volta só vale uma vez, só para quem começou, só dentro dos 10 minutos e só com o iss do Regem', async () => {
    const dono = await novoDono();
    const outro = await novoDono();
    const p = await iniciar(dono);
    regemTroca(p.desafio, [{ id: 'loja-1', nome: 'Loja 1', ligacao: ligacaoNova() }]);
    const antesDaTroca = aoRegem.length;

    // sem o iss do Regem: recusada ANTES de gastar o pedido
    expect(await erroDe(clique.concluir(dono, { code: codigoNovo(), state: p.estado, iss: 'https://ataque.exemplo' }))).toContain('a volta não veio do Regem');
    expect((await pedidosDe(dono.tenant))[0].usado_em).toBeNull();
    // outra conta com o state de quem começou: não acha o pedido, e não o gasta
    expect(await erroDe(clique.concluir(outro, { code: codigoNovo(), state: p.estado, iss: REGEM }))).toContain('não vale mais');
    expect((await pedidosDe(dono.tenant))[0].usado_em).toBeNull();
    expect(aoRegem.length).toBe(antesDaTroca); // nenhuma troca foi tentada

    // quem começou conclui; a segunda vez com o mesmo state é recusada
    expect((await clique.concluir(dono, { code: codigoNovo(), state: p.estado, iss: REGEM })).situacao).toBe('conectado');
    expect(await erroDe(clique.concluir(dono, { code: codigoNovo(), state: p.estado, iss: REGEM }))).toContain('não vale mais');
    expect(await conexao(outro.tenant)).toBeUndefined();

    // pedido vencido
    const v = await iniciar(dono);
    await pool.query(`update conexao_regem_pedido set vence_em = now() - interval '1 minute' where estado_hash = $1`, [createHash('sha256').update(v.estado, 'utf8').digest('hex')]);
    expect(await erroDe(clique.concluir(dono, { code: codigoNovo(), state: v.estado, iss: REGEM }))).toContain('não vale mais');
  });

  it('o presidente cancela no Regem: o pedido é gasto, a tela diz "recusado" e nada muda', async () => {
    const dono = await novoDono();
    const p = await iniciar(dono);
    const chamadas = aoRegem.length;
    expect(await clique.concluir(dono, { error: 'access_denied', state: p.estado, iss: REGEM })).toEqual({ situacao: 'recusado' });
    expect(aoRegem.length).toBe(chamadas); // sem troca
    expect((await pedidosDe(dono.tenant))[0].usado_em).not.toBeNull();
    expect(await conexao(dono.tenant)).toBeUndefined();
  });

  it('a troca recusada pelo Regem ou com resposta torta: nada é guardado', async () => {
    const dono = await novoDono();
    const p = await iniciar(dono);
    regem = () => ({ status: 400, corpo: { detail: 'código desconhecido' } });
    expect(await erroDe(clique.concluir(dono, { code: codigoNovo(), state: p.estado, iss: REGEM }))).toContain('O Regem não aceitou concluir a conexão');
    const q = await iniciar(dono);
    regem = () => ({ status: 200, corpo: { lojas: [{ loja_id: 'loja-1', ligacao: 'rgm_it_nao-e-uma-ligacao', permissoes: ['catalogo.ler'] }] } });
    expect(await erroDe(clique.concluir(dono, { code: codigoNovo(), state: q.estado, iss: REGEM }))).toContain('Nada foi guardado');
    expect(await conexao(dono.tenant)).toBeUndefined();
    expect((await pool.query(`select count(*)::int n from conexao_regem_ligacao where tenant_id = $1`, [dono.tenant])).rows[0].n).toBe(0);
  });

  it('duas lojas marcadas: as duas ficam guardadas, a primeira em uso; trocar de loja zera o resumo; loja de outra conta não entra', async () => {
    const dono = await novoDono();
    const outro = await novoDono();
    const a = ligacaoNova();
    const b = ligacaoNova();
    const r = await conectar(dono, [
      { id: 'loja-a', nome: 'Brasa Centro', ligacao: a },
      { id: 'loja-b', nome: 'Brasa Praia', ligacao: b },
    ]);
    expect(r).toMatchObject({ situacao: 'conectado', emUso: { id: 'loja-a' } });
    expect((await importacao.status(dono.tenant)).lojas).toEqual([
      { id: 'loja-a', nome: 'Brasa Centro' },
      { id: 'loja-b', nome: 'Brasa Praia' },
    ]);
    await pool.query(`update conexao_regem set ultimo_resumo = '{"criados":3,"versao":"v-da-loja-a"}', ultima_importacao = now() where tenant_id = $1`, [dono.tenant]);

    expect(await clique.escolher(dono.tenant, 'loja-b')).toEqual({ id: 'loja-b', nome: 'Brasa Praia' });
    const c = await conexao(dono.tenant);
    expect(c).toMatchObject({ loja_regem_id: 'loja-b', ultimo_resumo: null, ultima_importacao: null });
    expect(decifrar(c.token_cifrado)).toBe(b);

    // a loja da conta `dono` não serve à conta `outro`, mesmo com a outra conectada pelo clique
    await conectar(outro, [{ id: 'loja-z', nome: 'Outra Empresa', ligacao: ligacaoNova() }]);
    expect(await erroDe(clique.escolher(outro.tenant, 'loja-a'))).toBe('Essa loja do Regem não está ligada a esta conta.');
    expect((await conexao(outro.tenant)).loja_regem_id).toBe('loja-z');

    // conectar de novo marcando só a loja B: ela segue em uso, e a A continua guardada
    const deNovo = await conectar(dono, [{ id: 'loja-b', nome: 'Brasa Praia', ligacao: ligacaoNova() }]);
    expect(deNovo).toMatchObject({ emUso: { id: 'loja-b' } });
    expect((await importacao.status(dono.tenant)).lojas).toHaveLength(2);
  });

  it('importar pela ligação: o catálogo é lido com o token do DMS ID e o DMS-Ligacao; no 401 pede outro token e tenta de novo', async () => {
    const dono = await novoDono();
    const ligacao = ligacaoNova();
    await conectar(dono, [{ id: 'loja-centro', nome: 'Brasa Centro', ligacao }]);
    aoRegem = [];
    let vez = 0;
    regem = (c) => {
      if (!c.url.startsWith(`${PORTA}/catalogo`)) return { status: 404 };
      if (++vez === 1) return { status: 401, corpo: { detail: 'token vencido' } };
      return {
        status: 200,
        corpo: { versao: 'v1', atualizado: true, categorias: [], produtos: [{ codigo: 'XB', nome: 'X-Burger', no_ifood: true, preco_ifood_centavos: 3490 }] },
      };
    };
    const resumo = await importacao.importar(dono.tenant);
    expect(resumo).toMatchObject({ criados: 1, jaExistiam: 0 });
    expect(criados).toEqual(['XB']);
    expect(aoRegem).toHaveLength(2);
    for (const c of aoRegem) {
      expect(c.metodo).toBe('GET');
      expect(c.cabecalhos['dms-ligacao']).toBe(ligacao);
      expect(c.cabecalhos.authorization).toMatch(/^Bearer token-do-dms-id-\d+$/);
    }
    expect(aoRegem[0]?.cabecalhos.authorization).not.toBe(aoRegem[1]?.cabecalhos.authorization); // token novo na segunda

    // a ligação desligada no Regem: a frase manda conectar de novo
    regem = () => ({ status: 401, corpo: { detail: 'ligação revogada' } });
    expect(await erroDe(importacao.importar(dono.tenant))).toContain('Conecte de novo pelo botão "Conectar pelo Regem"');
  });

  it('a chave colada continua valendo: vai sozinha no Authorization, e colar uma chave tira a conta do clique', async () => {
    const dono = await novoDono();
    await conectar(dono, [{ id: 'loja-centro', nome: 'Brasa Centro', ligacao: ligacaoNova() }]);
    await pool.query(`update conexao_regem set ultimo_resumo = '{"criados":1,"versao":"v-do-clique"}' where tenant_id = $1`, [dono.tenant]);
    aoRegem = [];
    regem = () => ({ status: 200, corpo: { versao: 'v2', atualizado: true, categorias: [], produtos: [] } });
    expect(await importacao.conectar(dono.tenant, 'rgm_it_chave-colada-de-teste')).toEqual({ ok: true, produtos: 0 });
    expect(aoRegem[0]?.cabecalhos.authorization).toBe('Bearer rgm_it_chave-colada-de-teste');
    expect(aoRegem[0]?.cabecalhos['dms-ligacao']).toBeUndefined();
    const c = await conexao(dono.tenant);
    expect(c).toMatchObject({ origem: 'chave', loja_regem_id: null, loja_regem_nome: null, ultimo_resumo: null });
    expect(await importacao.status(dono.tenant)).toMatchObject({ conectado: true, origem: 'chave', loja: null, lojas: [] });
    // a chave não é loja do clique: trocar de loja não vale para ela
    expect(await erroDe(clique.escolher(dono.tenant, 'loja-centro'))).toBe('Essa loja do Regem não está ligada a esta conta.');
  });

  it('com a chave desligada: o botão não aparece e as rotas do clique recusam; a chave colada segue como antes', async () => {
    const dono = await novoDono();
    process.env.ORZUNI_REGEM_CLIQUE = 'false';
    try {
      expect(clique.disponivel).toBe(false);
      expect((await importacao.status(dono.tenant)).clique).toBe(false);
      expect(await erroDe(clique.iniciar(dono))).toBe('A conexão pelo Regem ainda não está disponível. Use a chave de integração.');
      expect(await erroDe(clique.concluir(dono, { code: codigoNovo(), state: 'x', iss: REGEM }))).toBe('A conexão pelo Regem ainda não está disponível. Use a chave de integração.');
      expect(aoRegem).toHaveLength(0);
    } finally {
      process.env.ORZUNI_REGEM_CLIQUE = 'true';
    }
  });
});
