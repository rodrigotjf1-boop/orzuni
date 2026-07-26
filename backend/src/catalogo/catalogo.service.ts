import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IfoodCatalogService } from '../ifood/ifood-catalog.service';
import type { IfoodItem } from '../ifood/ifood.types';
import { validarItem, validarCategoria, validarShifts, toIfoodShifts, fromIfoodShifts, mapErroIfood, type DadosItem, type Shift } from './validacao';

export interface ItemDetalhe {
  pdv: string;
  nome: string;
  descricao: string;
  categoria: string;
  preco: number;
  promo: { de: number } | null;
  status: 'no_ar' | 'pausado';
  complementos: Array<{ grupo: string; obrigatorio: boolean; opcoes: Array<{ nome: string; status: string }> }>;
  disponibilidade: Shift[];
}

/** Item no formato CANÔNICO do Orzuni (não fala "iFood" por fora). */
export interface ItemCanonico {
  pdv: string | null;
  nome: string;
  categoria: string;
  preco: number;
  promo: { de: number } | null; // "de/por" (originalValue)
  status: 'no_ar' | 'pausado';
}

/**
 * Traduz o catálogo do iFood para o modelo canônico e executa as operações que a
 * API aberta expõe. Aqui mora o GUARDRAIL: reprecificar preserva a promoção "de/por"
 * por padrão (recarrega o originalValue), a menos que o chamador peça o contrário.
 */
@Injectable()
export class CatalogoService {
  private readonly logger = new Logger('catalogo');
  constructor(private readonly ifood: IfoodCatalogService) {}

  /** Cardápio consolidado, já com estado no ar/pausado e a promoção de/por. */
  async cardapio(merchantId: string): Promise<ItemCanonico[]> {
    const [cat] = await this.ifood.catalogs(merchantId);
    if (!cat) return [];
    const categorias = await this.ifood.categories(merchantId, cat.catalogId);
    const out: ItemCanonico[] = [];
    for (const c of categorias) {
      for (const it of c.items ?? []) {
        const ctx = it.contextModifiers?.find((m) => m.catalogContext === 'DEFAULT');
        const preco = ctx?.price ?? it.price;
        out.push({
          pdv: this.pdv(it),
          nome: it.name ?? it.id,
          categoria: c.name,
          preco: preco?.value ?? 0,
          promo: preco?.originalValue && preco.originalValue > (preco.value ?? 0) ? { de: preco.originalValue } : null,
          status: this.noAr(it) ? 'no_ar' : 'pausado',
        });
      }
    }
    return out;
  }

  /**
   * Reprecifica por código de PDV (modo ponte). `manterPromo` (padrão true) recarrega
   * o originalValue atual para o de/por NÃO ser apagado — ver docs §8.
   * Retorna o batchId do lote assíncrono do iFood.
   */
  async reprecificar(
    merchantId: string,
    itens: Array<{ pdv: string; preco: number; manterPromo?: boolean }>,
    context = 'DEFAULT',
  ): Promise<{ batchId: string | null; ignorados: string[] }> {
    // mapa pdv → originalValue atual (para preservar promo)
    const atual = new Map<string, number | undefined>();
    const [cat] = await this.ifood.catalogs(merchantId);
    if (cat) {
      const cats = await this.ifood.categories(merchantId, cat.catalogId);
      for (const c of cats)
        for (const it of c.items ?? []) {
          const ctx = it.contextModifiers?.find((m) => m.catalogContext === context);
          const p = ctx?.price ?? it.price;
          const pdv = this.pdv(it);
          if (pdv) atual.set(pdv, p?.originalValue);
        }
    }

    const ignorados: string[] = [];
    const precos = itens
      .filter((i) => {
        if (!atual.has(i.pdv)) {
          ignorados.push(i.pdv);
          return false;
        }
        return true;
      })
      .map((i) => {
        const original = i.manterPromo === false ? undefined : atual.get(i.pdv);
        // se preserva promo e havia originalValue, reenviar os dois; senão só value
        return original && original > i.preco
          ? { externalCode: i.pdv, value: i.preco, originalValue: original }
          : { externalCode: i.pdv, value: i.preco };
      });

    if (!precos.length) return { batchId: null, ignorados };
    const ack = await this.ifood.pricesByExternalCode(merchantId, precos, context);
    return { batchId: ack?.batchId ?? null, ignorados };
  }

