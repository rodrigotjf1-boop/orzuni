import { Injectable, Logger } from '@nestjs/common';

import { cifrar, decifrar } from '../common/cifra';
import { ContaService } from '../conta/conta.service';
import { ClienteDmsId } from '../dms/integracao-dms';
import { StoreService } from '../store/store.service';
import {
  type ConfigDoClique,
  type LojaLigada,
  LEITURAS_DO_REGEM,
  conferirVolta,
  corpoDoPedido,
  formatoDoNumero,
  gerarPedido,
  hashDoEstado,
  lerConfigDoClique,
  lojaEmUso,
  lojasDaTroca,
  nomeDaConta,
  urlDaPagina,
} from './regem-clique.regras';

type Ligada = Extract<ConfigDoClique, { ligado: true }>;

export interface DonoDaSessao {
  id: string;
  tenant: string;
  email: string;
}

export type LojaDoRegem = { id: string; nome: string };

const COMECE_DE_NOVO = 'Comece de novo pelo botão "Conectar pelo Regem".';

/**
 * "CONECTAR PELO REGEM" (plano "Clique Orzuni → Regem" do hub; migration 011). O dono da conta não cola chave: o Orzuni
 * empurra o pedido ao Regem com o token do DMS ID, o presidente autoriza na página do Regem e o Orzuni troca o código
 * pela ligação de cada loja marcada, guardada CIFRADA. Nasce DESLIGADO (`ORZUNI_REGEM_CLIQUE`): sem a chave ligada, a
 * tela segue só com a chave colada e as rotas daqui recusam.
 *
 * Tudo pelo `tenant` da sessão. O `state` fica preso a quem começou (conta e usuário) e vale uma vez, por 10 minutos.
 */
@Injectable()
export class RegemCliqueService {
  private readonly logger = new Logger('regem-clique');
  private lida: { chave: string; config: ConfigDoClique; dmsId: ClienteDmsId | null } | null = null;
  /** A chamada de rede (o DMS ID e o Regem). O teste troca. */
  buscar: typeof fetch = (...a) => fetch(...a);

  constructor(
    private readonly store: StoreService,
    private readonly contas: ContaService,
  ) {}

  // ───────────────────────────── configuração ─────────────────────────────

  /** A configuração do ambiente, relida só quando muda. A torta vai ao log uma vez. */
  private get atual(): { config: ConfigDoClique; dmsId: ClienteDmsId | null } {
    const e = process.env;
    const chave = [e.ORZUNI_REGEM_CLIQUE, e.ORZUNI_REGEM_BASE, e.ORZUNI_REGEM_APP_URL, e.ORZUNI_APP_URL, e.DMS_ID_EMISSOR, e.HUB_APLICATIVO, e.HUB_SEGREDO].join('\n');
    if (this.lida?.chave !== chave) {
      const config = lerConfigDoClique(e);
      if (!config.ligado && config.motivo) this.logger.error(`"Conectar pelo Regem" desligado: ${config.motivo}`);
      const dmsId = config.ligado
        ? new ClienteDmsId({ emissor: config.emissorDmsId, aplicativo: config.aplicativo, segredo: config.segredo, buscar: (...a) => this.buscar(...a) })
        : null;
      this.lida = { chave, config, dmsId };
    }
    return this.lida;
  }

  /** O botão aparece? Só com a chave ligada, a configuração certa e o banco. */
  get disponivel(): boolean {
    return this.atual.config.ligado && this.store.temBanco;
  }

  private exigir(): { c: Ligada; dmsId: ClienteDmsId } {
    const { config, dmsId } = this.atual;
    if (!config.ligado || !dmsId || !this.store.temBanco) throw new Error('A conexão pelo Regem ainda não está disponível. Use a chave de integração.');
    return { c: config, dmsId };
  }

  // ───────────────────────────── a chamada ao Regem ─────────────────────────────

  /** Os cabeçalhos da via do DMS ID: o token do aplicativo e o segredo da ligação da loja. */
  async cabecalhos(ligacao: string): Promise<Record<string, string>> {
    const { c, dmsId } = this.exigir();
    return { Authorization: `Bearer ${await this.token(c, dmsId)}`, 'DMS-Ligacao': ligacao };
  }

  /** O Regem respondeu 401: o próximo token é pedido de novo ao DMS ID. */
  esquecerToken(): void {
    const { config, dmsId } = this.atual;
    if (config.ligado) dmsId?.esquecer(config.recurso, LEITURAS_DO_REGEM);
  }

  private async token(c: Ligada, dmsId: ClienteDmsId): Promise<string> {
    try {
      return await dmsId.token(c.recurso, LEITURAS_DO_REGEM);
    } catch (e) {
      this.logger.error(`o DMS ID não deu o token para o Regem: ${(e as Error)?.message ?? e}`);
      throw new Error('O Orzuni ainda não está liberado para pedir a conexão ao Regem. Avise o suporte.');
    }
  }

