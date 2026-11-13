import { Injectable, Logger } from '@nestjs/common';

import { CatalogoService } from '../catalogo/catalogo.service';
import type { DadosItem } from '../catalogo/validacao';
import { ContaService } from '../conta/conta.service';
import { StoreService } from '../store/store.service';
import { cifrar, decifrar } from '../common/cifra';
import { type LojaDoRegem, RegemCliqueService } from './regem-clique.service';

// IMPORTAÇÃO DO CARDÁPIO DO REGEM → iFood (pelo Orzuni), Fase 1. Contrato do Regem #854
// (docs/integracao-orzuni.md do Regem): a API de integração de LEITURA do catálogo.
//
//   GET {BASE}/api/v1/integracao/catalogo?versao=<versao>
//   Authorization: Bearer rgm_it_…   (token DA LOJA, emitido no console do Regem p/ "Orzuni")
//
// DESDE A MIGRATION 011 a conexão também nasce pelo CLIQUE ("Conectar pelo Regem", `regem-clique.service.ts`): aí a
// credencial é a da via do DMS ID, `Authorization: Bearer <token do DMS ID do Orzuni>` + `DMS-Ligacao: dms_lg_regem_…`
// (a ligação da loja, cifrada no mesmo campo). `conexao_regem.origem` diz qual das duas vale.
//
// A BASE é FIXA (não vem do usuário) — por padrão https://api.dmsregem.com, com override só pela
// env da distribuição (homologação). O token vem do usuário e fica CIFRADO (common/cifra.ts).
//
// Resposta (envelope `responderComVersao` do Regem):
//   nada mudou:  { versao, atualizado: false }
//   mudou:       { versao, atualizado: true, gerado_em, produtos:[…], categorias:[…], … }
//
// No PRODUTO (snake_case): `codigo` (PDV), `preco_ifood_centavos` (inteiro|null) e `no_ifood`
// (true = ESTÁ no iFood). Na OPÇÃO (adicionais[].opcoes[]): `preco_ifood_centavos`.
// Importa SÓ produto com `no_ifood === true` e preço preenchido, preço = centavos / 100.

const REGEM_BASE = (process.env.ORZUNI_REGEM_BASE || 'https://api.dmsregem.com').replace(/\/+$/, '');
const CAMINHO_CATALOGO = '/api/v1/integracao/catalogo';

/** Opção reutilizável de um adicional, como o contrato do Regem entrega. */
interface OpcaoRegem {
  nome?: string;
  codigo?: string | null; // código PDV da opção (chave de ligação)
  preco_ifood_centavos?: number | null; // null/ausente = não vai ao iFood
}

/** Um produto do catálogo do Regem (só o que o Orzuni usa para montar o item no iFood). */
interface ProdutoRegem {
  codigo?: string | null; // código PDV (chave de ligação)
  nome?: string;
  descricao?: string | null;
  categoria_id?: string | null;
  preco_ifood_centavos?: number | null; // null/ausente = NÃO enviar ao iFood
  no_ifood?: boolean; // true = ESTÁ no iFood → importar; !== true = não vai ao iFood
  adicionais?: Array<{
    nome?: string;
    min?: number | null;
    max?: number | null;
    opcoes?: OpcaoRegem[];
  }>;
}

/** O envelope que a rota de catálogo devolve. */
interface RespostaCatalogo {
  versao?: string;
  atualizado?: boolean;
  produtos?: ProdutoRegem[];
  categorias?: Array<{ id?: string; nome?: string }>;
}

export interface ResumoImportacao {
  criados: number;
  jaExistiam: number;
  semCodigo: number;
  semPrecoIfoodOuNoIfood: number; // não marcados para o iFood ou sem preço no iFood
  falhas: Array<{ codigo: string; erro?: string }>;
  nadaMudou?: boolean; // o Regem respondeu "nada mudou desde a última importação"
}

/** Centavos (inteiro) → reais, sem erro de ponto flutuante. */
export function centavosParaReais(centavos: unknown): number {
  return Math.round(Number(centavos)) / 100;
}