  /** Pausa/reativa por PDV (lote de 1). */
  async status(
    merchantId: string,
    pdv: string,
    status: 'no_ar' | 'pausado',
    context = 'DEFAULT',
  ): Promise<{ batchId: string | null }> {
    return this.statusEmMassa(merchantId, [{ pdv, status }], context);
  }

  /** Pausa/reativa VÁRIOS itens por PDV numa única chamada (atualização em massa). */
  async statusEmMassa(
    merchantId: string,
    itens: Array<{ pdv: string; status: 'no_ar' | 'pausado' }>,
    context = 'DEFAULT',
  ): Promise<{ batchId: string | null }> {
    if (!itens.length) return { batchId: null };
    const ack = await this.ifood.statusByExternalCode(
      merchantId,
      itens.map((i) => ({ externalCode: i.pdv, status: i.status === 'no_ar' ? 'AVAILABLE' : 'UNAVAILABLE' })),
      context,
    );
    return { batchId: ack?.batchId ?? null };
  }

  async batch(merchantId: string, batchId: string) {
    return this.ifood.getBatch(merchantId, batchId);
  }

  /** Detalhe de um item pelo código de PDV (para o editor). */
  async detalhe(merchantId: string, pdv: string): Promise<ItemDetalhe | null> {
    const ref = await this.resolver(merchantId, pdv);
    if (!ref) return null;
    const flat = await this.ifood.itemFlat(merchantId, ref.itemId);
    const ctx = ref.item.contextModifiers?.find((m) => m.catalogContext === 'DEFAULT');
    const preco = ctx?.price ?? ref.item.price;
    const produto = flat?.products?.find((p) => p.id === ref.item.productId) ?? flat?.products?.[0];
    const complementos = (flat?.optionGroups ?? []).map((g) => ({
      grupo: g.name,
      obrigatorio: (g.min ?? 0) > 0,
      opcoes: (g.optionIds ?? []).map((oid) => {
        const o = flat?.options?.find((x) => x.id === oid);
        return { nome: o?.externalCode ?? oid, status: o?.status === 'AVAILABLE' ? 'no_ar' : 'pausado' };
      }),
    }));
    return {
      pdv,
      nome: ref.nome,
      descricao: (produto as any)?.description ?? '',
      categoria: ref.categoria,
      preco: preco?.value ?? 0,
      promo: preco?.originalValue && preco.originalValue > (preco.value ?? 0) ? { de: preco.originalValue } : null,
      status: this.noAr(ref.item) ? 'no_ar' : 'pausado',
      complementos,
      disponibilidade: fromIfoodShifts((flat?.item as any)?.shifts ?? (ref.item as any).shifts),
    };
  }

  /** Contextos (canais) do catálogo — ex.: DEFAULT (Delivery), INDOOR, WHITELABEL. */
  async contextos(merchantId: string): Promise<string[]> {
    const [cat] = await this.ifood.catalogs(merchantId);
    return cat?.context?.length ? cat.context : ['DEFAULT'];
  }

