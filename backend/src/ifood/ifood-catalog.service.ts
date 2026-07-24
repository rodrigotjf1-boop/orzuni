import { Injectable, Logger } from '@nestjs/common';
import { IfoodAuthService } from './ifood-auth.service';
import type {
  IfoodCatalog,
  IfoodCategory,
  IfoodItemFlat,
  IfoodUnsellable,
  IfoodBatchAck,
  IfoodBatchResult,
} from './ifood.types';

/**
 * Cliente da Catalog API v2 do iFood (base /catalog/v2.0).
 *
 * Cada método reflete um endpoint PROVADO em teste ao vivo (2026-07-24, loja de
 * teste 77e41b59). Ver docs/ifood-catalog-api.md §8 no repo do Regem para os
 * resultados. Regras que viraram código aqui:
 *
 *  - dinheiro em REAIS decimais (12.9), não centavos → converter na borda;
 *  - `externalCode` (código de PDV) é a CHAVE de reconciliação — o `PUT /items`
 *    respeita o id em item novo, mas para atualizar reenvie o MESMO id, e um
 *    409 de conflito devolve o id existente em conflictingResources;
 *  - preço/status em lote são ASSÍNCRONOS: retornam { batchId } → consultar
 *    getBatch(); casam por `externalCode` (base do modo ponte para o ERP);
 *  - `catalogContext` omitido = vale para TODOS os contextos (cuidado);
 *  - imagem: body { image: "data:image/jpeg;base64,…" } (data-URI) → { imagePath };
 *  - retry só em 5xx/rede; 4xx nunca; 401 renova o token uma vez.
 */
@Injectable()
export class IfoodCatalogService {
  private readonly logger = new Logger('iFood/catalog');
  private readonly base =
    (process.env.IFOOD_BASE ?? 'https://merchant-api.ifood.com.br') + '/catalog/v2.0';

  constructor(private readonly auth: IfoodAuthService) {}

  // ---- transporte ----
  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
    tentativa = 0,
  ): Promise<{ status: number; data: T }> {
    const token = await this.auth.getToken();
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    // 5xx / rede → backoff exponencial (1s, 2s, 4s), no máx. 3 tentativas
    if (res.status >= 500 && tentativa < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** tentativa));
      return this.req<T>(method, path, body, tentativa + 1);
    }
    const text = await res.text();
    const data = (text ? JSON.parse(text) : null) as T;
    if (!res.ok && res.status !== 202) {
      this.logger.warn(`${method} ${path} → ${res.status}: ${text.slice(0, 160)}`);
    }
    return { status: res.status, data };
  }

  // ---- leitura ----
  /** Lista os catálogos do merchant. Sempre o 1º passo (dá catalogId, groupId, modifiedAt). */
  async catalogs(merchantId: string): Promise<IfoodCatalog[]> {
    const { data } = await this.req<IfoodCatalog[]>('GET', `/merchants/${merchantId}/catalogs`);
    return data ?? [];
  }

  /** Categorias + itens + complementos (o "dump" do cardápio). */
  async categories(merchantId: string, catalogId: string): Promise<IfoodCategory[]> {
    const { data } = await this.req<IfoodCategory[] | IfoodCategory>(
      'GET',
      `/merchants/${merchantId}/catalogs/${catalogId}/categories?includeItems=true`,
    );
    return Array.isArray(data) ? data : data ? [data] : [];
  }

  /** ⭐ O coração do vigia: o que está invendável e POR QUÊ (restrictions[]). */
  async unsellable(merchantId: string, catalogId: string): Promise<IfoodUnsellable> {
    const { data } = await this.req<IfoodUnsellable>(
      'GET',
      `/merchants/${merchantId}/catalogs/${catalogId}/unsellableItems`,
    );
    return data ?? { categories: [] };
  }

  /** Item normalizado (item + products + optionGroups + options). Ideal para diff. */
  async itemFlat(merchantId: string, itemId: string): Promise<IfoodItemFlat | null> {
    const { status, data } = await this.req<IfoodItemFlat>(
      'GET',
      `/merchants/${merchantId}/items/${itemId}/flat`,
    );
    return status === 200 ? data : null;
  }

  async catalogVersion(merchantId: string): Promise<string> {
    const { data } = await this.req<string>('GET', `/merchants/${merchantId}/catalog/version`);
    return data ?? '';
  }

  // ---- escrita leve (pontual) ----
  /** Pausa/reativa um item. `context` omitido = todos os contextos. */
  async setItemStatus(
    merchantId: string,
    itemId: string,
    status: 'AVAILABLE' | 'UNAVAILABLE',
    context?: string,
  ): Promise<boolean> {
    const body = context
      ? { itemId, statusByCatalog: [{ status, catalogContext: context }] }
      : { itemId, status };
    const r = await this.req('PATCH', `/merchants/${merchantId}/items/status`, body);
    return r.status >= 200 && r.status < 300;
  }

  /** Pausa/reativa uma OPÇÃO (complemento). Base da recuperação da cascata. */
  async setOptionStatus(
    merchantId: string,
    optionId: string,
    status: 'AVAILABLE' | 'UNAVAILABLE',
  ): Promise<boolean> {
    const r = await this.req('PATCH', `/merchants/${merchantId}/options/status`, { optionId, status });
    return r.status >= 200 && r.status < 300;
  }

  // ---- escrita em lote (assíncrona) ----
  /**
   * ⭐ MODO PONTE: reprecifica por CÓDIGO DE PDV, sem conhecer id do iFood.
   * `precos`: [{ externalCode, value(reais) }]. Retorna { batchId } → getBatch().
   */
  async pricesByExternalCode(
    merchantId: string,
    precos: Array<{ externalCode: string; value: number; originalValue?: number }>,
    context?: string,
  ): Promise<IfoodBatchAck | null> {
    const path = `/merchants/${merchantId}/products/price${context ? `?catalogContext=${context}` : ''}`;
    // originalValue vai junto quando presente — preserva o "de/por" (ver docs §8).
    const body = precos.map((p) => ({
      externalCode: p.externalCode,
      price: p.originalValue ? { value: p.value, originalValue: p.originalValue } : { value: p.value },
    }));
    const { status, data } = await this.req<IfoodBatchAck>('PATCH', path, body);
    return status === 202 ? data : null;
  }

  /** Pausa/reativa em lote por PDV. Mesmo padrão assíncrono. */
  async statusByExternalCode(
    merchantId: string,
    itens: Array<{ externalCode: string; status: 'AVAILABLE' | 'UNAVAILABLE' }>,
    context?: string,
  ): Promise<IfoodBatchAck | null> {
    const path = `/merchants/${merchantId}/products/status${context ? `?catalogContext=${context}` : ''}`;
    const { status, data } = await this.req<IfoodBatchAck>('PATCH', path, itens);
    return status === 202 ? data : null;
  }

  /** Resultado de um lote: results[].result = SUCCESS | FAILURE + failureReason. */
  async getBatch(merchantId: string, batchId: string): Promise<IfoodBatchResult | null> {
    const { status, data } = await this.req<IfoodBatchResult>(
      'GET',
      `/merchants/${merchantId}/batch/${batchId}`,
    );
    return status === 200 ? data : null;
  }

  // ---- imagem ----
  /** Sobe uma imagem (data-URI base64) e devolve o imagePath para usar no produto. */
  async uploadImage(merchantId: string, dataUri: string): Promise<string | null> {
    const { status, data } = await this.req<{ imagePath: string }>(
      'POST',
      `/merchants/${merchantId}/image/upload`,
      { image: dataUri },
    );
    return status === 201 ? data.imagePath : null;
  }
}
