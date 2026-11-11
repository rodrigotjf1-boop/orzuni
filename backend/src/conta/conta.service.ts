import { Injectable, Logger } from '@nestjs/common';
import { IfoodMerchantService } from '../ifood/ifood-merchant.service';
import { StoreService } from '../store/store.service';

export interface Conta {
  id?: string;
  merchantId: string;
  nome: string;
}

const TENANT_PADRAO = '00000000-0000-0000-0000-000000000001';

/**
 * Registro de LOJAS (multi-loja). Fonte da verdade: tabela conta_ifood.
 * - `ativas()` lê todas as lojas conectadas; se o banco estiver vazio/fora,
 *   cai para o IFOOD_MERCHANT_ID do env (single-loja) ou para a descoberta
 *   pelo módulo Merchant. Assim a evolução multi-loja é aditiva e não quebra
 *   o setup atual.
 * - `adicionar/remover` gerenciam o registro (usado pelos endpoints de admin).
 */
@Injectable()
export class ContaService {
  private readonly logger = new Logger('conta');
  constructor(
    private readonly merchant: IfoodMerchantService,
    private readonly store: StoreService,
  ) {}

  async ativas(): Promise<Conta[]> {
    try {
      const rows = await this.store.query(
        // só as lojas OPERACIONAIS: a loja de teste de integração (so_integracao) fica de
        // fora do vigia/poller e de tudo que chama o iFood (merchant inventado).
        `select id, merchant_id, nome from conta_ifood where status = 'connected' and so_integracao = false order by criado_em`,
      );
      if (rows.length) return rows.map((r) => ({ id: r.id, merchantId: r.merchant_id, nome: r.nome ?? 'loja' }));
    } catch (e: any) {
      this.logger.warn(`ativas() do banco falhou: ${e?.message ?? e}`);
    }
    // fallback single-loja
    const env = process.env.IFOOD_MERCHANT_ID;
    if (env) return [{ merchantId: env, nome: 'loja configurada' }];
    const ms = await this.merchant.merchants();
    if (!ms.length) this.logger.warn('nenhuma loja no registro nem autorizada e IFOOD_MERCHANT_ID vazio');
    return ms.map((m) => ({ merchantId: m.id, nome: m.name }));
  }

  /** Resolve o conta_id (uuid) de uma loja pelo merchantId. */
  async contaIdDe(merchantId: string): Promise<string | null> {
    const rows = await this.store.query(`select id from conta_ifood where merchant_id = $1 limit 1`, [merchantId]);
    return rows[0]?.id ?? null;
  }

  // ---- multi-tenant (Fase 0): as lojas de UM tenant (o usuário logado) ----

  /** As lojas conectadas DESTE tenant (a conta do usuário logado). Sem fallback global. */
  async ativasDoTenant(tenant: string): Promise<Conta[]> {
    if (!this.store.temBanco) return [];
    try {
      const rows = await this.store.query(
        // o lojista nunca vê a loja de teste de integração (so_integracao)
        `select id, merchant_id, nome from conta_ifood where tenant_id = $1 and status = 'connected' and so_integracao = false order by criado_em`,
        [tenant],
      );
      return rows.map((r) => ({ id: r.id, merchantId: r.merchant_id, nome: r.nome ?? 'loja' }));
    } catch (e: any) {
      this.logger.warn(`ativasDoTenant falhou: ${e?.message ?? e}`);
      return [];
    }
  }

  /**
   * Lista de ADMIN (tela "API / ERP"): as lojas conectadas, INCLUSIVE as de teste de
   * integração, cada uma com a marca `soIntegracao` — para o admin ver e apagar.
   */
  async listarAdmin(): Promise<Array<{ id?: string; merchantId: string; nome: string; soIntegracao: boolean }>> {
    if (!this.store.temBanco) return [];
    try {
      const rows = await this.store.query(
        `select id, merchant_id, nome, so_integracao from conta_ifood where status = 'connected' order by so_integracao, criado_em`,
      );
      return rows.map((r) => ({ id: r.id, merchantId: r.merchant_id, nome: r.nome ?? 'loja', soIntegracao: r.so_integracao === true }));
    } catch (e: any) {
      this.logger.warn(`listarAdmin falhou: ${e?.message ?? e}`);
      return [];
    }
  }

  /** O tenant que JÁ liga este merchant (connected), ou null. Trava anti-IDOR do conectar. */
  async tenantDoMerchant(merchantId: string): Promise<string | null> {
    const rows = await this.store.query(
      `select tenant_id from conta_ifood where merchant_id = $1 and status = 'connected' limit 1`,
      [merchantId],
    );
    return rows[0]?.tenant_id ?? null;
  }

  /**
   * (Re)conecta ao TENANT do usuário logado uma loja que JÁ é dele.
   *
   * 🔒 PROVA DE POSSE: sem o fluxo de autorização do iFood amarrado à conta, NINGUÉM
   * reivindica uma loja por self-service — nem uma loja SEM dono. Senão qualquer
   * cadastro novo tomaria a loja de quem autorizou o app e ainda não conectou, e
   * passaria a mudar cardápio/preço/pausa dela. A conexão é concluída pela
   * DISTRIBUIÇÃO (regra inviolável "a Regem conclui a integração"); aqui só o
   * `dono === tenant` passa (reconectar a própria). Reabrir o self-service exige o
   * fluxo de posse (autorização do iFood → conta), numa fase seguinte.
   */
  async adicionarNoTenant(tenant: string, merchantId: string, nome: string): Promise<{ ok: boolean; erro?: string }> {
    if (!this.store.temBanco) return { ok: false, erro: 'banco indisponível' };
    const dono = await this.tenantDoMerchant(merchantId);
    if (dono !== tenant) return { ok: false, erro: 'A conexão da sua loja do iFood é concluída pela equipe do Orzuni. Fale com o suporte para ativar a sua loja.' };
    try {
      await this.store.query(
        `insert into conta_ifood (tenant_id, merchant_id, nome, status) values ($1,$2,$3,'connected')
         on conflict (tenant_id, merchant_id) do update set nome = excluded.nome, status = 'connected'`,
        [tenant, merchantId, nome],
      );
      return { ok: true };
    } catch (e: any) {
      this.logger.warn(`adicionarNoTenant falhou: ${e?.message ?? e}`);
      return { ok: false, erro: 'não foi possível conectar a loja' };
    }
  }

