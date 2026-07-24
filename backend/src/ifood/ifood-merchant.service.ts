import { Injectable, Logger } from '@nestjs/common';
import { IfoodAuthService } from './ifood-auth.service';

/**
 * Módulo Merchant do iFood — descoberta e status de loja.
 * No modo centralizado, GET /merchant/v1.0/merchants lista TODAS as lojas que
 * autorizaram o app. É o que substitui "o lojista colar merchantId na mão".
 */
@Injectable()
export class IfoodMerchantService {
  private readonly logger = new Logger('iFood/merchant');
  private readonly base =
    (process.env.IFOOD_BASE ?? 'https://merchant-api.ifood.com.br') + '/merchant/v1.0';

  constructor(private readonly auth: IfoodAuthService) {}

  /** Lojas autorizadas para o app (id + nome). */
  async merchants(): Promise<Array<{ id: string; name: string }>> {
    const res = await fetch(`${this.base}/merchants`, {
      headers: { Authorization: `Bearer ${await this.auth.getToken()}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      this.logger.warn(`merchants ${res.status}`);
      return [];
    }
    const j = (await res.json()) as Array<{ id: string; name: string }>;
    return Array.isArray(j) ? j : [];
  }
}
