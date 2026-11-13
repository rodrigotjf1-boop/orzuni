/**
 * A autorização por clique com o banco de verdade (Postgres): o pedido, a página, a senha (e a trava), a decisão, a
 * troca do código pela ligação, o código usado de novo, o PKCE errado, o pedir mais, a loja ligada a outra loja do
 * aplicativo, a loja de outra conta, o recusar, o pedido vencido, o aplicativo parado e os aplicativos conectados.
 *
 * Roda só com ORZUNI_TEST_PG_URL apontando um banco DESCARTÁVEL: o teste aplica as migrations de `database/` nele.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

import { type ErroProblema, resumoChave } from '../dms/integracao-dms';
import { StoreService } from '../store/store.service';
import { UsuarioService } from '../usuario/usuario.service';
import { AutorizacaoService, type DonoDaSessao, type TelaDoPedido } from './autorizacao.service';
import { porta } from './config';

const URL_PG = process.env.ORZUNI_TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
const APP = 'app-regem-de-teste';
const VOLTA = 'https://app.dmsregem.com/integracoes/orzuni/volta';
const SENHA = 'senha-do-dono-123';
const ESTADO = 'estado-de-teste-1234567890';

descrever('autorização por clique (Postgres)', () => {
  let pool: Pool;
  let store: StoreService;
  let usuarios: UsuarioService;
  let svc: AutorizacaoService;
  let paradoAgora = false;
  const hub = { parado: () => (paradoAgora ? { nivel: 'aplicativo', alvo: APP } : null) } as never;
  const token = { aplicativo: APP, permissoes: [], expiraEm: new Date(Date.now() + 3_600_000) };

  const sufixo = () => randomBytes(4).toString('hex');
  async function novoDono(): Promise<DonoDaSessao> {
    const email = `dono-${sufixo()}@exemplo.com.br`;
    const r = await usuarios.cadastrar(email, SENHA);
    const { rows } = await pool.query(`select id, tenant_id from usuario where id = $1`, [r.userId]);
    return { id: rows[0].id, tenant: rows[0].tenant_id, email };
  }
  async function novaLoja(tenant: string, nome: string): Promise<string> {
    const { rows } = await pool.query(`insert into conta_ifood (tenant_id, merchant_id, nome) values ($1, $2, $3) returning id`, [tenant, `m-${sufixo()}`, nome]);
    return rows[0].id;
  }
  const desafioDe = (v: string) => createHash('sha256').update(v, 'ascii').digest('base64url');
  async function pedir(o: { scope?: string; lojaId?: string; lojaNome?: string } = {}) {
    const v = randomBytes(32).toString('base64url');
    const r = await svc.pedir(token, {
      response_type: 'code',
      client_id: APP,
      redirect_uri: VOLTA,
      scope: o.scope ?? 'catalogo.ler preco.escrever status.escrever loja.escrever',
      state: ESTADO,
      code_challenge: desafioDe(v),
      code_challenge_method: 'S256',
      conta_nome: 'Casa do Hambúrguer Ltda.',
      conta_cnpj: '98765432000110',
      conta_email: 'dono@exemplo.com.br',
      conta_loja: o.lojaNome ?? 'Centro',
      conta_loja_id: o.lojaId ?? 'loja-centro',
    });
    return { numero: r.request_uri, v, r };
  }
  const autorizar = (dono: DonoDaSessao, numero: string, loja: string, mudar: Record<string, unknown> = {}) =>
    svc.autorizar(dono, { pedido: numero, loja, opcionais: ['loja.escrever'], senha: SENHA, confirmo_outra_empresa: true, ...mudar });
  const codigoDa = (redirect: string) => new URL(redirect).searchParams.get('code') as string;
  const trocar = (code: string, v: string, mudar: Record<string, unknown> = {}) =>
    svc.trocar(token, { grant_type: 'authorization_code', client_id: APP, code, redirect_uri: VOLTA, code_verifier: v, ...mudar });
  async function erroDe(p: Promise<unknown>): Promise<ErroProblema> {
    try {
      await p;
    } catch (e) {
      return e as ErroProblema;
    }
    throw new Error('esperava a recusa, e deu certo');
  }
  const ligacaoViva = async (conta: string) =>
    (await pool.query(`select id, escopos, classe, conta_pede, autorizacao_id, segredo_hash from ligacao_dms where conta_id = $1 and aplicativo = $2 and revogada_em is null`, [conta, APP])).rows;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    const pasta = join(__dirname, '..', '..', 'database');
    for (const f of readdirSync(pasta).filter((n) => /^\d{3}_.*\.sql$/.test(n)).sort()) await pool.query(readFileSync(join(pasta, f), 'utf8'));
    process.env.DATABASE_URL = URL_PG;
    store = new StoreService();
    store.onModuleInit();
    usuarios = new UsuarioService(store);
    svc = new AutorizacaoService(store, usuarios, hub);
    Object.assign(porta, { ligado: true, emissor: 'https://id.exemplo', recurso: 'https://api.orzuni.test/v1/mcp', aplicativos: { regem: APP } });
  });

  afterAll(async () => {
    await (store as unknown as { pool?: Pool }).pool?.end();
    await pool.end();
  });

  it('o caminho inteiro: pedido → página → autorizar → troca → ligação viva, sem o segredo no banco', async () => {
    const dono = await novoDono();
    const lojaA = await novaLoja(dono.tenant, 'Loja A');
    await novaLoja(dono.tenant, 'Loja B');
    const { numero, v, r } = await pedir();
    expect(r).toMatchObject({ expires_in: 600, authorization_endpoint: 'https://app.orzuni.com/autorizar' });

    const tela = (await svc.lerParaTela(dono, numero)) as TelaDoPedido;
    expect(tela.aplicativo).toEqual({ nome: 'Regem', empresa: 'DMS Tecnologias', verificado: true });
    expect(tela.contaPede).toMatchObject({ nome: 'Casa do Hambúrguer Ltda.', cnpj: '98.765.432/0001-10', loja: 'Centro' });
    expect(tela.outraEmpresa).toBe(true);
    expect(tela.lojas.map((l) => [l.nome, l.situacao])).toEqual([['Loja A', 'livre'], ['Loja B', 'livre']]);
    expect(tela.permissoes.map((p) => [p.id, p.necessaria])).toEqual([
      ['catalogo.ler', true],
      ['preco.escrever', true],
      ['status.escrever', true],
      ['loja.escrever', false],
    ]);
    expect(tela.travadaAte).toBeNull();

    const { redirect } = await autorizar(dono, numero, lojaA);
    const volta = new URL(redirect);
    expect(`${volta.origin}${volta.pathname}`).toBe(VOLTA);
    expect(volta.searchParams.get('state')).toBe(ESTADO);
    expect(volta.searchParams.get('iss')).toBe('https://api.orzuni.test');

    const lig = await trocar(codigoDa(redirect), v);
    expect(lig.ligacao.startsWith('dms_lg_orzuni_')).toBe(true);
    expect(lig).toMatchObject({ conta_id: lojaA, loja_nome: 'Loja A', permissoes: ['catalogo.ler', 'preco.escrever', 'status.escrever', 'loja.escrever'] });
    const [l] = await ligacaoViva(lojaA);
    expect(l).toMatchObject({ classe: 'dms', conta_pede: expect.objectContaining({ loja_id: 'loja-centro', loja: 'Centro' }) });
    expect(l.autorizacao_id).toBeTruthy();
    expect(l.segredo_hash).toBe(resumoChave(lig.ligacao));
    const { rows: ped } = await pool.query(`select texto, versao_texto, codigo_hash from autorizacao_pedido where id = $1`, [l.autorizacao_id]);
    expect(ped[0].texto).toContain('"Loja A"');
    expect(ped[0].versao_texto).toBe(1);
    expect(JSON.stringify(ped)).not.toContain(codigoDa(redirect));

    // o pedido já decidido não volta à página
    expect(await svc.lerParaTela(dono, numero)).toMatchObject({ erro: expect.stringContaining('não vale') });
  });

  it('o mesmo código de novo é recusado e DESLIGA a ligação que ele criou', async () => {
    const dono = await novoDono();
    const loja = await novaLoja(dono.tenant, 'Loja C');
    const { numero, v } = await pedir();
    const { redirect } = await autorizar(dono, numero, loja);
    await trocar(codigoDa(redirect), v);
    expect(await ligacaoViva(loja)).toHaveLength(1);
    const e = await erroDe(trocar(codigoDa(redirect), v));
    expect(e.tipo).toBe('autorizacao-invalida');
    expect(await ligacaoViva(loja)).toHaveLength(0);
  });

  it('PKCE errado ou volta diferente: recusado, e o código fica gasto', async () => {
    const dono = await novoDono();
    const loja = await novaLoja(dono.tenant, 'Loja D');
    const um = await pedir();
    const r1 = await autorizar(dono, um.numero, loja);
    expect((await erroDe(trocar(codigoDa(r1.redirect), randomBytes(32).toString('base64url')))).tipo).toBe('autorizacao-invalida');
    expect((await erroDe(trocar(codigoDa(r1.redirect), um.v))).tipo).toBe('autorizacao-invalida'); // gasto
    const dois = await pedir();
    const r2 = await autorizar(dono, dois.numero, loja);
    expect((await erroDe(trocar(codigoDa(r2.redirect), dois.v, { redirect_uri: `${VOLTA}?x=1` }))).tipo).toBe('autorizacao-invalida');
    expect(await ligacaoViva(loja)).toHaveLength(0);
  });

  it('pedir mais na mesma loja do aplicativo soma ao que a ligação tinha; a página marca "esta"', async () => {
    const dono = await novoDono();
    const loja = await novaLoja(dono.tenant, 'Loja E');
    const um = await pedir({ scope: 'catalogo.ler preco.escrever status.escrever', lojaId: 'loja-e' });
    await trocar(codigoDa((await autorizar(dono, um.numero, loja, { opcionais: [] })).redirect), um.v);
    const dois = await pedir({ scope: 'catalogo.escrever', lojaId: 'loja-e' });
    const tela = (await svc.lerParaTela(dono, dois.numero)) as TelaDoPedido;
    expect(tela.lojas.find((l) => l.id === loja)?.situacao).toBe('esta');
    const lig = await trocar(codigoDa((await autorizar(dono, dois.numero, loja, { opcionais: ['catalogo.escrever'] })).redirect), dois.v);
    expect(lig.permissoes).toEqual(['catalogo.ler', 'catalogo.escrever', 'preco.escrever', 'status.escrever']);
    expect(await ligacaoViva(loja)).toHaveLength(1);
  });

  it('opcional não ligada não entra; recusar a opcional deixa a ligação com o que tinha', async () => {
    const dono = await novoDono();
    const loja = await novaLoja(dono.tenant, 'Loja F');
    const um = await pedir({ lojaId: 'loja-f' });
    const lig = await trocar(codigoDa((await autorizar(dono, um.numero, loja, { opcionais: [] })).redirect), um.v);
    expect(lig.permissoes).toEqual(['catalogo.ler', 'preco.escrever', 'status.escrever']);
  });

  it('a loja do iFood ligada a OUTRA loja do aplicativo aparece e não se escolhe', async () => {
    const dono = await novoDono();
    const loja = await novaLoja(dono.tenant, 'Loja G');
    const um = await pedir({ lojaId: 'loja-bairro', lojaNome: 'Bairro' });
    await trocar(codigoDa((await autorizar(dono, um.numero, loja)).redirect), um.v);
    const dois = await pedir({ lojaId: 'loja-centro' });
    const tela = (await svc.lerParaTela(dono, dois.numero)) as TelaDoPedido;
    expect(tela.lojas.find((l) => l.id === loja)).toMatchObject({ situacao: 'outra', outraLoja: 'Bairro' });
    const e = await erroDe(autorizar(dono, dois.numero, loja));
    expect(e.tipo).toBe('regra-invalida');
    expect(e.detalhe).toContain('outra loja do Regem');
  });

  it('a ligação antiga pela chave (sem dono conhecido) aparece como "chave" e é substituída pelo clique', async () => {
    const dono = await novoDono();
    const loja = await novaLoja(dono.tenant, 'Loja H');
    await pool.query(
      `insert into ligacao_dms (tenant_id, conta_id, aplicativo, produto, classe, segredo_hash, prefixo, escopos) values ($1,$2,$3,'regem','dms',$4,'dms_lg_orzuni_xxxxx','["catalogo.ler","vigia.ler"]'::jsonb)`,
      [dono.tenant, loja, APP, `hash-${sufixo()}`],
    );
    const um = await pedir({ lojaId: 'loja-h' });
    expect(((await svc.lerParaTela(dono, um.numero)) as TelaDoPedido).lojas.find((l) => l.id === loja)?.situacao).toBe('chave');
    const lig = await trocar(codigoDa((await autorizar(dono, um.numero, loja, { opcionais: [] })).redirect), um.v);
    expect(lig.permissoes).toEqual(['catalogo.ler', 'preco.escrever', 'status.escrever']); // não herda o vigia da chave
    expect(await ligacaoViva(loja)).toHaveLength(1);
  });

  it('loja de outra conta não se escolhe', async () => {
    const dono = await novoDono();
    const outro = await novoDono();
    const lojaDoOutro = await novaLoja(outro.tenant, 'Loja do outro');
    const um = await pedir();
    expect((await erroDe(autorizar(dono, um.numero, lojaDoOutro))).tipo).toBe('nao-encontrado');
  });

  it('sem confirmar a outra empresa não autoriza', async () => {
    const dono = await novoDono();
    const loja = await novaLoja(dono.tenant, 'Loja I');
    const um = await pedir();
    expect((await erroDe(autorizar(dono, um.numero, loja, { confirmo_outra_empresa: false }))).detalhe).toContain('Confirme');
  });

  it('senha errada conta; na 5ª a autorização trava, e a certa não passa enquanto travada', async () => {
    const dono = await novoDono();
    const loja = await novaLoja(dono.tenant, 'Loja J');
    const um = await pedir();
    const detalhes: string[] = [];
    for (let i = 0; i < 5; i++) detalhes.push((await erroDe(autorizar(dono, um.numero, loja, { senha: 'errada-123' }))).detalhe);
    expect(detalhes[0]).toContain('Mais 4 tentativas');
    expect(detalhes[3]).toContain('Mais 1 tentativa');
    expect(detalhes[4]).toContain('travada');
    expect((await erroDe(autorizar(dono, um.numero, loja))).tipo).toBe('limite-de-chamadas');
    expect(((await svc.lerParaTela(dono, um.numero)) as TelaDoPedido).travadaAte).not.toBeNull();
  });

  it('recusar volta com access_denied e o pedido não serve mais', async () => {
    const dono = await novoDono();
    const loja = await novaLoja(dono.tenant, 'Loja K');
    const um = await pedir();
    const { redirect } = await svc.recusar(dono, { pedido: um.numero });
    const u = new URL(redirect as string);
    expect(u.searchParams.get('error')).toBe('access_denied');
    expect(u.searchParams.get('state')).toBe(ESTADO);
    expect((await erroDe(autorizar(dono, um.numero, loja))).tipo).toBe('autorizacao-invalida');
    expect(await ligacaoViva(loja)).toHaveLength(0);
  });

  it('pedido vencido: a página diz, e a volta é a do endereço guardado, com invalid_request_uri', async () => {
    const dono = await novoDono();
    const um = await pedir();
    await pool.query(`update autorizacao_pedido set vence_em = now() - interval '1 second' where numero_hash = $1`, [createHash('sha256').update(um.numero, 'utf8').digest('hex')]);
    const r = (await svc.lerParaTela(dono, um.numero)) as { erro: string; voltar: string };
    expect(r.erro).toContain('não vale');
    expect(new URL(r.voltar).searchParams.get('error')).toBe('invalid_request_uri');
    expect(r.voltar.startsWith(VOLTA)).toBe(true);
    expect(await svc.lerParaTela(dono, 'urn:ietf:params:oauth:request_uri:orz_inventado')).toEqual({ erro: expect.any(String), voltar: null });
  });

  it('aplicativo parado no hub, ou fora do mapa: recusado no pedido e na página', async () => {
    const dono = await novoDono();
    const um = await pedir();
    paradoAgora = true;
    try {
      expect((await erroDe(pedir())).tipo).toBe('integracao-parada');
      expect(await svc.lerParaTela(dono, um.numero)).toMatchObject({ erro: expect.stringContaining('pausou') });
    } finally {
      paradoAgora = false;
    }
    const outroToken = { ...token, aplicativo: 'app-desconhecido' };
    expect((await erroDe(svc.pedir(outroToken, {}))).tipo).toBe('cliente-invalido');
  });

  it('aplicativos conectados: a lista com o texto lido, e desligar vale na hora (repetir não dá erro)', async () => {
    const dono = await novoDono();
    const loja = await novaLoja(dono.tenant, 'Loja L');
    const um = await pedir({ lojaId: 'loja-l', lojaNome: 'Shopping' });
    await trocar(codigoDa((await autorizar(dono, um.numero, loja)).redirect), um.v);
    const lista = await svc.conectados(dono);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ aplicativo: 'Regem', loja: 'Loja L', via: 'clique', quemPediu: { nome: 'Casa do Hambúrguer Ltda.', loja: 'Shopping' } });
    expect(lista[0].texto).toContain('Regem (DMS Tecnologias');
    expect(JSON.stringify(lista)).not.toContain('dms_lg_orzuni_' + 'x'.repeat(10));
    const outro = await novoDono();
    expect((await erroDe(svc.desligar(outro, { id: lista[0].id }))).tipo).toBe('nao-encontrado');
    await svc.desligar(dono, { id: lista[0].id });
    await svc.desligar(dono, { id: lista[0].id });
    expect(await svc.conectados(dono)).toEqual([]);
    expect(await ligacaoViva(loja)).toHaveLength(0);
  });
});