/**
 * Classifica os produtos do Regem contra os códigos PDV JÁ existentes no iFood.
 * Regra do dono (contrato #854): importar SÓ `no_ifood === true` E com preço preenchido; sem código
 * não dá para ligar; o que já existe no iFood NÃO é tocado (só cria os que faltam). Função PURA.
 */
export function classificarImportacao(
  produtos: ProdutoRegem[] | undefined,
  existentes: Set<string>,
): { aCriar: ProdutoRegem[]; jaExistiam: number; semCodigo: number; semPreco: number } {
  const aCriar: ProdutoRegem[] = [];
  let jaExistiam = 0;
  let semCodigo = 0;
  let semPreco = 0;
  for (const p of produtos ?? []) {
    // não marcado para o iFood, ou sem preço no iFood → não vai
    if (p?.no_ifood !== true || p?.preco_ifood_centavos == null) {
      semPreco++;
      continue;
    }
    const codigo = String(p?.codigo ?? '').trim();
    if (!codigo) {
      semCodigo++;
      continue;
    }
    if (existentes.has(codigo)) {
      jaExistiam++;
      continue;
    }
    aCriar.push(p);
  }
  return { aCriar, jaExistiam, semCodigo, semPreco };
}

/**
 * Monta o item do iFood a partir de um produto do Regem. Preço e preço das opções vêm em CENTAVOS
 * (÷100). Só vão ao iFood as opções COM preço preenchido (regra do dono). Função PURA.
 */
export function montarItemIfood(p: ProdutoRegem, categoriaNome: Map<string, string>): DadosItem {
  const complementos = (p.adicionais ?? [])
    .map((g) => ({
      grupo: g.nome ?? 'Complemento',
      min: Number(g.min ?? 0),
      // só as opções com preço iFood vão ao iFood
      opcoes: (g.opcoes ?? [])
        .filter((o) => o.preco_ifood_centavos != null)
        .map((o) => ({ nome: o.nome ?? '', preco: centavosParaReais(o.preco_ifood_centavos), ...(o.codigo ? { pdv: String(o.codigo) } : {}) })),
      _max: g.max,
    }))
    .filter((g) => g.opcoes.length > 0)
    // max nulo com opções → cabe todas (evita max 0, que o iFood recusa)
    .map((g) => ({ grupo: g.grupo, min: g.min, max: g._max == null ? g.opcoes.length : Number(g._max), opcoes: g.opcoes }));
  return {
    nome: p.nome,
    ...(p.descricao ? { descricao: p.descricao } : {}),
    preco: centavosParaReais(p.preco_ifood_centavos),
    categoria: (p.categoria_id && categoriaNome.get(p.categoria_id)) || 'Cardápio',
    pdv: String(p.codigo),
    ...(complementos.length ? { complementos } : {}),
  };
}

/**
 * Importa o cardápio do Regem para o iFood (pelo Orzuni), casando por código PDV.
 * Nasce INERTE: sem a conexão configurada (`conexao_regem`), nada acontece. Só o
 * dono da conta (sessão) chama, e a loja/tenant vêm sempre da sessão (nunca do body).
 */
@Injectable()
export class ImportacaoRegemService {
  private readonly logger = new Logger('importacao-regem');
  constructor(
    private readonly store: StoreService,
    private readonly contas: ContaService,
    private readonly catalogo: CatalogoService,
    private readonly clique: RegemCliqueService,
  ) {}

