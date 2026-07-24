import { Injectable, Logger } from '@nestjs/common';
import { IfoodMerchantService } from '../ifood/ifood-merchant.service';

export interface Conta {
  merchantId: string;
  nome: string;
}

/**
 * Contas iFood que o Orzuni gerencia. Hoje: a loja do IFOOD_MERCHANT_ID (uma).
 * Evolução (multi-tenant): ler de conta_ifood + descobrir por merchants().
 */
@Injectable()
export class ContaService {
  private readonly logger = new Logger('conta');
  constructor(private readonly merchant: IfoodMerchantService) {}

  async ativas(): Promise<Conta[]> {
    const env = process.env.IFOOD_MERCHANT_ID;
    if (env) return [{ merchantId: env, nome: 'loja configurada' }];
    // sem env: descobre pelo app (todas as autorizadas)
    const ms = await this.merchant.merchants();
    if (!ms.length) this.logger.warn('nenhuma loja autorizada e IFOOD_MERCHANT_ID vazio');
    return ms.map((m) => ({ merchantId: m.id, nome: m.name }));
  }
}