  /**
   * As lojas que o lojista pode conectar por self-service.
   *
   * 🔒 FECHADO (prova de posse pendente): esta lista expunha a QUALQUER conta os nomes
   * de todas as lojas que autorizaram o app no iFood e ainda não foram conectadas —
   * e deixava reivindicá-las (ver `adicionarNoTenant`). Com o cadastro aberto isso é
   * um sequestro de loja. Devolve **vazio** até existir o fluxo de autorização do
   * iFood amarrado à conta; a conexão da loja é feita pela distribuição.
   */
  async disponiveisParaTenant(_tenant: string): Promise<Array<{ merchantId: string; nome: string }>> {
    return [];
  }

  /**
   * AÇÃO DA EQUIPE (admin): conecta uma loja do iFood à CONTA de um cliente, pelo e-mail —
   * não ao TENANT_PADRAO. É o caminho de ativação desde que o self-service fechou (prova de
   * posse): depois que o cliente se cadastra, a equipe liga a loja à conta dele. À prova de
   * duplicata (recusa merchant já conectado a OUTRO tenant). Só admin (a rota tem AdminGuard).
   */
  async conectarLojaParaEmail(email: string, merchantId: string, nome: string): Promise<{ ok: boolean; erro?: string }> {
    if (!this.store.temBanco) return { ok: false, erro: 'banco indisponível' };
    const e = (email ?? '').trim().toLowerCase();
    if (!e) return { ok: false, erro: 'informe o e-mail da conta do cliente' };
    const alvo = await this.store.query(`select tenant_id from usuario where lower(email) = $1 limit 1`, [e]);
    const tenant = alvo[0]?.tenant_id as string | undefined;
    if (!tenant) return { ok: false, erro: 'não encontrei uma conta com esse e-mail' };
    const dono = await this.tenantDoMerchant(merchantId);
    if (dono && dono !== tenant) return { ok: false, erro: 'esta loja já está conectada a outra conta' };
    try {
      await this.store.query(
        `insert into conta_ifood (tenant_id, merchant_id, nome, status) values ($1,$2,$3,'connected')
         on conflict (tenant_id, merchant_id) do update set nome = excluded.nome, status = 'connected'`,
        [tenant, merchantId, nome],
      );
      return { ok: true };
    } catch (err: any) {
      this.logger.warn(`conectarLojaParaEmail falhou: ${err?.message ?? err}`);
      return { ok: false, erro: 'não foi possível conectar a loja' };
    }
  }

  /**
   * Registra/atualiza uma loja no TENANT_PADRAO (admin). `soIntegracao` marca a loja de
   * teste do kit. À prova de duplicata: recusa um merchant JÁ conectado em OUTRO tenant
   * (a mesma trava do `adicionarNoTenant`) — senão o vigia varreria a loja duas vezes e
   * o `remover` por merchant derrubaria a do piloto.
   */
  async adicionar(merchantId: string, nome: string, soIntegracao = false): Promise<{ ok: boolean; erro?: string }> {
    if (!this.store.temBanco) return { ok: false, erro: 'banco indisponível' };
    const dono = await this.tenantDoMerchant(merchantId);
    if (dono && dono !== TENANT_PADRAO) return { ok: false, erro: 'esta loja já está conectada a outra conta' };
    try {
      await this.store.query(
        `insert into conta_ifood (tenant_id, merchant_id, nome, status, so_integracao) values ($1,$2,$3,'connected',$4)
         on conflict (tenant_id, merchant_id) do update set nome = excluded.nome, status = 'connected', so_integracao = excluded.so_integracao`,
        [TENANT_PADRAO, merchantId, nome, soIntegracao],
      );
      return { ok: true };
    } catch (e: any) {
      this.logger.warn(`adicionar falhou: ${e?.message ?? e}`);
      return { ok: false, erro: 'não foi possível adicionar a loja' };
    }
  }

  /**
   * Remove UMA loja do registro pelo ID da linha (status revoked — não apaga o histórico).
   * Pelo id, não pelo merchant: um merchant pode ter mais de uma linha (tenants diferentes),
   * e revogar por merchant derrubaria a do piloto (e a ligação do Regem com ela).
   */
  async remover(id: string): Promise<boolean> {
    if (!this.store.temBanco) return false;
    await this.store.query(`update conta_ifood set status = 'revoked' where id = $1`, [id]);
    return true;
  }

  /** Descobre lojas autorizadas no iFood (módulo Merchant) — para o admin escolher. */
  async descobrir(): Promise<Array<{ merchantId: string; nome: string }>> {
    const ms = await this.merchant.merchants();
    return ms.map((m) => ({ merchantId: m.id, nome: m.name }));
  }
}
