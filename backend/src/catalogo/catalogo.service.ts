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
  imagem: string; // URL da foto atual (imagePath do iFood), '' se não tiver
  complementos: Array<{ grupo: string; obrigatorio: boolean; min: number; max: number; opcoes: Array<{ nome: string; status: string; preco: number; pdv: string }> }>;
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
  imagem: string | null; // URL da foto (thumbnail), se houver
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
          imagem: (it as any).imagePath ?? null,
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
      min: g.min ?? 0,
      max: g.max ?? 0,
      opcoes: (g.optionIds ?? []).map((oid) => {
        const o = flat?.options?.find((x) => x.id === oid);
        // o nome legível está no PRODUTO da opção; externalCode/id são só fallback
        const prod = flat?.products?.find((p) => p.id === o?.productId);
        // PDV = externalCode da opção; os ORZ-* são gerados pelo app, então mostra vazio
        const codigo = o?.externalCode && !o.externalCode.startsWith('ORZ-') ? o.externalCode : '';
        return { nome: prod?.name ?? o?.externalCode ?? oid, status: o?.status === 'AVAILABLE' ? 'no_ar' : 'pausado', preco: o?.price?.value ?? 0, pdv: codigo };
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
      imagem: (produto as any)?.imagePath ?? '',
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
    campos: {
      nome?: string;
      descricao?: string;
      preco?: number;
      status?: 'no_ar' | 'pausado';
      shifts?: Shift[];
      imagem?: string;
      pdv?: string;
      complementos?: Array<{ grupo: string; min: number; max: number; opcoes: Array<{ nome: string; preco?: number; pdv?: string; imagem?: string }> }>;
    },
  ): Promise<{ ok: boolean; erros: string[]; pdv?: string }> {
    const ref = await this.resolver(merchantId, pdv);
    if (!ref) return { ok: false, erros: ['item não encontrado'] };
    const erros: string[] = [];

    if (campos.shifts !== undefined) erros.push(...validarShifts(campos.shifts));
    if (erros.length) return { ok: false, erros };

    // estado atual do item (base para o re-PUT que aplica nome/descrição/foto/etc.)
    const flat = await this.ifood.itemFlat(merchantId, ref.itemId);

    // foto nova (opcional): sobe → imagePath RELATIVO (formato do upload e do PUT /items)
    let imagePath: string | undefined;
    if (campos.imagem) {
      const up = await this.ifood.uploadImage(merchantId, campos.imagem);
      imagePath = up ? up.replace(/^https?:\/\/[^/]+\//, '') : undefined;
      if (!imagePath) erros.push('foto');
    }

    if (campos.preco !== undefined) {
      const r = await this.reprecificar(merchantId, [{ pdv, preco: campos.preco }]);
      if (!r.batchId) erros.push('preço');
    }
    if (campos.status !== undefined) {
      const r = await this.status(merchantId, pdv, campos.status);
      if (!r.batchId) erros.push('status');
    }
    // nome/descrição/foto/shifts/PDV/complementos: tudo via re-PUT do item (PUT /items,
    // que reenvia o PRODUTO COMPLETO e preserva serving/ean/etc. — mais robusto que PUT /products).
    const novoPdv = campos.pdv?.trim();
    const mudouPdv = !!novoPdv && novoPdv !== pdv;
    const mudouCompl = campos.complementos !== undefined;
    const mudouProduto = campos.nome !== undefined || campos.descricao !== undefined || !!imagePath;
    if (campos.shifts !== undefined || mudouPdv || mudouCompl || mudouProduto) {
      if (flat) {
        // o flat traz campos derivados/read-only (weight com unidade inválida,
        // industrialized) que o PUT rejeita — remover antes de reenviar.
        const limpar = (p: any) => {
          const { weight, industrialized, ...resto } = p;
          return resto;
        };
        const principal = (flat.products ?? []).filter((p) => p.id === flat.item.productId).map(limpar);
        // a foto no flat vem como URL completa; o PUT quer relativo
        principal.forEach((p) => { if (p.imagePath) p.imagePath = String(p.imagePath).replace(/^https?:\/\/[^/]+\//, ''); });
        // aplica nome/descrição/foto novos no produto principal
        if (mudouProduto && principal[0]) {
          if (campos.nome !== undefined) principal[0].name = campos.nome.trim();
          if (campos.descricao !== undefined) principal[0].description = campos.descricao;
          if (imagePath) principal[0].imagePath = imagePath;
        }
        if (mudouPdv) principal.forEach((p) => (p.externalCode = novoPdv)); // relinka o produto ao novo PDV

        // por padrão mantém os complementos atuais; se vieram novos, reconstrói tudo (substitui)
        let optionGroups: any[] = flat.optionGroups ?? [];
        let options: any[] = flat.options ?? [];
        let products: any[] = principal.length ? principal : (flat.products ?? []).map(limpar);
        if (mudouCompl) {
          const built = await this.montarComplementos(merchantId, campos.complementos);
          const main = { ...(principal[0] ?? limpar(flat.products?.[0])) };
          main.optionGroups = built.optionGroups.map((g) => ({ id: g.id, min: g.min, max: g.max }));
          optionGroups = built.optionGroups;
          options = built.options;
          products = [main, ...built.optionProducts];
        }

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
          products,
          optionGroups,
          options,
        };
        const r = await this.ifood.putItem(merchantId, payload);
        if (!(r.status >= 200 && r.status < 300)) {
          const e = mapErroIfood(r.status, r.data);
          const quem = mudouCompl ? 'complementos' : mudouPdv ? 'código PDV' : mudouProduto ? 'nome/descrição/foto' : 'disponibilidade';
          erros.push(`${quem}: ${e.mensagem}`);
        }
      } else erros.push('não consegui carregar o item para editar');
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
   * Monta grupos/opções/produtos de complemento a partir do modelo canônico.
   * Se a opção trouxer `imagem` (data-URI, já redimensionada no cliente), sobe ao
   * iFood e usa o imagePath no produto da opção. `groupIds` (opcional) fixa o id de
   * cada grupo — usado ao EDITAR um grupo existente (preserva a identidade do grupo).
   */
  private async montarComplementos(
    merchantId: string,
    complementos?: Array<{ grupo: string; min: number; max: number; opcoes: Array<{ nome: string; preco?: number; pdv?: string; imagem?: string }> }>,
    groupIds?: string[],
  ) {
    const optionGroups: any[] = [];
    const options: any[] = [];
    const optionProducts: any[] = [];
    let gi = 0;
    for (const g of complementos ?? []) {
      const groupId = groupIds?.[gi] ?? randomUUID();
      gi++;
      const optIds: string[] = [];
      for (const o of g.opcoes) {
        const optId = randomUUID();
        const optProdId = randomUUID();
        optIds.push(optId);
        // código PDV da opção (integração Regem/iFood); vazio = gera um ORZ-* automático
        const ext = o.pdv?.trim() || 'ORZ-OPT-' + optId.slice(0, 8);
        // imagem da opção (opcional): data-URI (nova, já redimensionada no cliente) → sobe;
        // URL/caminho (imagem já existente, ao editar grupo) → preserva como relativo.
        let imagePath: string | undefined;
        if (o.imagem) {
          if (o.imagem.startsWith('data:')) {
            const up = await this.ifood.uploadImage(merchantId, o.imagem);
            imagePath = up ? up.replace(/^https?:\/\/[^/]+\//, '') : undefined;
          } else {
            imagePath = o.imagem.replace(/^https?:\/\/[^/]+\//, '');
          }
        }
        options.push({ id: optId, status: 'AVAILABLE', productId: optProdId, price: { value: o.preco ?? 0 }, externalCode: ext });
        optionProducts.push({ id: optProdId, name: o.nome.trim(), externalCode: 'ORZ-OPP-' + optProdId.slice(0, 8), ...(imagePath ? { imagePath } : {}) });
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
    return { optionGroups, options, optionProducts };
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
    const { optionGroups, options, optionProducts } = await this.montarComplementos(merchantId, d.complementos);

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

  /**
   * Duplica um item: lê o flat, gera ids/PDVs NOVOS para tudo (item, produtos,
   * grupos, opções) e reenvia (PUT /items) como um item independente "(cópia)".
   * Serve para DEFAULT, PIZZA e COMBO. Retorna o PDV novo.
   */
  async duplicar(merchantId: string, pdv: string): Promise<{ ok: boolean; pdv?: string; erro?: string }> {
    const ref = await this.resolver(merchantId, pdv);
    if (!ref) return { ok: false, erro: 'item não encontrado' };
    const flat = await this.ifood.itemFlat(merchantId, ref.itemId);
    if (!flat) return { ok: false, erro: 'não consegui carregar o item para duplicar' };

    const limpar = (p: any) => {
      const { weight, industrialized, ...resto } = p;
      return resto;
    };
    const idMap = new Map<string, string>();
    const novo = (old: string): string => {
      if (!idMap.has(old)) idMap.set(old, randomUUID());
      return idMap.get(old)!;
    };
    const tipo = (flat.item as any).type ?? 'DEFAULT';
    const novoPdv = 'ORZ-CP-' + Date.now();
    const relImg = (u: any) => (u ? String(u).replace(/^https?:\/\/[^/]+\//, '') : u);

    // produtos: id novo, externalCode fresco, foto relativa; o principal ganha " (cópia)"
    const products = (flat.products ?? []).map(limpar).map((p: any) => {
      const np: any = { ...p, id: novo(p.id) };
      if (np.imagePath) np.imagePath = relImg(np.imagePath);
      if (p.id === flat.item.productId) {
        np.externalCode = novoPdv;
        np.name = (p.name ?? '') + ' (cópia)';
      } else {
        np.externalCode = 'ORZ-DUP-' + np.id.slice(0, 8);
      }
      if (Array.isArray(p.optionGroups)) np.optionGroups = p.optionGroups.map((g: any) => ({ ...g, id: novo(g.id) }));
      return np;
    });
    // grupos: id novo, optionIds remapeados, externalCode fresco
    const optionGroups = (flat.optionGroups ?? []).map((g: any) => ({
      ...g,
      id: novo(g.id),
      externalCode: 'ORZ-OG-' + novo(g.id).slice(0, 8),
      optionIds: (g.optionIds ?? []).map((oid: string) => novo(oid)),
    }));
    // opções: id/productId remapeados; parentOptionId (pizza) também
    const options = (flat.options ?? []).map((o: any) => {
      const no: any = { ...o, id: novo(o.id), productId: novo(o.productId), externalCode: 'ORZ-OP-' + novo(o.id).slice(0, 8) };
      if (Array.isArray(o.contextModifiers)) no.contextModifiers = o.contextModifiers.map((m: any) => (m.parentOptionId ? { ...m, parentOptionId: novo(m.parentOptionId) } : m));
      return no;
    });

    const item: any = {
      ...flat.item,
      id: novo(flat.item.id),
      productId: novo(flat.item.productId),
      externalCode: novoPdv,
      status: 'AVAILABLE',
    };
    if (Array.isArray(item.contextModifiers)) item.contextModifiers = item.contextModifiers.map((m: any) => ({ ...m, externalCode: novoPdv }));
    // PIZZA: nunca enviar categoryId (a API gerencia a categoria PIZZA — senão 409)
    if (tipo === 'PIZZA') delete item.categoryId;
    else item.categoryId = item.categoryId ?? ref.categoryId;

    const r = await this.ifood.putItem(merchantId, { item, products, optionGroups, options });
    if (r.status >= 200 && r.status < 300) return { ok: true, pdv: novoPdv };
    const e = mapErroIfood(r.status, r.data);
    this.logger.warn(`duplicar ${e.codigo}: ${e.mensagem}`);
    return { ok: false, erro: e.mensagem };
  }

  /**
   * Remove um item do cardápio apagando o PRODUTO principal (DELETE /products/{id}).
   * Provado na Teste C: não há DELETE /items; apagar o produto principal tira o item.
   */
  async remover(merchantId: string, pdv: string): Promise<{ ok: boolean; erro?: string }> {
    const ref = await this.resolver(merchantId, pdv);
    if (!ref) return { ok: false, erro: 'item não encontrado' };
    const productId = (ref.item as any).productId;
    if (!productId) return { ok: false, erro: 'produto principal não encontrado' };
    const r = await this.ifood.deleteProduct(merchantId, productId);
    if (r.status >= 200 && r.status < 300) return { ok: true };
    const e = mapErroIfood(r.status, r.data);
    return { ok: false, erro: e.mensagem };
  }

  /**
   * Mapa dos GRUPOS DE COMPLEMENTO (tipo INGREDIENTS/SPECIFICATION) da loja, com as
   * opções e os itens onde cada grupo aparece. Varre o flat de cada item (N leituras;
   * ok para lojas pequenas). Base da aba Complementos e das ações de grupo.
   */
  private async mapaGrupos(merchantId: string) {
    const [cat] = await this.ifood.catalogs(merchantId);
    const mapa = new Map<string, any>();
    if (!cat) return mapa;
    const cats = await this.ifood.categories(merchantId, cat.catalogId);
    const TIPOS_COMPL = new Set(['INGREDIENTS', 'SPECIFICATION', undefined]);
    for (const c of cats) {
      for (const it of c.items ?? []) {
        const flat = await this.ifood.itemFlat(merchantId, it.id);
        if (!flat) continue;
        const itemNome = it.name ?? it.id;
        const itemPdv = this.pdv(it);
        const mainProd = flat.products?.find((p) => p.id === (it as any).productId);
        const refMinMax = new Map(((mainProd as any)?.optionGroups ?? []).map((g: any) => [g.id, { min: g.min, max: g.max }]));
        for (const g of (flat.optionGroups ?? []) as any[]) {
          // só grupos de complemento (não SIZE/CRUST/EDGE/TOPPING/OFFER_UNIT)
          if (!TIPOS_COMPL.has(g.optionGroupType)) continue;
          if (!mapa.has(g.id)) {
            mapa.set(g.id, {
              id: g.id,
              nome: g.name,
              tipo: g.optionGroupType ?? 'INGREDIENTS',
              min: (refMinMax.get(g.id) as any)?.min ?? g.min ?? 0,
              max: (refMinMax.get(g.id) as any)?.max ?? g.max ?? 0,
              externalCode: g.externalCode ?? '',
              optionIds: g.optionIds ?? [],
              opcoes: (g.optionIds ?? []).map((oid: string) => {
                const o = flat.options?.find((x) => x.id === oid);
                const prod = flat.products?.find((p) => p.id === o?.productId);
                const codigo = o?.externalCode && !o.externalCode.startsWith('ORZ-') ? o.externalCode : '';
                return { nome: (prod as any)?.name ?? oid, preco: o?.price?.value ?? 0, status: o?.status === 'AVAILABLE' ? 'no_ar' : 'pausado', pdv: codigo, imagem: (prod as any)?.imagePath ?? '' };
              }),
              itens: [] as Array<{ nome: string; pdv: string | null }>,
              itemIds: [] as string[],
            });
          }
          const entry = mapa.get(g.id);
          if (!entry.itens.some((x: any) => x.nome === itemNome && x.pdv === itemPdv)) entry.itens.push({ nome: itemNome, pdv: itemPdv });
          if (!entry.itemIds.includes(it.id)) entry.itemIds.push(it.id);
        }
      }
    }
    return mapa;
  }

  /** Lista pública dos grupos de complemento (sem ids internos de item). */
  async complementos(merchantId: string) {
    const mapa = await this.mapaGrupos(merchantId);
    return [...mapa.values()].map((g) => ({
      id: g.id,
      nome: g.nome,
      tipo: g.tipo,
      min: g.min,
      max: g.max,
      opcoes: g.opcoes,
      itens: g.itens,
    }));
  }

  /** Pausa/reativa um grupo = aplica o status a TODAS as opções do grupo. */
  async statusGrupo(merchantId: string, grupoId: string, status: 'no_ar' | 'pausado'): Promise<{ ok: boolean; erro?: string }> {
    const mapa = await this.mapaGrupos(merchantId);
    const g = mapa.get(grupoId);
    if (!g) return { ok: false, erro: 'grupo não encontrado' };
    const alvo = status === 'no_ar' ? 'AVAILABLE' : 'UNAVAILABLE';
    let falhas = 0;
    for (const oid of g.optionIds as string[]) {
      const ok = await this.ifood.setOptionStatus(merchantId, oid, alvo);
      if (!ok) falhas++;
    }
    if (falhas) return { ok: false, erro: `${falhas} opção(ões) não atualizaram` };
    return { ok: true };
  }

  /**
   * Remove um grupo de complemento: desanexa de cada item que o usa (re-PUT do item
   * sem o grupo) e depois apaga o grupo (DELETE /optionGroups). Best-effort no delete.
   */
  async removerGrupo(merchantId: string, grupoId: string): Promise<{ ok: boolean; erro?: string }> {
    const mapa = await this.mapaGrupos(merchantId);
    const g = mapa.get(grupoId);
    if (!g) return { ok: false, erro: 'grupo não encontrado' };
    const limpar = (p: any) => {
      const { weight, industrialized, ...resto } = p;
      return resto;
    };
    for (const itemId of g.itemIds as string[]) {
      const flat = await this.ifood.itemFlat(merchantId, itemId);
      if (!flat) continue;
      const optDoGrupo = new Set<string>(((flat.optionGroups ?? []).find((x: any) => x.id === grupoId)?.optionIds ?? []) as string[]);
      const optionGroups = (flat.optionGroups ?? []).filter((x: any) => x.id !== grupoId);
      const options = (flat.options ?? []).filter((o: any) => !optDoGrupo.has(o.id));
      const prodOpcoes = new Set((flat.options ?? []).filter((o: any) => optDoGrupo.has(o.id)).map((o: any) => o.productId));
      const products = (flat.products ?? [])
        .filter((p: any) => !prodOpcoes.has(p.id))
        .map(limpar)
        .map((p: any) => {
          const np = { ...p };
          if (np.imagePath) np.imagePath = String(np.imagePath).replace(/^https?:\/\/[^/]+\//, '');
          if (Array.isArray(np.optionGroups)) np.optionGroups = np.optionGroups.filter((r: any) => r.id !== grupoId);
          return np;
        });
      const r = await this.ifood.putItem(merchantId, { item: flat.item, products, optionGroups, options });
      if (!(r.status >= 200 && r.status < 300)) {
        const e = mapErroIfood(r.status, r.data);
        return { ok: false, erro: `${(flat.item as any).name ?? itemId}: ${e.mensagem}` };
      }
    }
    // grupo órfão: tenta apagar (best-effort; se falhar, já saiu de todos os itens)
    await this.ifood.deleteOptionGroup(merchantId, grupoId).catch(() => null);
    return { ok: true };
  }

  /**
   * Edita um grupo de complemento (nome/min/max/opções) em TODOS os itens que o usam,
   * preservando o id do grupo. Reconstrói as opções (ids novos) e re-PUT de cada item.
   */
  async editarGrupo(
    merchantId: string,
    grupoId: string,
    dados: { nome: string; min: number; max: number; opcoes: Array<{ nome: string; preco?: number; pdv?: string; imagem?: string }> },
  ): Promise<{ ok: boolean; erro?: string }> {
    const mapa = await this.mapaGrupos(merchantId);
    const g = mapa.get(grupoId);
    if (!g) return { ok: false, erro: 'grupo não encontrado' };
    if (!dados.nome?.trim()) return { ok: false, erro: 'nome do grupo é obrigatório' };
    if (!dados.opcoes?.length) return { ok: false, erro: 'o grupo precisa de ao menos uma opção' };

    const limpar = (p: any) => {
      const { weight, industrialized, ...resto } = p;
      return resto;
    };
    for (const itemId of g.itemIds as string[]) {
      const flat = await this.ifood.itemFlat(merchantId, itemId);
      if (!flat) continue;
      // reconstrói o grupo (mesmo id) com as opções novas — sobe imagens se houver
      const built = await this.montarComplementos(merchantId, [{ grupo: dados.nome, min: dados.min, max: dados.max, opcoes: dados.opcoes }], [grupoId]);
      const novoGrupo = built.optionGroups[0];

      const optAntigas = new Set<string>(((flat.optionGroups ?? []).find((x: any) => x.id === grupoId)?.optionIds ?? []) as string[]);
      const prodAntigos = new Set((flat.options ?? []).filter((o: any) => optAntigas.has(o.id)).map((o: any) => o.productId));

      const optionGroups = (flat.optionGroups ?? []).map((x: any) => (x.id === grupoId ? novoGrupo : x));
      const options = [...(flat.options ?? []).filter((o: any) => !optAntigas.has(o.id)), ...built.options];
      const products = [
        ...(flat.products ?? [])
          .filter((p: any) => !prodAntigos.has(p.id))
          .map(limpar)
          .map((p: any) => {
            const np = { ...p };
            if (np.imagePath) np.imagePath = String(np.imagePath).replace(/^https?:\/\/[^/]+\//, '');
            if (Array.isArray(np.optionGroups)) np.optionGroups = np.optionGroups.map((r: any) => (r.id === grupoId ? { id: grupoId, min: dados.min, max: dados.max } : r));
            return np;
          }),
        ...built.optionProducts,
      ];
      const r = await this.ifood.putItem(merchantId, { item: flat.item, products, optionGroups, options });
      if (!(r.status >= 200 && r.status < 300)) {
        const e = mapErroIfood(r.status, r.data);
        return { ok: false, erro: `${(flat.item as any).name ?? itemId}: ${e.mensagem}` };
      }
    }
    return { ok: true };
  }

  // resolve o PDV → item (itemId, productId, categoria) varrendo o catálogo
  private async resolver(
    merchantId: string,
    pdv: string,
  ): Promise<{ itemId: string; item: IfoodItem; nome: string; categoria: string; categoryId: string } | null> {
    const [cat] = await this.ifood.catalogs(merchantId);
    if (!cat) return null;
    const cats = await this.ifood.categories(merchantId, cat.catalogId);
    for (const c of cats)
      for (const it of c.items ?? []) if (this.pdv(it) === pdv) return { itemId: it.id, item: it, nome: it.name ?? it.id, categoria: c.name, categoryId: c.id };
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