  /** POST na porta do Regem, com o token do DMS ID. No 401, pede outro token e tenta uma vez mais. */
  private async chamar(caminho: string, corpo: Record<string, string>): Promise<{ status: number; corpo: unknown }> {
    const { c, dmsId } = this.exigir();
    for (let vez = 0; ; vez++) {
      const token = await this.token(c, dmsId);
      let r: Response;
      try {
        r = await this.buscar(`${c.recurso}${caminho}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(corpo),
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new Error('O Regem não respondeu agora. Tente de novo em instantes.');
      }
      if (r.status === 401 && vez === 0) {
        dmsId.esquecer(c.recurso, LEITURAS_DO_REGEM);
        continue;
      }
      return { status: r.status, corpo: await r.json().catch(() => null) };
    }
  }

  private motivoDoRegem(corpo: unknown): string {
    const d = (corpo as { detail?: unknown; message?: unknown } | null) ?? {};
    return String(d.detail ?? d.message ?? '').slice(0, 200);
  }

  // ───────────────────────────── começar ─────────────────────────────

  /** Empurra o pedido ao Regem e devolve a página para onde o navegador vai. Nada é ligado aqui. */
  async iniciar(dono: DonoDaSessao): Promise<{ url: string }> {
    const { c } = this.exigir();
    const lojas = await this.contas.ativasDoTenant(dono.tenant);
    const p = gerarPedido();
    const r = await this.chamar(
      '/autorizacao/pedido',
      corpoDoPedido({ volta: c.volta, estado: p.estado, desafio: p.desafio, contaNome: nomeDaConta(lojas[0]?.nome, dono.email), contaEmail: dono.email }),
    );
    const numero = (r.corpo as { request_uri?: unknown } | null)?.request_uri;
    if (r.status !== 201 || !formatoDoNumero(numero)) {
      // o motivo é para a distribuição (aplicativo fora da lista do Regem, endereço de volta não cadastrado...), não para a conta
      this.logger.error(`o Regem recusou o pedido de conexão (${r.status}): ${this.motivoDoRegem(r.corpo)}`);
      if (r.status === 503) throw new Error('O Regem está com as integrações pausadas agora. Tente de novo mais tarde.');
      throw new Error('O Regem não aceitou abrir a conexão agora. Avise o suporte.');
    }
    await this.store.query(
      `insert into conexao_regem_pedido (tenant_id, usuario_id, estado_hash, verificador_cifrado, vence_em)
       values ($1, $2, $3, $4, now() + interval '10 minutes')`,
      [dono.tenant, dono.id, p.estadoHash, cifrar(p.verificador)],
    );
    // os pedidos velhos saem aqui (não há rotina para eles): um comando só, pelo índice do vencimento
    await this.store
      .query(`delete from conexao_regem_pedido where vence_em < now() - interval '1 day'`)
      .catch((e) => this.logger.warn(`limpar pedidos de conexão vencidos falhou: ${e?.message ?? e}`));
    return { url: urlDaPagina(c.pagina, c.aplicativo, numero) };
  }

  // ───────────────────────────── concluir ─────────────────────────────

  /**
   * A volta do Regem. Confere o `iss` e o `state`, GASTA o pedido (uma vez só, de quem começou) e, com o código, troca
   * pela ligação de cada loja marcada. O presidente recusou: nada muda, e a tela diz isso.
   */
  async concluir(
    dono: DonoDaSessao,
    q: { code?: unknown; state?: unknown; iss?: unknown; error?: unknown },
  ): Promise<{ situacao: 'conectado'; lojas: LojaDoRegem[]; emUso: LojaDoRegem } | { situacao: 'recusado' }> {
    const { c } = this.exigir();
    const v = conferirVolta(q, c.api);
    if (v.tipo === 'invalida') throw new Error(`Não deu para concluir: ${v.motivo}. ${COMECE_DE_NOVO}`);

    const [pedido] = await this.store.query(
      `update conexao_regem_pedido set usado_em = now()
        where estado_hash = $1 and tenant_id = $2 and usuario_id = $3 and usado_em is null and vence_em > now()
        returning verificador_cifrado`,
      [hashDoEstado(v.estado), dono.tenant, dono.id],
    );
    if (!pedido) throw new Error(`Este pedido de conexão não vale mais: já foi usado, venceu ou foi aberto por outra conta. ${COMECE_DE_NOVO}`);
    if (v.tipo === 'recusa') {
      if (v.motivo === 'recusado') return { situacao: 'recusado' };
      throw new Error(`O Regem não reconheceu o pedido de conexão. ${COMECE_DE_NOVO}`);
    }

    const r = await this.chamar('/autorizacao/token', {
      grant_type: 'authorization_code',
      code: v.codigo,
      code_verifier: decifrar(pedido.verificador_cifrado),
      redirect_uri: c.volta,
    });
    if (r.status !== 200) {
      this.logger.error(`o Regem recusou a troca do código (${r.status}): ${this.motivoDoRegem(r.corpo)}`);
      throw new Error(`O Regem não aceitou concluir a conexão. ${COMECE_DE_NOVO}`);
    }
    const lojas = lojasDaTroca(r.corpo);
    if (!lojas) {
      this.logger.error('a troca do código no Regem veio sem loja válida: nada foi guardado');
      throw new Error('O Regem respondeu de um jeito que o Orzuni não entendeu. Nada foi guardado; avise o suporte.');
    }
    const emUso = await this.guardar(dono.tenant, c.api, lojas);
    return { situacao: 'conectado', lojas: lojas.map((l) => ({ id: l.lojaId, nome: l.nome })), emUso: { id: emUso.lojaId, nome: emUso.nome } };
  }

  /** Guarda a ligação de cada loja (cifrada) e põe uma em uso, na mesma transação. Trocou de loja: o resumo recomeça. */
  private async guardar(tenant: string, api: string, lojas: LojaLigada[]): Promise<LojaLigada> {
    return this.store.transacao(async (q) => {
      // a linha da conta primeiro, travada: duas voltas da mesma conta não se cruzam (a primeira conexão de todas não
      // tem linha para travar; aí o `on conflict` do fim decide)
      const [atual] = await q(`select origem, loja_regem_id from conexao_regem where tenant_id = $1 for update`, [tenant]);
      await q(
        `insert into conexao_regem_ligacao (tenant_id, loja_regem_id, loja_regem_nome, ligacao_cifrada, prefixo, permissoes)
         select $1, x.id, x.nome, x.cifrada, nullif(x.prefixo, ''), string_to_array(x.permissoes, ' ')
           from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) as x(id, nome, cifrada, prefixo, permissoes)
         on conflict (tenant_id, loja_regem_id) do update
           set loja_regem_nome = excluded.loja_regem_nome, ligacao_cifrada = excluded.ligacao_cifrada, prefixo = excluded.prefixo,
               permissoes = excluded.permissoes, atualizado_em = now()`,
        [
          tenant,
          lojas.map((l) => l.lojaId),
          lojas.map((l) => l.nome),
          lojas.map((l) => cifrar(l.ligacao)),
          lojas.map((l) => l.prefixo ?? ''),
          lojas.map((l) => l.permissoes.join(' ')),
        ],
      );
      const uso = lojaEmUso(lojas, atual?.origem === 'clique' ? atual.loja_regem_id : null);
      const mudou = !atual || atual.origem !== 'clique' || atual.loja_regem_id !== uso.lojaId;
      await q(
        `insert into conexao_regem (tenant_id, base_url, token_cifrado, origem, loja_regem_id, loja_regem_nome)
         values ($1, $2, $3, 'clique', $4, $5)
         on conflict (tenant_id) do update
           set base_url = excluded.base_url, token_cifrado = excluded.token_cifrado, origem = 'clique',
               loja_regem_id = excluded.loja_regem_id, loja_regem_nome = excluded.loja_regem_nome,
               ultimo_resumo = case when $6 then null else conexao_regem.ultimo_resumo end,
               ultima_importacao = case when $6 then null else conexao_regem.ultima_importacao end,
               atualizado_em = now()`,
        [tenant, api, cifrar(uso.ligacao), uso.lojaId, uso.nome, mudou],
      );
      return uso;
    });
  }

  // ───────────────────────────── as lojas ligadas ─────────────────────────────

  /** As lojas do Regem que esta conta tem ligadas pelo clique (para a tela escolher de qual importar). */
  async lojas(tenant: string): Promise<LojaDoRegem[]> {
    if (!this.store.temBanco) return [];
    const rows = await this.store.query(
      `select loja_regem_id, loja_regem_nome from conexao_regem_ligacao where tenant_id = $1 order by loja_regem_nome, loja_regem_id`,
      [tenant],
    );
    return rows.map((r) => ({ id: r.loja_regem_id, nome: r.loja_regem_nome ?? 'Loja do Regem' }));
  }

  /** Troca a loja do Regem em uso (só entre as que o presidente ligou a ESTA conta). O resumo da outra loja não vale. */
  async escolher(tenant: string, lojaId: unknown): Promise<LojaDoRegem> {
    if (!this.store.temBanco) throw new Error('banco indisponível');
    const id = typeof lojaId === 'string' ? lojaId.trim() : '';
    if (!id || id.length > 100) throw new Error('Escolha uma loja do Regem da lista.');
    const [l] = await this.store.query(
      `update conexao_regem c
          set token_cifrado = g.ligacao_cifrada, loja_regem_id = g.loja_regem_id, loja_regem_nome = g.loja_regem_nome,
              ultimo_resumo = case when c.loja_regem_id is distinct from g.loja_regem_id then null else c.ultimo_resumo end,
              ultima_importacao = case when c.loja_regem_id is distinct from g.loja_regem_id then null else c.ultima_importacao end,
              atualizado_em = now()
         from conexao_regem_ligacao g
        where c.tenant_id = $1 and c.origem = 'clique' and g.tenant_id = c.tenant_id and g.loja_regem_id = $2
        returning g.loja_regem_id, g.loja_regem_nome`,
      [tenant, id],
    );
    if (!l) throw new Error('Essa loja do Regem não está ligada a esta conta.');
    return { id: l.loja_regem_id, nome: l.loja_regem_nome ?? 'Loja do Regem' };
  }
}