  /** Conecta a leitura do Regem pela CHAVE colada: testa o token na API de integração e o guarda CIFRADO. */
  async conectar(tenant: string, token: string): Promise<{ ok: boolean; produtos?: number; erro?: string }> {
    if (!this.store.temBanco) return { ok: false, erro: 'banco indisponível' };
    const segredo = (token ?? '').trim();
    if (!segredo) return { ok: false, erro: 'informe a chave de integração do Regem' };
    const dados = await this.buscar({ token: segredo, origem: 'chave' }); // valida a chave antes de salvar (401/403 lançam)
    // A chave é de UMA loja que o Orzuni não sabe qual é: a conexão volta a ser "pela chave" (a loja do clique sai de uso
    // e o resumo da outra loja não vale mais).
    await this.store.query(
      `insert into conexao_regem (tenant_id, base_url, token_cifrado)
       values ($1, $2, $3)
       on conflict (tenant_id) do update
         set base_url = excluded.base_url, token_cifrado = excluded.token_cifrado,
             ultimo_resumo = case when conexao_regem.origem = 'clique' then null else conexao_regem.ultimo_resumo end,
             ultima_importacao = case when conexao_regem.origem = 'clique' then null else conexao_regem.ultima_importacao end,
             origem = 'chave', loja_regem_id = null, loja_regem_nome = null, atualizado_em = now()`,
      [tenant, REGEM_BASE, cifrar(segredo)],
    );
    return { ok: true, produtos: Array.isArray(dados?.produtos) ? dados.produtos.length : 0 };
  }

  /** Puxa o cardápio do Regem e cria no iFood só os produtos que faltam (por código PDV). */
  async importar(tenant: string): Promise<ResumoImportacao> {
    const conexao = await this.conexaoDe(tenant); // lança se não conectado
    const lojas = await this.contas.ativasDoTenant(tenant);
    const merchant = lojas[0]?.merchantId;
    if (!merchant) throw new Error('conecte uma loja do iFood antes de importar');

    const dados = await this.buscar(conexao, conexao.versaoAnterior);

    // "nada mudou desde a última importação" → nada a criar
    if (dados?.atualizado === false) {
      await this.store
        .query(`update conexao_regem set ultima_importacao = now(), atualizado_em = now() where tenant_id = $1`, [tenant])
        .catch((e) => this.logger.warn(`marcar importação falhou: ${e?.message ?? e}`));
      return { criados: 0, jaExistiam: 0, semCodigo: 0, semPrecoIfoodOuNoIfood: 0, falhas: [], nadaMudou: true };
    }

    const produtos: ProdutoRegem[] = Array.isArray(dados?.produtos) ? dados.produtos : [];
    const categoriaNome = new Map<string, string>();
    for (const c of dados?.categorias ?? []) {
      if (c?.id) categoriaNome.set(c.id, c.nome ?? 'Cardápio');
    }

    const existentes = new Set(
      (await this.catalogo.cardapio(merchant)).map((i) => i.pdv).filter((p): p is string => !!p),
    );
    const { aCriar, jaExistiam, semCodigo, semPreco } = classificarImportacao(produtos, existentes);

    let criados = 0;
    const falhas: Array<{ codigo: string; erro?: string }> = [];
    for (const p of aCriar) {
      const codigo = String(p.codigo).trim();
      const r = await this.catalogo.criarItem(merchant, montarItemIfood(p, categoriaNome));
      if (r.ok) criados++;
      else falhas.push({ codigo, erro: r.erro });
    }

    const resumo: ResumoImportacao = { criados, jaExistiam, semCodigo, semPrecoIfoodOuNoIfood: semPreco, falhas };
    // guarda o resumo e a VERSÃO do retrato (para o próximo ?versao=)
    await this.store
      .query(`update conexao_regem set ultima_importacao = now(), ultimo_resumo = $2, atualizado_em = now() where tenant_id = $1`, [
        tenant,
        JSON.stringify({ ...resumo, versao: dados?.versao ?? null }),
      ])
      .catch((e) => this.logger.warn(`gravar resumo falhou: ${e?.message ?? e}`));
    return resumo;
  }

