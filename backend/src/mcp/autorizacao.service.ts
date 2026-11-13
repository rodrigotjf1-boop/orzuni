/**
 * A autorização por clique do Orzuni (Padrão DMS §3), com o banco (`pg` cru, como o resto do Orzuni).
 *
 * Do lado do APLICATIVO (token do DMS ID): `pedir` (o pedido empurrado) e `trocar` (o código pela ligação).
 * Do lado do DONO DA CONTA (sessão do app web): `lerParaTela`, `autorizar` e `recusar`, e a lista de "Aplicativos
 * conectados" com o desligar.
 *
 * A ligação que nasce é a MESMA do atalho de hoje (`ligacao_dms`, uma ativa por loja e aplicativo): a porta MCP não
 * muda. Nada nasce no clique: a ligação só existe quando o aplicativo troca o código.
 */
import { Injectable, Logger } from '@nestjs/common';

import { ErroProblema, gerarChave, type TokenDmsId } from '../dms/integracao-dms';
import { HubService } from '../hub/hub.service';
import { StoreService } from '../store/store.service';
import { UsuarioService } from '../usuario/usuario.service';
import {
  APLICATIVOS_DO_CLIQUE,
  type AplicativoDoClique,
  cnpjComMascara,
  conferirPedido,
  type ContaQuePede,
  escoposDaTroca,
  formatoDoCodigo,
  formatoDoPedido,
  gerarCodigo,
  gerarPedido,
  MAX_ERROS_SENHA,
  MINUTOS_DA_TRAVA,
  naOrdemDoCatalogo,
  opcionaisLigadas,
  type PermissaoDaTela,
  permissoesDaTela,
  resumoDe,
  textoDaAutorizacao,
  urlDeVolta,
  VALIDADE_DO_CODIGO_MS,
  VALIDADE_DO_PEDIDO_MS,
  VERSAO_DO_TEXTO,
  verificadorConfere,
  voltasDoProduto,
} from './autorizacao.regras';
import { porta } from './config';
import { PERMISSOES } from './ligacao.regras';

/** Quem está na página: a sessão do app web (o `SessaoGuard` já conferiu). */
export interface DonoDaSessao {
  id: string;
  tenant: string;
  email: string;
}

/** Uma loja do iFood da conta, como a página mostra: livre, já ligada a esta loja do aplicativo, ou a outra. */
export interface LojaDaTela {
  id: string;
  nome: string;
  /** `livre`; `esta` = já ligada a ESTA loja do aplicativo (pedir mais); `chave` = ligada pela chave antiga, sem dono
   *  conhecido (a nova substitui); `outra` = ligada a OUTRA loja do aplicativo (não se escolhe). */
  situacao: 'livre' | 'esta' | 'chave' | 'outra';
  outraLoja: string | null;
}

export interface TelaDoPedido {
  aplicativo: { nome: string; empresa: string; verificado: boolean };
  contaPede: { nome: string; cnpj: string | null; email: string; marca: string | null; loja: string | null };
  /** O Orzuni não guarda o CNPJ da conta: sem como comparar, conta sempre como outra empresa (Padrão §3, C-3). */
  outraEmpresa: true;
  lojas: LojaDaTela[];
  permissoes: PermissaoDaTela[];
  naoPode: readonly string[];
  venceEm: string;
  /** Até quando a autorização fica travada pelas senhas erradas (nula: não está). */
  travadaAte: string | null;
}

export interface LigacaoDoClique {
  ligacao: string;
  prefixo: string;
  conta_id: string;
  loja: string;
  loja_nome: string;
  permissoes: string[];
  segredo_em: string;
}

/** Um aplicativo conectado, como o dono vê. Nunca o segredo. */
export interface AplicativoConectado {
  id: string;
  aplicativo: string;
  produto: string;
  loja: string;
  prefixo: string;
  via: 'clique' | 'chave';
  quemPediu: { nome: string | null; loja: string | null };
  permissoes: { id: string; frase: string }[];
  desde: string;
  ultimoUso: string | null;
  texto: string | null;
}

const PEDIDO_INVALIDO = 'O pedido de autorização não vale: vencido, já usado ou incompleto. Comece de novo pelo aplicativo.';
const CODIGO_INVALIDO = 'O código de autorização não vale: vencido, já usado ou de outro aplicativo. Comece a autorização de novo.';
const SEM_CLIQUE = 'Este aplicativo não está cadastrado para a autorização por clique do Orzuni.';
const PARADO = 'A DMS pausou este aplicativo: a autorização nova está recusada por enquanto.';
const SEM_BANCO = 'A autorização por clique precisa do banco do Orzuni, que não está ligado neste ambiente.';

