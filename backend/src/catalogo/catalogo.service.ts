import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IfoodCatalogService } from '../ifood/ifood-catalog.service';
import type { IfoodItem } from '../ifood/ifood.types';
import {
  validarItem,
  validarCategoria,
  validarShifts,
  validarPizza,
  validarCombo,
  toIfoodShifts,
  fromIfoodShifts,
  mapErroIfood,
  type DadosItem,
  type DadosPizza,
  type DadosCombo,
  type Shift,
} from './validacao';

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
        // o nome legível está no PRODUTO da opção; externalCode/id são só fallback
        const prod = flat?.products?.find((p) => p.id === o?.productId);
        return { nome: prod?.name ?? o?.externalCode ?? oid, status: o?.status === 'AVAILABLE' ? 'no_ar' : 'pausado' };
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
    campos: { nome?: string; descricao?: string; preco?: number; status?: 'no_ar' | 'pausado'; shifts?: Shift[]; imagem?: string; pdv?: string },
  ): Promise<{ ok: boolean; erros: string[]; pdv?: string }> {
    const ref = await this.resolver(merchantId, pdv);
    if (!ref) return { ok: false, erros: ['item não encontrado'] };
    const erros: string[] = [];

    if (campos.shifts !== undefined) erros.push(...validarShifts(campos.shifts));
    if (erros.length) return { ok: false, erros };

    // foto nova (opcional): sobe e resolve o imagePath antes do PUT /products
    let imagePath: string | undefined;
    if (campos.imagem) {
      imagePath = (await this.ifood.uploadImage(merchantId, campos.imagem)) ?? undefined;
      if (!imagePath) erros.push('foto');
    }

    if (campos.nome !== undefined || campos.descricao !== undefined || imagePath) {
      const ok = await this.ifood.updateProduct(merchantId, ref.item.productId, {
        ...(campos.nome !== undefined ? { name: campos.nome } : {}),
        ...(campos.descricao !== undefined ? { description: campos.descricao } : {}),
        ...(imagePath ? { imagePath } : {}),
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
    // shifts e/ou novo código PDV: exigem re-PUT do item completo (usa o flat como base)
    const novoPdv = campos.pdv?.trim();
    const mudouPdv = !!novoPdv && novoPdv !== pdv;
    if (campos.shifts !== undefined || mudouPdv) {
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
        if (mudouPdv) principal.forEach((p) => (p.externalCode = novoPdv)); // relinka o produto ao novo PDV
        const cm = (flat.item as any).contextModifiers;
        const payload = {
          item: {
            ...flat.item,
            ...(mudouPdv
              ? {
                  externalCode: novoPdv,
                  // os contextModifiers carregam o PDV — atualizar senão o iFood mantém o antigo
                  ...(Array.isArray(cm) ? { contextModifiers: cm.map((m: any) => ({ ...m, externalCode: novoPdv })) } : {}),
                }
              : {}),
            ...(campos.shifts !== undefined ? { shifts: toIfoodShifts(campos.shifts) ?? [] } : {}),
          },
          products: principal.length ? principal : (flat.products ?? []).map(limpar),
          optionGroups: flat.optionGroups,
          options: flat.options,
        };
        const r = await this.ifood.putItem(merchantId, payload);
        if (!(r.status >= 200 && r.status < 300)) {
          const e = mapErroIfood(r.status, r.data);
          erros.push(mudouPdv ? 'código PDV: ' + e.mensagem : 'disponibilidade');
        }
      } else erros.push(campos.shifts !== undefined ? 'disponibilidade' : 'código PDV');
    }
    return { ok: erros.length === 0, erros, pdv: mudouPdv ? novoPdv : pdv };
  }

  /** Cria uma categoria (POST /categories), validando antes. `template` PIZZA para pizzas. */
  async criarCategoria(
    merchantId: string,
    nome: string,
    template: 'DEFAULT' | 'PIZZA' = 'DEFAULT',
  ): Promise<{ ok: boolean; categoryId?: string; erro?: string }> {
    const erros = validarCategoria(nome);
    if (erros.length) return { ok: false, erro: erros.join('; ') };
    const [cat] = await this.ifood.catalogs(merchantId);
    if (!cat) return { ok: false, erro: 'catálogo não encontrado' };
    const r = await this.ifood.createCategory(merchantId, cat.catalogId, {
      name: nome.trim(),
      externalCode: 'ORZ-CAT-' + Date.now(),
      template,
    });
    if (r.status === 201) return { ok: true, categoryId: r.id };
    const e = mapErroIfood(r.status, r.data);
    return { ok: false, erro: e.mensagem };
  }

  /**
   * Resolve o id da categoria a partir de {categoriaId | categoria(nome)}; cria se
   * não existir (com o `template` informado). Para pizza, procura/cria a categoria PIZZA.
   */
  private async resolverCategoriaId(
    merchantId: string,
    catalogId: string,
    ref: { categoriaId?: string; categoria?: string },
    template: 'DEFAULT' | 'PIZZA' = 'DEFAULT',
  ): Promise<{ ok: true; categoryId: string } | { ok: false; erro: string }> {
    if (ref.categoriaId) return { ok: true, categoryId: ref.categoriaId };
    const cats = await this.ifood.categories(merchantId, catalogId);
    // pizza: reaproveita QUALQUER categoria PIZZA existente (a loja só aceita uma)
    if (template === 'PIZZA') {
      const jaPizza = cats.find((c) => c.template === 'PIZZA');
      if (jaPizza) return { ok: true, categoryId: jaPizza.id };
    }
    const achada = cats.find((c) => c.name?.toLowerCase() === ref.categoria?.toLowerCase());
    if (achada) return { ok: true, categoryId: achada.id };
    const nova = await this.criarCategoria(merchantId, ref.categoria!, template);
    if (!nova.ok || !nova.categoryId) return { ok: false, erro: 'não consegui criar a categoria: ' + nova.erro };
    return { ok: true, categoryId: nova.categoryId };
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
    const rc = await this.resolverCategoriaId(merchantId, cat.catalogId, d);
    if (!rc.ok) return { ok: false, erro: rc.erro };
    const categoryId = rc.categoryId;

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

    // foto (opcional): sobe o data-URI ao iFood e usa o imagePath no produto principal
    let imagePath: string | undefined;
    if (d.imagem) imagePath = (await this.ifood.uploadImage(merchantId, d.imagem)) ?? undefined;

    // products: o produto principal (com os grupos associados) + um por opção
    const products: any[] = [
      {
        id: productId,
        name: d.nome!.trim(),
        ...(d.descricao ? { description: d.descricao.trim() } : {}),
        ...(imagePath ? { imagePath } : {}),
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

  /**
   * Cria uma PIZZA (type PIZZA) com os 4 grupos obrigatórios SIZE/CRUST/EDGE/TOPPING.
   * Preço-base no tamanho; `fractions` = quantos sabores o tamanho aceita; `quantity`
   * = fatias. Se `bordas` vier vazio, cria uma "Tradicional" grátis (o grupo EDGE é
   * obrigatório na estrutura). Categoria criada com template PIZZA. Ver docs/pizza-combo-shape.md.
   */
  async criarPizza(merchantId: string, d: DadosPizza): Promise<{ ok: boolean; pdv?: string; erro?: string }> {
    const erros = [...validarPizza(d), ...validarShifts(d.shifts)];
    if (erros.length) return { ok: false, erro: erros.join('; ') };
    const [cat] = await this.ifood.catalogs(merchantId);
    if (!cat) return { ok: false, erro: 'catálogo não encontrado' };

    // Pizza: NUNCA enviar categoryId — a API gerencia a (única) categoria PIZZA da loja
    // sozinha. Passar categoryId (mesmo o da categoria PIZZA existente) devolve 409.
    // Ver docs/pizza-combo-shape.md.
    const itemId = randomUUID();
    const productId = randomUUID();
    const ext = d.pdv?.trim() || 'ORZ-PIZ-' + randomUUID().slice(0, 8);

    const products: any[] = [];
    const optionGroups: any[] = [];
    const options: any[] = [];

    const bordas = d.bordas?.length ? d.bordas : [{ nome: 'Tradicional', preco: 0 }];
    const contextos = cat.context?.length ? cat.context : ['DEFAULT'];

    // grupo simples (SIZE/CRUST/EDGE): 1 produto + 1 opção por item. Devolve os ids das opções.
    // `fractions` (número 1..4) é obrigatório em TODA opção; no tamanho = quantos sabores aceita.
    const grupoSimples = (
      nome: string,
      tipo: 'SIZE' | 'CRUST' | 'EDGE',
      itens: Array<{ nome: string; preco?: number; pedacos?: number; maxSabores?: number }>,
    ) => {
      const groupId = randomUUID();
      const optionIds: string[] = [];
      itens.forEach((it, i) => {
        const optId = randomUUID();
        const prodId = randomUUID();
        optionIds.push(optId);
        products.push({
          id: prodId,
          name: it.nome.trim(),
          externalCode: 'ORZ-PP-' + prodId.slice(0, 8),
          ...(tipo === 'SIZE' && it.pedacos ? { quantity: it.pedacos } : {}),
        });
        const fractions =
          tipo === 'SIZE'
            ? Array.from({ length: Math.min(4, Math.max(1, it.maxSabores ?? 1)) }, (_, k) => k + 1)
            : [1];
        options.push({
          id: optId,
          productId: prodId,
          status: 'AVAILABLE',
          index: i,
          price: { value: it.preco ?? 0 },
          externalCode: 'ORZ-PO-' + optId.slice(0, 8),
          fractions,
          contextModifiers: [],
        });
      });
      optionGroups.push({ id: groupId, name: nome, status: 'AVAILABLE', externalCode: 'ORZ-OG-' + groupId.slice(0, 8), optionGroupType: tipo, optionIds });
      return { id: groupId, optionIds };
    };

    const gSize = grupoSimples('Tamanho', 'SIZE', d.tamanhos!);
    const gCrust = grupoSimples('Massa', 'CRUST', d.massas!);
    const gEdge = grupoSimples('Borda', 'EDGE', bordas);

    // TOPPING: cada sabor = 1 opção, ligada a TODOS os tamanhos (× contextos) via
    // contextModifiers[].parentOptionId — é o que o iFood cobra ("linked with all sizes
    // in all contexts"). O preço adicional do sabor vai em cada contexto/tamanho.
    const toppingGroupId = randomUUID();
    const toppingOptIds: string[] = [];
    d.sabores!.forEach((s, si) => {
      const prodId = randomUUID();
      const optId = randomUUID();
      toppingOptIds.push(optId);
      products.push({ id: prodId, name: s.nome.trim(), externalCode: 'ORZ-PP-' + prodId.slice(0, 8) });
      const preco = s.preco ?? 0;
      const contextModifiers: any[] = [];
      for (const ctx of contextos)
        for (const sizeOptId of gSize.optionIds)
          contextModifiers.push({ status: 'AVAILABLE', price: { value: preco }, catalogContext: ctx, parentOptionId: sizeOptId });
      options.push({
        id: optId,
        productId: prodId,
        status: 'AVAILABLE',
        index: si,
        price: { value: preco },
        externalCode: 'ORZ-PO-' + optId.slice(0, 8),
        fractions: [1],
        contextModifiers,
      });
    });
    optionGroups.push({ id: toppingGroupId, name: 'Sabor', status: 'AVAILABLE', externalCode: 'ORZ-OG-' + toppingGroupId.slice(0, 8), optionGroupType: 'TOPPING', optionIds: toppingOptIds });
    const gTopping = { id: toppingGroupId };

    // produto principal referencia os 4 grupos (EDGE é opcional para o cliente → min 0)
    products.unshift({
      id: productId,
      name: d.nome!.trim(),
      externalCode: ext,
      optionGroups: [
        { id: gSize.id, min: 1, max: 1 },
        { id: gCrust.id, min: 1, max: 1 },
        { id: gEdge.id, min: 0, max: 1 },
        { id: gTopping.id, min: 1, max: 1 },
      ],
    });

    const shifts = toIfoodShifts(d.shifts);
    const payload = {
      item: {
        id: itemId,
        type: 'PIZZA',
        productId,
        status: 'AVAILABLE',
        externalCode: ext,
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
    this.logger.warn(`criarPizza ${e.codigo}: ${e.mensagem}`);
    return { ok: false, erro: e.mensagem };
  }

  /**
   * Cria um COMBO (type COMBO_V2): um grupo principal (MAIN) + grupos adicionais
   * (OFFER_UNIT) + customizações de 3º nível (INGREDIENTS/SPECIFICATION) presas ao
   * produto da opção. Todo produto referenciado entra em products[]. Ver docs/pizza-combo-shape.md.
   */
  async criarCombo(merchantId: string, d: DadosCombo): Promise<{ ok: boolean; pdv?: string; erro?: string }> {
    const erros = [...validarCombo(d), ...validarShifts(d.shifts)];
    if (erros.length) return { ok: false, erro: erros.join('; ') };
    const [cat] = await this.ifood.catalogs(merchantId);
    if (!cat) return { ok: false, erro: 'catálogo não encontrado' };

    const rc = await this.resolverCategoriaId(merchantId, cat.catalogId, d);
    if (!rc.ok) return { ok: false, erro: rc.erro };
    const categoryId = rc.categoryId;

    const itemId = randomUUID();
    const productId = randomUUID();
    const ext = d.pdv?.trim() || 'ORZ-CMB-' + Date.now();

    const products: any[] = [];
    const optionGroups: any[] = [];
    const options: any[] = [];
    const TIPO_3N = { ingredientes: 'INGREDIENTS', especificacao: 'SPECIFICATION' } as const;

    // grupos de nível 2 (OFFER_UNIT) — referenciados pelo produto principal
    const gruposPrincipais: any[] = [];
    (d.grupos ?? []).forEach((g, gi) => {
      const groupId = randomUUID();
      const optionIds: string[] = [];
      g.opcoes.forEach((o, oi) => {
        const optId = randomUUID();
        const prodId = randomUUID();
        optionIds.push(optId);
        options.push({ id: optId, productId: prodId, status: 'AVAILABLE', index: oi, price: { value: o.preco } });

        // 3º nível: customizações presas ao PRODUTO da opção
        const gruposCustom: any[] = [];
        (o.customizacoes ?? []).forEach((c, ci) => {
          const cgId = randomUUID();
          const cOptIds: string[] = [];
          c.opcoes.forEach((co) => {
            const coId = randomUUID();
            const coProdId = randomUUID();
            cOptIds.push(coId);
            options.push({ id: coId, productId: coProdId, status: 'AVAILABLE', price: { value: co.preco ?? 0 } });
            products.push({ id: coProdId, name: co.nome.trim(), externalCode: 'ORZ-CP-' + coProdId.slice(0, 8) });
          });
          optionGroups.push({ id: cgId, name: c.nome.trim(), status: 'AVAILABLE', optionGroupType: TIPO_3N[c.tipo], optionIds: cOptIds });
          gruposCustom.push({ id: cgId, min: c.min, max: c.max, index: ci });
        });

        products.push({
          id: prodId,
          name: o.nome.trim(),
          externalCode: 'ORZ-CO-' + prodId.slice(0, 8),
          ...(gruposCustom.length ? { optionGroups: gruposCustom } : {}),
        });
      });
      optionGroups.push({ id: groupId, name: g.nome.trim(), status: 'AVAILABLE', optionGroupType: 'OFFER_UNIT', optionIds });
      gruposPrincipais.push({ id: groupId, min: g.min, max: g.max, index: gi, ...(g.principal ? { associationType: 'MAIN' } : {}) });
    });

    // produto principal do combo referencia os grupos de nível 2
    products.unshift({ id: productId, name: d.nome!.trim(), externalCode: ext, optionGroups: gruposPrincipais });

    const shifts = toIfoodShifts(d.shifts);
    const payload = {
      item: {
        id: itemId,
        type: 'COMBO_V2',
        categoryId,
        productId,
        status: 'AVAILABLE',
        externalCode: ext,
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
    this.logger.warn(`criarCombo ${e.codigo}: ${e.mensagem}`);
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