  /**
   * Estado da conexão para a tela: conectado? por onde (chave colada ou clique)? qual loja do Regem está em uso e
   * quais a conta tem ligadas? o botão "Conectar pelo Regem" está disponível?
   */
  async status(tenant: string): Promise<{
    conectado: boolean;
    clique: boolean;
    origem?: 'chave' | 'clique';
    loja?: LojaDoRegem | null;
    lojas?: LojaDoRegem[];
    ultimaImportacao?: string;
    ultimoResumo?: unknown;
  }> {
    const clique = this.clique.disponivel;
    const rows = await this.store.query(
      `select ultima_importacao, ultimo_resumo, origem, loja_regem_id, loja_regem_nome from conexao_regem where tenant_id = $1`,
      [tenant],
    );
    if (!rows.length) return { conectado: false, clique };
    const resumo = rows[0].ultimo_resumo ?? undefined;
    // não devolve a `versao` interna do retrato para a tela
    if (resumo && typeof resumo === 'object') delete (resumo as Record<string, unknown>).versao;
    const peloClique = rows[0].origem === 'clique';
    return {
      conectado: true,
      clique,
      origem: peloClique ? 'clique' : 'chave',
      loja: peloClique && rows[0].loja_regem_id ? { id: rows[0].loja_regem_id, nome: rows[0].loja_regem_nome ?? 'Loja do Regem' } : null,
      lojas: peloClique ? await this.clique.lojas(tenant) : [],
      ultimaImportacao: rows[0].ultima_importacao ?? undefined,
      ultimoResumo: resumo,
    };
  }

  // ---- internos ----

  private async conexaoDe(tenant: string): Promise<{ token: string; origem: 'chave' | 'clique'; versaoAnterior?: string }> {
    const rows = await this.store.query(`select token_cifrado, origem, ultimo_resumo->>'versao' as versao from conexao_regem where tenant_id = $1`, [tenant]);
    if (!rows.length) throw new Error('conecte o Regem antes de importar');
    return { token: decifrar(rows[0].token_cifrado), origem: rows[0].origem === 'clique' ? 'clique' : 'chave', versaoAnterior: rows[0].versao ?? undefined };
  }

  /**
   * Busca o catálogo na API de integração do Regem (base FIXA, confiável). Com `versao`, pede só o
   * que mudou. Erros do Regem vêm em problem+json (401/403/429 com Retry-After) → frase pt-BR.
   *
   * A credencial segue a origem da conexão: a chave colada vai sozinha no `Authorization`; a do clique é o token do DMS
   * ID do Orzuni com a ligação da loja no `DMS-Ligacao` (no 401, pede outro token ao DMS ID e tenta uma vez mais).
   */
  private async buscar(conexao: { token: string; origem: 'chave' | 'clique' }, versao?: string): Promise<RespostaCatalogo> {
    const url = `${REGEM_BASE}${CAMINHO_CATALOGO}` + (versao ? `?versao=${encodeURIComponent(versao)}` : '');
    const peloClique = conexao.origem === 'clique';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const chamar = async () =>
        this.clique.buscar(url, {
          headers: { ...(peloClique ? await this.clique.cabecalhos(conexao.token) : { Authorization: `Bearer ${conexao.token}` }), accept: 'application/json' },
          redirect: 'manual',
          signal: ctrl.signal,
        });
      let res = await chamar();
      if (res.status === 401 && peloClique) {
        this.clique.esquecerToken();
        res = await chamar();
      }
      if (res.status >= 300 && res.status < 400) throw new Error('o endereço do Regem redirecionou (não permitido)');
      if ((res.status === 401 || res.status === 403) && peloClique) {
        throw new Error('a conexão com o Regem não vale mais: ela pode ter sido desligada lá. Conecte de novo pelo botão "Conectar pelo Regem".');
      }
      if (res.status === 401 || res.status === 403) throw new Error('a chave de integração do Regem é inválida ou não tem permissão');
      if (res.status === 429) {
        const espera = Number(res.headers.get('retry-after') || 0);
        throw new Error(espera ? `o Regem pediu para aguardar ${espera}s (muitas chamadas). Tente de novo em instantes.` : 'muitas chamadas ao Regem; tente de novo em instantes');
      }
      if (!res.ok) throw new Error(`o Regem respondeu com erro (${res.status})`);
      return (await res.json()) as RespostaCatalogo;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw new Error('o Regem demorou demais para responder');
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
}