@Injectable()
export class AutorizacaoService {
  private readonly log = new Logger(AutorizacaoService.name);

  constructor(
    private readonly store: StoreService,
    private readonly usuarios: UsuarioService,
    private readonly hub: HubService,
  ) {}

  /** O produto do client_id (o mapa da distribuição) e o cadastro dele no clique; nulo = não usa o clique. */
  private aplicativoDe(clientId: string): { produto: string; app: AplicativoDoClique } | null {
    const produto = Object.keys(porta.aplicativos).find((p) => porta.aplicativos[p] === clientId);
    const app = produto ? APLICATIVOS_DO_CLIQUE[produto] : undefined;
    return produto && app ? { produto, app } : null;
  }

  private parado(clientId: string): boolean {
    return !!this.hub.parado({ aplicativo: clientId });
  }

  private exigirBanco(): void {
    if (!this.store.temBanco) throw new ErroProblema('erro-interno', SEM_BANCO);
  }

  /** O emissor que vai na volta (RFC 9207): a origem da porta do Orzuni. */
  private get emissor(): string {
    return new URL(porta.recurso).origin;
  }

  /** O endereço da página de autorização (o app web), que o aplicativo abre com o número do pedido. */
  get enderecoDaPagina(): string {
    return `${(process.env.ORZUNI_APP_URL || 'https://app.orzuni.com').trim().replace(/\/+$/, '')}/autorizar`;
  }

  // ───────────────────────────── o lado do aplicativo ─────────────────────────────

  /** `POST /v1/dms-id/autorizacao/pedido`: o pedido empurrado. Devolve o número de uso único (10 minutos). */
  async pedir(doToken: TokenDmsId, corpo: unknown): Promise<{ request_uri: string; expires_in: number; authorization_endpoint: string }> {
    const a = this.aplicativoDe(doToken.aplicativo);
    if (!a) throw new ErroProblema('cliente-invalido', SEM_CLIQUE);
    if (this.parado(doToken.aplicativo)) throw new ErroProblema('integracao-parada', PARADO);
    this.exigirBanco();
    const c = conferirPedido(
      corpo !== null && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {},
      a.app,
      doToken.aplicativo,
      voltasDoProduto(a.produto),
    );
    if ('erro' in c) throw new ErroProblema('parametro-invalido', c.erro);

    // Pedidos vencidos há mais de um dia saem aqui (não há rotina para isso); nunca derruba o pedido novo.
    await this.store
      .query(`delete from autorizacao_pedido where vence_em < now() - interval '1 day' and (trocado_em is not null or codigo_hash is null)`)
      .catch((e) => this.log.warn(`limpeza dos pedidos vencidos falhou: ${e instanceof Error ? e.message : e}`));

    const { numero, hash } = gerarPedido();
    await this.store.query(
      `insert into autorizacao_pedido (numero_hash, aplicativo, produto, volta, estado, desafio, necessarias, opcionais, conta_pede, vence_em)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb, now() + make_interval(secs => $10))`,
      [hash, doToken.aplicativo, a.produto, c.volta, c.estado, c.desafio, JSON.stringify(c.necessarias), JSON.stringify(c.opcionais), JSON.stringify(c.contaPede), VALIDADE_DO_PEDIDO_MS / 1000],
    );
    return { request_uri: numero, expires_in: VALIDADE_DO_PEDIDO_MS / 1000, authorization_endpoint: this.enderecoDaPagina };
  }