  /**
   * Edita um item pelo PDV. nome/descrição → PUT /products (assíncrono, com retry);
   * preço → PATCH (preserva promo); status → PATCH. Só toca no que veio no body.
   */
  async editar(
    merchantId: string,
    pdv: string,
    campos: { nome?: string; descricao?: string; preco?: number; status?: 'no_ar' | 'pausado'; shifts?: Shift[] },
  ): Promise<{ ok: boolean; erros: string[] }> {
    const ref = await this.resolver(merchantId, pdv);
    if (!ref) return { ok: false, erros: ['item não encontrado'] };
    const erros: string[] = [];

    if (campos.shifts !== undefined) erros.push(...validarShifts(campos.shifts));
    if (erros.length) return { ok: false, erros };

    if (campos.nome !== undefined || campos.descricao !== undefined) {
      const ok = await this.ifood.updateProduct(merchantId, ref.item.productId, {
        ...(campos.nome !== undefined ? { name: campos.nome } : {}),
        ...(campos.descricao !== undefined ? { description: campos.descricao } : {}),
      });
      if (!ok) erros.push('nome/descrição');
    }
    if (campos.preco !== undefined) {
      const r = await this.reprecificar(merchantId, [{ pdv, preco: campos.preco }]);
      if (!r.batchId) erros.push('preço');
    }
    if (campos.status !== undefined) {
      const r = await this.status(merchantId, pdv, campos.status);
      if (!r.batchId) erros.push('status');
    }
    // disponibilidade (shifts): exige re-PUT do item completo (usa o flat como base)
    if (campos.shifts !== undefined) {
      const flat = await this.ifood.itemFlat(merchantId, ref.itemId);
      if (flat) {
        // o flat traz campos derivados/read-only (weight com unidade inválida,
        // industrialized) que o PUT rejeita — remover antes de reenviar.
        const limpar = (p: any) => {
          const { weight, industrialized, ...resto } = p;
          return resto;
        };
        // só o produto PRINCIPAL vai em products[]; produtos das opções podem ser
        // industrializados de outro dono (não atualizáveis). As opções apenas os referenciam.
        const principal = (flat.products ?? []).filter((p) => p.id === flat.item.productId).map(limpar);
        const payload = {
          item: { ...flat.item, shifts: toIfoodShifts(campos.shifts) ?? [] },
          products: principal.length ? principal : (flat.products ?? []).map(limpar),
          optionGroups: flat.optionGroups,
          options: flat.options,
        };
        const r = await this.ifood.putItem(merchantId, payload);
        if (!(r.status >= 200 && r.status < 300)) erros.push('disponibilidade');
      } else erros.push('disponibilidade');
    }
    return { ok: erros.length === 0, erros };
  }

  /** Cria uma categoria (POST /categories), validando antes. */
  async criarCategoria(merchantId: string, nome: string): Promise<{ ok: boolean; categoryId?: string; erro?: string }> {
    const erros = validarCategoria(nome);
    if (erros.length) return { ok: false, erro: erros.join('; ') };
    const [cat] = await this.ifood.catalogs(merchantId);
    if (!cat) return { ok: false, erro: 'catálogo não encontrado' };
    const r = await this.ifood.createCategory(merchantId, cat.catalogId, {
      name: nome.trim(),
      externalCode: 'ORZ-CAT-' + Date.now(),
    });
    if (r.status === 201) return { ok: true, categoryId: r.id };
    const e = mapErroIfood(r.status, r.data);
    return { ok: false, erro: e.mensagem };
  }

