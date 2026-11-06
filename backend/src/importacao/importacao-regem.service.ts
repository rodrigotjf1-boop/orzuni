import { Injectable, Logger } from '@nestjs/common';

import { CatalogoService } from '../catalogo/catalogo.service';
import type { DadosItem } from '../catalogo/validacao';
import { ContaService } from '../conta/conta.service';
import { StoreService } from '../store/store.service';
import { cifrar, decifrar } from '../common/cifra';
import { urlSyncCatalogoSegura } from '../common/url-publica-segura';

/** Um produto como o `/sync/catalogo` do Regem entrega (só o que o Orzuni usa). */
interface ProdutoRegem {
  codigo?: string | null; // código PDV (chave de ligação)
  nome?: string;
  descricao?: string | null;
  categoriaId?: string | null;
  precoIfood?: number | null; // null/ausente = NÃO enviar ao iFood
  noIfood?: boolean; // true = não está no iFood → ignorar
  grupos?: Array<{
    nome?: string;
    min?: number;
    max?: number;
    opcoes?: Array<{ nome?: string; codigoPdv?: string | null; precoIfood?: number | null }>;
  }>;
}

export interface ResumoImportacao {
  criados: number;
  jaExistiam: number;
  semCodigo: number;
  semPrecoIfoodOuNoIfood: number;
  falhas: Array<{ codigo: string; erro?: string }>;
}

/**
 * Classifica os produtos do Regem contra os códigos PDV JÁ existentes no iFood.
 * Regra do dono: produto sem preço iFood ou marcado "não está no iFood" é ignorado;
 * sem código não dá para ligar; o que já existe no iFood NÃO é tocado (só cria os
 * que faltam). Função PURA (sem rede/banco) — a base do teste.
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
    if (p?.noIfood === true || p?.precoIfood == null) {
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
  ) {}

  /** Conecta a leitura do Regem: valida a URL (anti-SSRF), testa, e guarda o token CIFRADO. */
  async conectar(tenant: string, baseUrl: string, token: string): Promise<{ ok: boolean; produtos?: number; erro?: string }> {
    if (!this.store.temBanco) return { ok: false, erro: 'banco indisponível' };
    const url = await urlSyncCatalogoSegura(baseUrl); // lança em caso de SSRF/URL inválida
    const segredo = (token ?? '').trim();
    if (!segredo) return { ok: false, erro: 'informe o token de integração do Regem' };
    const dados = await this.buscar(url, segredo); // valida o token/endereço antes de salvar
    await this.store.query(
      `insert into conexao_regem (tenant_id, base_url, token_cifrado)
       values ($1, $2, $3)
       on conflict (tenant_id) do update set base_url = excluded.base_url, token_cifrado = excluded.token_cifrado, atualizado_em = now()`,
      [tenant, baseUrl.trim(), cifrar(segredo)],
    );
    return { ok: true, produtos: Array.isArray(dados?.produtos) ? dados.produtos.length : 0 };
  }

  /** Puxa o cardápio do Regem e cria no iFood só os produtos que faltam (por código PDV). */
  async importar(tenant: string): Promise<ResumoImportacao> {
    const conexao = await this.conexaoDe(tenant); // lança se não conectado
    const lojas = await this.contas.ativasDoTenant(tenant);
    const merchant = lojas[0]?.merchantId;
    if (!merchant) throw new Error('conecte uma loja do iFood antes de importar');

    const url = await urlSyncCatalogoSegura(conexao.baseUrl);
    const dados = await this.buscar(url, conexao.token);
    const produtos: ProdutoRegem[] = Array.isArray(dados?.produtos) ? (dados.produtos as ProdutoRegem[]) : [];
    const categoriaNome = new Map<string, string>();
    for (const c of (dados?.categorias ?? []) as Array<{ id?: string; nome?: string }>) {
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
      const r = await this.catalogo.criarItem(merchant, this.montarItem(p, categoriaNome));
      if (r.ok) criados++;
      else falhas.push({ codigo, erro: r.erro });
    }

    const resumo: ResumoImportacao = { criados, jaExistiam, semCodigo, semPrecoIfoodOuNoIfood: semPreco, falhas };
    await this.store
      .query(`update conexao_regem set ultima_importacao = now(), ultimo_resumo = $2, atualizado_em = now() where tenant_id = $1`, [
        tenant,
        JSON.stringify(resumo),
      ])
      .catch((e) => this.logger.warn(`gravar resumo falhou: ${e?.message ?? e}`));
    return resumo;
  }

  /** Estado da conexão para a tela (conectado? última importação?). */
  async status(tenant: string): Promise<{ conectado: boolean; endereco?: string; ultimaImportacao?: string; ultimoResumo?: unknown }> {
    const rows = await this.store.query(`select base_url, ultima_importacao, ultimo_resumo from conexao_regem where tenant_id = $1`, [tenant]);
    if (!rows.length) return { conectado: false };
    return {
      conectado: true,
      endereco: rows[0].base_url,
      ultimaImportacao: rows[0].ultima_importacao ?? undefined,
      ultimoResumo: rows[0].ultimo_resumo ?? undefined,
    };
  }

  // ---- internos ----

  private montarItem(p: ProdutoRegem, categoriaNome: Map<string, string>): DadosItem {
    const complementos = (p.grupos ?? [])
      .map((g) => ({
        grupo: g.nome ?? 'Complemento',
        min: g.min ?? 0,
        max: g.max ?? 0,
        // só as opções com preço iFood vão ao iFood (regra do dono)
        opcoes: (g.opcoes ?? [])
          .filter((o) => o.precoIfood != null)
          .map((o) => ({ nome: o.nome ?? '', preco: Number(o.precoIfood), ...(o.codigoPdv ? { pdv: String(o.codigoPdv) } : {}) })),
      }))
      .filter((g) => g.opcoes.length > 0);
    return {
      nome: p.nome,
      ...(p.descricao ? { descricao: p.descricao } : {}),
      preco: Number(p.precoIfood),
      categoria: (p.categoriaId && categoriaNome.get(p.categoriaId)) || 'Cardápio',
      pdv: String(p.codigo),
      ...(complementos.length ? { complementos } : {}),
    };
  }

  private async conexaoDe(tenant: string): Promise<{ baseUrl: string; token: string }> {
    const rows = await this.store.query(`select base_url, token_cifrado from conexao_regem where tenant_id = $1`, [tenant]);
    if (!rows.length) throw new Error('conecte o Regem antes de importar');
    return { baseUrl: rows[0].base_url, token: decifrar(rows[0].token_cifrado) };
  }

  /** Busca o `/sync/catalogo` do Regem com o token; sem seguir redirecionamento (anti-SSRF). */
  private async buscar(url: string, token: string): Promise<{ produtos?: unknown[]; categorias?: unknown[] }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(url, {
        headers: { 'X-Sync-Token': token, accept: 'application/json' },
        redirect: 'manual',
        signal: ctrl.signal,
      });
      if (res.status >= 300 && res.status < 400) throw new Error('o endereço do Regem redirecionou (não permitido)');
      if (res.status === 401 || res.status === 403) throw new Error('token do Regem inválido ou sem permissão');
      if (!res.ok) throw new Error(`o Regem respondeu com erro (${res.status})`);
      return (await res.json()) as { produtos?: unknown[]; categorias?: unknown[] };
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw new Error('o Regem demorou demais para responder');
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
}