  /**
   * `POST /v1/dms-id/autorizacao/token`: troca o código pela ligação. O código é gasto ANTES de qualquer conferência
   * (de duas trocas só uma leva; a que falha depois também gasta), e o código usado de novo desliga o que ele criou.
   * Na transação: a ligação ativa da loja com este aplicativo é trocada (segredo novo), com o que ela já tinha somado ao
   * que foi concedido agora.
   */
  async trocar(doToken: TokenDmsId, corpo: unknown): Promise<LigacaoDoClique> {
    const a = this.aplicativoDe(doToken.aplicativo);
    if (!a) throw new ErroProblema('cliente-invalido', SEM_CLIQUE);
    if (this.parado(doToken.aplicativo)) throw new ErroProblema('integracao-parada', PARADO);
    this.exigirBanco();
    const b = (corpo !== null && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    const recusar = (motivo: string): never => {
      this.log.warn(`troca do código do clique recusada (${a.produto}): ${motivo}`);
      throw new ErroProblema('autorizacao-invalida', CODIGO_INVALIDO);
    };
    if (b.grant_type !== 'authorization_code') throw new ErroProblema('parametro-invalido', 'grant_type precisa ser "authorization_code".');
    if (b.client_id !== undefined && b.client_id !== doToken.aplicativo) return recusar('client_id diferente do token do DMS ID');
    if (!formatoDoCodigo(b.code)) return recusar('código fora do formato');
    const hash = resumoDe(b.code);

    const feito = await this.store.transacao(async (q) => {
      const [p] = await q(
        `update autorizacao_pedido set trocado_em = now()
          where codigo_hash = $1 and aplicativo = $2 and trocado_em is null and recusado = false and codigo_vence_em > now()
          returning id, tenant_id, conta_id, concedidas, volta, desafio, conta_pede, produto`,
        [hash, doToken.aplicativo],
      );
      if (!p) return { reuso: true as const };
      if (b.redirect_uri !== p.volta) return { recusa: 'endereço de volta diferente do do pedido' };
      if (!verificadorConfere(b.code_verifier, p.desafio)) return { recusa: 'o verificador do PKCE não confere' };

      const [conta] = await q(`select id, merchant_id, nome, status from conta_ifood where id = $1 and tenant_id = $2`, [p.conta_id, p.tenant_id]);
      if (!conta || conta.status !== 'connected') return { recusa: 'a loja foi desconectada depois da autorização' };

      const contaPede = p.conta_pede as ContaQuePede;
      const [atual] = await q(
        `select id, escopos, conta_pede from ligacao_dms where conta_id = $1 and aplicativo = $2 and revogada_em is null for update`,
        [conta.id, doToken.aplicativo],
      );
      const lojaAtual = atual?.conta_pede?.loja_id ?? null;
      if (atual && lojaAtual && contaPede.loja_id && lojaAtual !== contaPede.loja_id) {
        return { recusa: 'a loja do iFood ficou ligada a outra loja do aplicativo depois da autorização' };
      }
      // Pedir mais = o que a ligação já tinha + o concedido agora (a mesma loja do aplicativo). Ligação pela chave antiga,
      // sem dono conhecido, não soma: a do clique vale pelo que o dono acabou de ler.
      const mesmaLoja = !!atual && !!lojaAtual && lojaAtual === contaPede.loja_id;
      const escopos = escoposDaTroca(mesmaLoja ? atual.escopos : [], p.concedidas ?? []);
      if (!escopos.length) return { recusa: 'nada do que foi concedido cabe no teto do aplicativo' };

      const { chave, resumo, prefixo } = gerarChave('lg', 'orzuni');
      const [lig] = await q(
        `insert into ligacao_dms (tenant_id, conta_id, aplicativo, produto, classe, segredo_hash, prefixo, escopos, segredo_em, conta_pede, autorizacao_id)
         values ($1,$2,$3,$4,'dms',$5,$6,$7::jsonb, now(), $8::jsonb, $9)
         on conflict (conta_id, aplicativo) where revogada_em is null
         do update set segredo_hash = excluded.segredo_hash, prefixo = excluded.prefixo, escopos = excluded.escopos, segredo_em = now(),
                       conta_pede = excluded.conta_pede, autorizacao_id = excluded.autorizacao_id, produto = excluded.produto
         returning id, segredo_em`,
        [p.tenant_id, conta.id, doToken.aplicativo, p.produto, resumo, prefixo, JSON.stringify(escopos), JSON.stringify(contaPede), p.id],
      );
      await q(`update autorizacao_pedido set ligacao_id = $1 where id = $2`, [lig.id, p.id]);
      return {
        ok: {
          ligacao: chave,
          prefixo,
          conta_id: conta.id as string,
          loja: conta.merchant_id as string,
          loja_nome: (conta.nome as string) ?? '',
          permissoes: escopos,
          segredo_em: new Date(lig.segredo_em).toISOString(),
        },
      };
    });

    if ('ok' in feito && feito.ok) return feito.ok;
    if ('reuso' in feito) {
      // O mesmo código de novo: desliga o que ele criou (alguém pode ter copiado o código no caminho).
      await this.store
        .query(
          `update ligacao_dms set revogada_em = now(), revogada_por = 'codigo-reusado'
            where revogada_em is null and id = (select ligacao_id from autorizacao_pedido where codigo_hash = $1 and trocado_em is not null)`,
          [hash],
        )
        .catch((e) => this.log.error(`desligar pelo reuso do código falhou: ${e instanceof Error ? e.message : e}`));
      return recusar('código desconhecido, vencido, recusado, já usado ou de outro aplicativo');
    }
    return recusar(feito.recusa as string);
  }

  // ───────────────────────────── o lado do dono da conta ─────────────────────────────

  /** O pedido vivo pelo número, ou nulo (fora do formato, desconhecido, decidido ou vencido). */
  private async pedidoVivo(numero: unknown): Promise<any | null> {
    if (!formatoDoPedido(numero)) return null;
    const [p] = await this.store.query(
      `select id, aplicativo, produto, volta, estado, necessarias, opcionais, conta_pede, vence_em
         from autorizacao_pedido where numero_hash = $1 and decidido_em is null and vence_em > now()`,
      [resumoDe(numero)],
    );
    return p ?? null;
  }

  /** A volta para quando o pedido não vale mais: ao endereço guardado do aplicativo, nunca a um que veio no link. */
  private async voltaDoPedidoMorto(numero: unknown): Promise<string | null> {
    if (!formatoDoPedido(numero)) return null;
    const [p] = await this.store.query(`select volta, estado from autorizacao_pedido where numero_hash = $1`, [resumoDe(numero)]);
    return p ? urlDeVolta(p.volta, { error: 'invalid_request_uri', state: p.estado, iss: this.emissor }) : null;
  }

  private async travadaAte(usuarioId: string): Promise<Date | null> {
    const [r] = await this.store.query(
      `select count(*)::int as n, max(em) as ultima from autorizacao_senha_erro
        where usuario_id = $1 and em > now() - make_interval(mins => $2)`,
      [usuarioId, MINUTOS_DA_TRAVA],
    );
    if (!r || r.n < MAX_ERROS_SENHA) return null;
    return new Date(new Date(r.ultima).getTime() + MINUTOS_DA_TRAVA * 60_000);
  }

  private async lojasDaTela(tenant: string, aplicativo: string, contaPede: ContaQuePede): Promise<LojaDaTela[]> {
    const rows = await this.store.query(
      `select c.id, c.nome, c.merchant_id, l.id as ligacao_id, l.conta_pede
         from conta_ifood c
         left join ligacao_dms l on l.conta_id = c.id and l.aplicativo = $2 and l.revogada_em is null
        where c.tenant_id = $1 and c.status = 'connected'
        order by c.nome nulls last, c.criado_em`,
      [tenant, aplicativo],
    );
    return rows.map((r: any) => {
      const lojaDela: string | null = r.conta_pede?.loja_id ?? null;
      let situacao: LojaDaTela['situacao'] = 'livre';
      if (r.ligacao_id) {
        if (!lojaDela) situacao = 'chave';
        else if (contaPede.loja_id && lojaDela === contaPede.loja_id) situacao = 'esta';
        else situacao = 'outra';
      }
      return { id: r.id, nome: r.nome || r.merchant_id, situacao, outraLoja: situacao === 'outra' ? (r.conta_pede?.loja ?? null) : null };
    });
  }

  /** `GET /v1/autorizacao/pedido?numero=…`: o que a página mostra. Pedido morto: 404 com a volta do aplicativo. */
  async lerParaTela(dono: DonoDaSessao, numero: unknown): Promise<TelaDoPedido | { erro: string; voltar: string | null }> {
    this.exigirBanco();
    const p = await this.pedidoVivo(numero);
    if (!p) return { erro: PEDIDO_INVALIDO, voltar: await this.voltaDoPedidoMorto(numero) };
    const a = this.aplicativoDe(p.aplicativo);
    if (!a) return { erro: SEM_CLIQUE, voltar: null };
    if (this.parado(p.aplicativo)) return { erro: PARADO, voltar: null };
    const contaPede = p.conta_pede as ContaQuePede;
    const trava = await this.travadaAte(dono.id);
    return {
      aplicativo: { nome: a.app.nome, empresa: a.app.empresa, verificado: a.app.verificado },
      contaPede: { nome: contaPede.nome, cnpj: cnpjComMascara(contaPede.cnpj), email: contaPede.email, marca: contaPede.marca, loja: contaPede.loja },
      outraEmpresa: true,
      lojas: await this.lojasDaTela(dono.tenant, p.aplicativo, contaPede),
      permissoes: permissoesDaTela(a.app, p.necessarias ?? [], p.opcionais ?? []),
      naoPode: a.app.naoPode,
      venceEm: new Date(p.vence_em).toISOString(),
      travadaAte: trava ? trava.toISOString() : null,
    };
  }

  /**
   * `POST /v1/autorizacao/autorizar`: confere a senha (nunca o PIN), a loja da conta e a confirmação de outra empresa;
   * grava a decisão com o texto mostrado e devolve a volta com o código de uso único (10 minutos).
   */
  async autorizar(dono: DonoDaSessao, corpo: unknown): Promise<{ redirect: string }> {
    this.exigirBanco();
    const b = (corpo !== null && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    const p = await this.pedidoVivo(b.pedido);
    if (!p) throw new ErroProblema('autorizacao-invalida', PEDIDO_INVALIDO);
    const a = this.aplicativoDe(p.aplicativo);
    if (!a) throw new ErroProblema('cliente-invalido', SEM_CLIQUE);
    if (this.parado(p.aplicativo)) throw new ErroProblema('integracao-parada', PARADO);

    const trava = await this.travadaAte(dono.id);
    if (trava) {
      const seg = Math.max(1, Math.ceil((trava.getTime() - Date.now()) / 1000));
      throw new ErroProblema('limite-de-chamadas', `Muitas senhas erradas: a autorização fica travada por ${MINUTOS_DA_TRAVA} minutos. O login no Orzuni continua normal.`, { retryAfterSeg: seg });
    }
    const senha = typeof b.senha === 'string' ? b.senha : '';
    const conferido = senha ? await this.usuarios.autenticar(dono.email, senha) : null;
    if (!conferido || conferido.id !== dono.id) {
      await this.store.query(`insert into autorizacao_senha_erro (usuario_id) values ($1)`, [dono.id]);
      const [r] = await this.store.query(
        `select count(*)::int as n from autorizacao_senha_erro where usuario_id = $1 and em > now() - make_interval(mins => $2)`,
        [dono.id, MINUTOS_DA_TRAVA],
      );
      const faltam = Math.max(0, MAX_ERROS_SENHA - (r?.n ?? MAX_ERROS_SENHA));
      throw new ErroProblema(
        'regra-invalida',
        faltam > 0
          ? `Senha errada. Mais ${faltam} ${faltam === 1 ? 'tentativa' : 'tentativas'} e a autorização trava por ${MINUTOS_DA_TRAVA} minutos.`
          : `Senha errada. A autorização ficou travada por ${MINUTOS_DA_TRAVA} minutos.`,
      );
    }
    if (b.confirmo_outra_empresa !== true) {
      throw new ErroProblema('regra-invalida', 'Confirme que essa empresa pode mexer no cardápio desta loja do iFood.');
    }

    const contaPede = p.conta_pede as ContaQuePede;
    const lojas = await this.lojasDaTela(dono.tenant, p.aplicativo, contaPede);
    const loja = lojas.find((l) => l.id === b.loja);
    if (!loja) throw new ErroProblema('nao-encontrado', 'Escolha uma loja do iFood desta conta.');
    if (loja.situacao === 'outra') {
      throw new ErroProblema('regra-invalida', `Essa loja do iFood já está ligada a outra loja do ${a.app.nome}. Desligue lá primeiro, ou escolha outra.`);
    }

    const concedidas = naOrdemDoCatalogo([...(p.necessarias ?? []), ...opcionaisLigadas(p.opcionais ?? [], b.opcionais)]);
    const texto = textoDaAutorizacao({ app: a.app, contaPede, lojaNome: loja.nome, concedidas });
    const { codigo, hash } = gerarCodigo();
    const [feito] = await this.store.query(
      `update autorizacao_pedido
          set decidido_em = now(), recusado = false, tenant_id = $2, usuario_id = $3, conta_id = $4, concedidas = $5::jsonb,
              texto = $6, versao_texto = $7, codigo_hash = $8, codigo_vence_em = now() + make_interval(secs => $9)
        where id = $1 and decidido_em is null and vence_em > now()
        returning volta, estado`,
      [p.id, dono.tenant, dono.id, loja.id, JSON.stringify(concedidas), texto, VERSAO_DO_TEXTO, hash, VALIDADE_DO_CODIGO_MS / 1000],
    );
    if (!feito) throw new ErroProblema('autorizacao-invalida', PEDIDO_INVALIDO);
    await this.store.query(`delete from autorizacao_senha_erro where usuario_id = $1`, [dono.id]).catch(() => {});
    return { redirect: urlDeVolta(feito.volta, { code: codigo, state: feito.estado, iss: this.emissor }) };
  }

  /** `POST /v1/autorizacao/recusar`: "Agora não". Gasta o pedido e volta com `access_denied`; nada muda na ligação. */
  async recusar(dono: DonoDaSessao, corpo: unknown): Promise<{ redirect: string | null }> {
    this.exigirBanco();
    const b = (corpo !== null && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    if (!formatoDoPedido(b.pedido)) return { redirect: null };
    const [feito] = await this.store.query(
      `update autorizacao_pedido set decidido_em = now(), recusado = true, usuario_id = $2, tenant_id = $3
        where numero_hash = $1 and decidido_em is null
        returning volta, estado`,
      [resumoDe(b.pedido), dono.id, dono.tenant],
    );
    if (!feito) return { redirect: await this.voltaDoPedidoMorto(b.pedido) };
    return { redirect: urlDeVolta(feito.volta, { error: 'access_denied', state: feito.estado, iss: this.emissor }) };
  }

  /** `GET /v1/aplicativos-conectados`: as ligações vivas das lojas desta conta, com o texto que o dono leu. */
  async conectados(dono: DonoDaSessao): Promise<AplicativoConectado[]> {
    this.exigirBanco();
    const rows = await this.store.query(
      `select l.id, l.aplicativo, l.produto, l.prefixo, l.escopos, l.criado_em, l.ultimo_uso_em, l.conta_pede, l.autorizacao_id,
              c.nome as loja_nome, c.merchant_id, a.texto
         from ligacao_dms l
         join conta_ifood c on c.id = l.conta_id
         left join autorizacao_pedido a on a.id = l.autorizacao_id
        where l.tenant_id = $1 and l.revogada_em is null
        order by c.nome nulls last, l.criado_em`,
      [dono.tenant],
    );
    const frase = new Map(PERMISSOES.map((p) => [p.id, p.frase]));
    return rows.map((r: any) => ({
      id: r.id,
      aplicativo: APLICATIVOS_DO_CLIQUE[r.produto]?.nome ?? r.produto,
      produto: r.produto,
      loja: r.loja_nome || r.merchant_id,
      prefixo: r.prefixo,
      via: r.autorizacao_id ? 'clique' : 'chave',
      quemPediu: { nome: r.conta_pede?.nome ?? null, loja: r.conta_pede?.loja ?? null },
      permissoes: naOrdemDoCatalogo(Array.isArray(r.escopos) ? r.escopos : []).map((id) => ({ id, frase: frase.get(id) ?? id })),
      desde: new Date(r.criado_em).toISOString(),
      ultimoUso: r.ultimo_uso_em ? new Date(r.ultimo_uso_em).toISOString() : null,
      texto: r.texto ?? null,
    }));
  }

  /** `POST /v1/aplicativos-conectados/desligar`: o dono desliga; vale na chamada seguinte. Repetir não dá erro. */
  async desligar(dono: DonoDaSessao, corpo: unknown): Promise<{ ok: true }> {
    this.exigirBanco();
    const id = (corpo !== null && typeof corpo === 'object' ? (corpo as { id?: unknown }).id : undefined) ?? '';
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new ErroProblema('parametro-invalido', 'Informe o aplicativo a desligar.');
    const [l] = await this.store.query(`select id, revogada_em from ligacao_dms where id = $1 and tenant_id = $2`, [id, dono.tenant]);
    if (!l) throw new ErroProblema('nao-encontrado', 'Esse aplicativo não está conectado a esta conta.');
    await this.store.query(
      `update ligacao_dms set revogada_em = now(), revogada_por = $3 where id = $1 and tenant_id = $2 and revogada_em is null`,
      [id, dono.tenant, `dono:${dono.email}`.slice(0, 120)],
    );
    return { ok: true };
  }
}