  /**
   * Cria um item (PUT /items), com produto + complementos opcionais. Valida antes
   * (título/descrição/preço) e traduz erros. Se `categoria` vier por nome e não
   * existir, cria a categoria.
   */
  async criarItem(merchantId: string, d: DadosItem): Promise<{ ok: boolean; pdv?: string; erro?: string }> {
    const erros = [...validarItem(d), ...validarShifts(d.shifts)];
    if (erros.length) return { ok: false, erro: erros.join('; ') };
    const [cat] = await this.ifood.catalogs(merchantId);
    if (!cat) return { ok: false, erro: 'catálogo não encontrado' };

    // resolve/cria a categoria
    let categoryId = d.categoriaId;
    if (!categoryId) {
      const cats = await this.ifood.categories(merchantId, cat.catalogId);
      const achada = cats.find((c) => c.name?.toLowerCase() === d.categoria!.toLowerCase());
      if (achada) categoryId = achada.id;
      else {
        const nova = await this.criarCategoria(merchantId, d.categoria!);
        if (!nova.ok) return { ok: false, erro: 'não consegui criar a categoria: ' + nova.erro };
        categoryId = nova.categoryId;
      }
    }

    const itemId = randomUUID();
    const productId = randomUUID();
    const ext = d.pdv?.trim() || 'ORZ-' + Date.now();

    // monta complementos (grupos + opções); cada opção é um produto próprio
    const optionGroups: any[] = [];
    const options: any[] = [];
    const optionProducts: any[] = [];
    for (const g of d.complementos ?? []) {
      const groupId = randomUUID();
      const optIds: string[] = [];
      for (const o of g.opcoes) {
        const optId = randomUUID();
        const optProdId = randomUUID();
        optIds.push(optId);
        options.push({ id: optId, status: 'AVAILABLE', productId: optProdId, price: { value: o.preco ?? 0 }, externalCode: 'ORZ-OPT-' + optId.slice(0, 8) });
        optionProducts.push({ id: optProdId, name: o.nome.trim(), externalCode: 'ORZ-OPP-' + optProdId.slice(0, 8) });
      }
      optionGroups.push({
        id: groupId,
        name: g.grupo,
        status: 'AVAILABLE',
        externalCode: 'ORZ-OG-' + groupId.slice(0, 8),
        optionGroupType: 'INGREDIENTS',
        min: g.min,
        max: g.max,
        optionIds: optIds,
      });
    }

    // products: o produto principal (com os grupos associados) + um por opção
    const products: any[] = [
      {
        id: productId,
        name: d.nome!.trim(),
        ...(d.descricao ? { description: d.descricao.trim() } : {}),
        externalCode: ext,
        optionGroups: optionGroups.map((g) => ({ id: g.id, min: g.min, max: g.max })),
      },
      ...optionProducts,
    ];

    const shifts = toIfoodShifts(d.shifts);
    const payload = {
      item: {
        id: itemId,
        type: 'DEFAULT',
        categoryId,
        productId,
        status: 'AVAILABLE',
        externalCode: ext,
        price: { value: d.preco },
        index: 1,
        ...(shifts ? { shifts } : {}),
      },
      products,
      optionGroups,
      options,
    };

    const r = await this.ifood.putItem(merchantId, payload);
    if (r.status >= 200 && r.status < 300) return { ok: true, pdv: ext };
    const e = mapErroIfood(r.status, r.data);
    this.logger.warn(`criarItem ${e.codigo}: ${e.mensagem}`);
    return { ok: false, erro: e.mensagem };
  }

  // resolve o PDV → item (itemId, productId, categoria) varrendo o catálogo
  private async resolver(
    merchantId: string,
    pdv: string,
  ): Promise<{ itemId: string; item: IfoodItem; nome: string; categoria: string } | null> {
    const [cat] = await this.ifood.catalogs(merchantId);
    if (!cat) return null;
    const cats = await this.ifood.categories(merchantId, cat.catalogId);
    for (const c of cats)
      for (const it of c.items ?? []) if (this.pdv(it) === pdv) return { itemId: it.id, item: it, nome: it.name ?? it.id, categoria: c.name };
    return null;
  }

  // ---- helpers ----
  private pdv(it: IfoodItem): string | null {
    const ctx = it.contextModifiers?.find((m) => m.externalCode);
    return it.externalCode ?? ctx?.externalCode ?? null;
  }
  private noAr(it: IfoodItem): boolean {
    const ctx = it.contextModifiers?.find((m) => m.catalogContext === 'DEFAULT');
    return (ctx?.status ?? it.status) === 'AVAILABLE';
  }
}
