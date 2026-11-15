import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { ApiKeyService } from '../auth/api-key.service';
import { ContaService } from '../conta/conta.service';
import { StoreService, type EstadoItem } from './store.service';

// O vigia e o registro de lojas (conta_ifood), contra Postgres de verdade. O defeito de 14/11/2026: a cada varredura o
// vigia fazia upsert de uma linha "loja" CONECTADA na conta da distribuição para a loja varrida — a loja do cliente
// aparecia duas vezes na lista do admin, era varrida duas vezes por rodada, e a busca por merchant (`limit 1`) podia
// pegar a cópia desligada (chave nascendo morta, ligação recusada como "conta bloqueada").
const URL_PG = process.env.ORZUNI_TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
const TENANT_PADRAO = '00000000-0000-0000-0000-000000000001';
const CLIENTE = '00000000-0000-0000-0000-00000000c11e';
const OUTRO = '00000000-0000-0000-0000-0000000000a2';

descrever('vigia × registro de lojas (Postgres)', () => {
  let pool: Pool;
  const servicos: StoreService[] = [];
  const sufixo = randomBytes(4).toString('hex');
  const m = (n: string) => `merchant-${n}-${sufixo}`;

  /** Um StoreService novo (cache vazio, como depois de reiniciar a API). */
  function novaStore(): StoreService {
    const s = new StoreService();
    s.onModuleInit();
    servicos.push(s);
    return s;
  }
  const contas = (s: StoreService) => new ContaService({ merchants: async () => [] } as any, s);
  const linhas = async (merchant: string) =>
    (await pool.query(`select id, tenant_id, nome, status from conta_ifood where merchant_id = $1 order by criado_em`, [merchant])).rows;
  const loja = async (tenant: string, merchant: string, nome: string, status: string, haMinutos = 0) =>
    (
      await pool.query(
        `insert into conta_ifood (tenant_id, merchant_id, nome, status, criado_em)
         values ($1, $2, $3, $4, now() - make_interval(mins => $5)) returning id`,
        [tenant, merchant, nome, status, haMinutos],
      )
    ).rows[0].id as string;
  const estado = (itemId: string, desde: number): Map<string, EstadoItem> =>
    new Map([[itemId, { noAr: false, desde, nome: `Item ${itemId}`, externalCode: `pdv-${itemId}` }]]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    const pasta = join(__dirname, '..', '..', 'database');
    for (const f of readdirSync(pasta).filter((n) => /^\d{3}_.*\.sql$/.test(n)).sort()) await pool.query(readFileSync(join(pasta, f), 'utf8'));
    process.env.DATABASE_URL = URL_PG;
  });

  afterAll(async () => {
    for (const s of servicos) await (s as unknown as { pool?: Pool }).pool?.end();
    await pool.end();
  });

  it('a loja ligada à conta de um cliente: o vigia grava o estado nela, sem cópia na conta da distribuição e sem trocar o nome', async () => {
    const merchant = m('cliente');
    const id = await loja(CLIENTE, merchant, 'Hamburgueria do cliente', 'connected');
    const store = novaStore();
    const desde = Date.now() - 60_000;

    await store.setEstado(merchant, estado('i1', desde));
    await store.reconciliarAlertas(merchant, [{ itemId: 'i1', externalCode: 'pdv-i1', nome: 'Item i1', motivo: 'PAUSADO', caiuEm: desde }]);
    const lido = await store.getEstado(merchant);
    const alertas = await store.listarAlertas(merchant);

    expect(await linhas(merchant)).toEqual([{ id, tenant_id: CLIENTE, nome: 'Hamburgueria do cliente', status: 'connected' }]);
    expect(lido.get('i1')).toMatchObject({ noAr: false, desde });
    expect(alertas.map((a) => a.itemId)).toEqual(['i1']);
    const c = contas(store);
    expect((await c.ativas()).filter((l) => l.merchantId === merchant)).toHaveLength(1);
    expect((await c.listarAdmin()).filter((l) => l.merchantId === merchant)).toHaveLength(1);
    expect(await c.tenantDoMerchant(merchant)).toBe(CLIENTE);
  });

  it('a cópia antiga desligada que guarda o estado continua sendo onde o vigia lê e grava (o "desde quando" não zera)', async () => {
    const merchant = m('copia');
    const doCliente = await loja(CLIENTE, merchant, 'Loja do cliente', 'connected', 60);
    const copia = await loja(TENANT_PADRAO, merchant, 'loja', 'revoked', 30);
    const desdeAntigo = Date.now() - 3 * 3_600_000;
    await pool.query(
      `insert into item_estado (conta_id, item_id, external_code, nome, no_ar, desde, atualizado_em)
       values ($1, 'i9', 'pdv-i9', 'Item i9', false, to_timestamp($2 / 1000.0), now())`,
      [copia, desdeAntigo],
    );
    const store = novaStore();

    expect((await store.getEstado(merchant)).get('i9')?.desde).toBe(desdeAntigo);
    await store.setEstado(merchant, estado('i10', Date.now()));

    const porConta = (await pool.query(`select conta_id, count(*)::int as n from item_estado where conta_id = any($1) group by conta_id`, [[doCliente, copia]])).rows;
    expect(porConta).toEqual([{ conta_id: copia, n: 2 }]);
    expect((await linhas(merchant)).map((l) => l.status)).toEqual(['connected', 'revoked']);
    // mas a LOJA (chave, ligação) é a conectada
    expect(await contas(store).contaIdDe(merchant)).toBe(doCliente);
  });

  it('loja sem linha nenhuma (modo de uma loja só): a âncora do estado nasce desligada e não vira loja conectada', async () => {
    const merchant = m('solta');
    const store = novaStore();

    await store.setEstado(merchant, estado('i1', Date.now()));
    await store.setEstado(merchant, estado('i2', Date.now()));

    expect(await linhas(merchant)).toEqual([expect.objectContaining({ tenant_id: TENANT_PADRAO, status: 'revoked' })]);
    expect((await store.getEstado(merchant)).size).toBe(2);
    const c = contas(store);
    expect((await c.listarAdmin()).some((l) => l.merchantId === merchant)).toBe(false);
    expect(await c.tenantDoMerchant(merchant)).toBeNull();
  });

  it('chave criada para a loja liga à linha CONECTADA, mesmo com uma linha desligada mais antiga — e vale', async () => {
    const merchant = m('chave');
    await loja(OUTRO, merchant, 'loja antiga', 'revoked', 120);
    const conectada = await loja(CLIENTE, merchant, 'Loja nova', 'connected', 5);
    const store = novaStore();
    const chaves = new ApiKeyService(store);

    const criada = await chaves.criar('ERP de teste', ['catalogo:ler'], merchant);
    expect(criada).not.toBeNull();
    const [k] = (await pool.query(`select conta_id from api_key where prefixo = $1`, [criada!.prefixo])).rows;
    expect(k.conta_id).toBe(conectada);
    expect((await chaves.validarTabela(criada!.chave))?.merchantId).toBe(merchant);
    expect(await contas(store).contaIdDe(merchant)).toBe(conectada);
  });
});
