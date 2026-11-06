/**
 * A ligação da porta MCP no banco (`ligacao_dms`), com `pg` cru (o Orzuni não
 * usa Drizzle). `autenticarLigacao` reconhece quem chega pela via do DMS ID;
 * `trocarPorLigacao` é o atalho F2-3 (o Regem manda o token do DMS ID + uma
 * chave `orz_live_` da conta e recebe o `dms_lg_orzuni_`).
 */
import { Injectable } from '@nestjs/common';

import { ApiKeyService } from '../auth/api-key.service';
import { ContaService } from '../conta/conta.service';
import { StoreService } from '../store/store.service';
import { ErroProblema, gerarChave, resumoChave, type TokenDmsId } from '../dms/integracao-dms';
import { CONTA_BLOQUEADA, LIGACAO_INVALIDA, ligacaoVale, mapearEscoposRest, permissoesDaLigacao, TROCA_RECUSADA } from './ligacao.regras';

/** Quem chama, já conferido: a loja (merchant) da ligação e as permissões que valem. */
export interface IntegracaoAutenticada {
  ligacaoId: string;
  tenantId: string;
  contaId: string;
  merchantId: string;
  aplicativo: string;
  produto: string;
  classe: string;
  nome: string;
  /** O prefixo visível da ligação (`dms_lg_orzuni_…`), para o registro do hub — nunca o segredo. */
  prefixo: string;
  escopos: string[];
}

export interface LigacaoEntregue {
  ligacao: string;
  prefixo: string;
  conta_id: string;
  loja: string;
  permissoes: string[];
  segredo_em: string;
}

@Injectable()
export class LigacaoService {
  constructor(
    private readonly store: StoreService,
    private readonly contas: ContaService,
    private readonly chaves: ApiKeyService,
  ) {}

  /**
   * Reconhece a ligação, com o token já conferido (`DmsIdService.conferir`).
   * Ausente, inexistente, revogada ou de outro aplicativo: 401 `ligacao-invalida`,
   * a mesma resposta para todos. Loja revogada: 403 `conta-bloqueada`.
   */
  async autenticarLigacao(
    segredo: string | null,
    doToken: Pick<TokenDmsId, 'aplicativo' | 'permissoes'>,
    aplicativos: Readonly<Record<string, string>>,
  ): Promise<IntegracaoAutenticada> {
    if (!segredo) throw new ErroProblema('ligacao-invalida', LIGACAO_INVALIDA);
    const resumo = resumoChave(segredo);
    const rows = await this.store.query(
      `select l.id, l.tenant_id, l.conta_id, l.aplicativo, l.produto, l.classe, l.escopos, l.revogada_em, l.prefixo,
              c.merchant_id, c.status as conta_status
         from ligacao_dms l join conta_ifood c on c.id = l.conta_id
        where l.segredo_hash = $1 limit 1`,
      [resumo],
    );
    const r = rows[0];
    const l = r ? { aplicativo: r.aplicativo, classe: r.classe, escopos: r.escopos, revogadaEm: r.revogada_em } : undefined;
    if (!ligacaoVale(l, doToken.aplicativo, aplicativos)) throw new ErroProblema('ligacao-invalida', LIGACAO_INVALIDA);
    if (r.conta_status !== 'connected') throw new ErroProblema('conta-bloqueada', CONTA_BLOQUEADA);

    this.store
      .query(`update ligacao_dms set ultimo_uso_em = now() where id = $1 and (ultimo_uso_em is null or ultimo_uso_em < now() - interval '1 minute')`, [r.id])
      .catch(() => {});

    return {
      ligacaoId: r.id,
      tenantId: r.tenant_id,
      contaId: r.conta_id,
      merchantId: r.merchant_id,
      aplicativo: r.aplicativo,
      produto: r.produto,
      classe: r.classe,
      nome: r.produto,
      prefixo: r.prefixo,
      escopos: permissoesDaLigacao(l!, doToken.permissoes),
    };
  }

  /**
   * O atalho F2-3: a chave `orz_live_` diz a loja; o token do DMS ID diz o
   * aplicativo. Repetir GIRA o segredo (uma ligação ativa por loja e aplicativo).
   */
  async trocarPorLigacao(chaveOrzuni: unknown, aplicativo: string, aplicativos: Readonly<Record<string, string>>): Promise<LigacaoEntregue> {
    if (typeof chaveOrzuni !== 'string' || !/^orz_live_[0-9a-f]{32,}$/.test(chaveOrzuni)) throw new ErroProblema('ligacao-invalida', TROCA_RECUSADA);
    if (!Object.values(aplicativos).includes(aplicativo)) throw new ErroProblema('ligacao-invalida', TROCA_RECUSADA);
    const info = await this.chaves.validarTabela(chaveOrzuni);
    if (!info || !info.merchantId) throw new ErroProblema('ligacao-invalida', TROCA_RECUSADA);
    const contaId = await this.contas.contaIdDe(info.merchantId);
    if (!contaId) throw new ErroProblema('ligacao-invalida', TROCA_RECUSADA);

    const cr = await this.store.query(`select tenant_id, status from conta_ifood where id = $1 limit 1`, [contaId]);
    if (!cr[0] || cr[0].status !== 'connected') throw new ErroProblema('conta-bloqueada', CONTA_BLOQUEADA);

    const escopos = mapearEscoposRest(info.escopos);
    // O produto consumidor sai do próprio aplicativo (o mapa DMS_ID_APLICATIVOS), não fixo:
    // o atalho vale para qualquer app DMS cadastrado, não só o Regem.
    const produto = Object.keys(aplicativos).find((p) => aplicativos[p] === aplicativo) ?? 'orzuni';
    const { chave, resumo, prefixo } = gerarChave('lg', 'orzuni');
    const agora = new Date();
    await this.store.query(
      `insert into ligacao_dms (tenant_id, conta_id, aplicativo, produto, classe, segredo_hash, prefixo, escopos, segredo_em)
       values ($1,$2,$3,$4,'dms',$5,$6,$7::jsonb, now())
       on conflict (conta_id, aplicativo) where revogada_em is null
       do update set segredo_hash = excluded.segredo_hash, prefixo = excluded.prefixo, escopos = excluded.escopos, segredo_em = now()`,
      [cr[0].tenant_id, contaId, aplicativo, produto, resumo, prefixo, JSON.stringify(escopos)],
    );

    return { ligacao: chave, prefixo, conta_id: contaId, loja: info.merchantId, permissoes: escopos, segredo_em: agora.toISOString() };
  }

  /** O aplicativo desliga a própria ligação: para de valer na chamada seguinte. */
  async revogarPeloProprio(quem: IntegracaoAutenticada): Promise<Date> {
    await this.store.query(`update ligacao_dms set revogada_em = now(), revogada_por = 'proprio' where id = $1 and revogada_em is null`, [quem.ligacaoId]);
    return new Date();
  }
}
